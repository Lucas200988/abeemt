import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Prisma, type EntityStatus } from '@bora/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { assertSameOrganization, organizationFilter } from '../../common/tenant-scope';
import { paginated, type Paginated, type PaginationDto } from '../../common/dto/pagination.dto';
import { runtimeEnv } from '../../config/runtime-env';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { CreateTerminalDto, UpdateTerminalDto } from './dto/terminal.dto';

/**
 * Cadastro e credencial das maquininhas (FASE 8, caminho A).
 *
 * Duas decisões estruturais, ambas de segurança:
 *
 * 1. **O terminal é uma identidade própria, não um usuário.** Ele fica pendurado
 *    num poste, ligado o dia inteiro, fisicamente acessível. Uma credencial de
 *    operador nele seria a chave do painel inteiro exposta na rua. O token de
 *    terminal só abre os endpoints do próprio terminal, e só do seu conector.
 *
 * 2. **Ninguém digita segredo na tela do equipamento.** O painel gera um código
 *    curto e de uso único; o instalador digita o código, e o equipamento recebe
 *    de volta o token longo. O segredo de verdade nunca passa por um teclado.
 */

/** Relações necessárias para a visão do painel. */
const TERMINAL_INCLUDE = {
  site: { select: { id: true, name: true, organizationId: true } },
  connector: {
    select: {
      id: true,
      connectorNumber: true,
      charger: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.TerminalInclude;

type TerminalComRelacoes = Prisma.TerminalGetPayload<{ include: typeof TERMINAL_INCLUDE }>;

export interface TerminalView {
  id: string;
  name: string;
  siteId: string;
  siteName: string;
  connectorId: string | null;
  connectorLabel: string | null;
  serialNumber: string | null;
  model: string | null;
  status: EntityStatus;
  paired: boolean;
  pairedAt: Date | null;
  /** Código de pareamento em aberto, se houver e ainda não tiver expirado. */
  pairingCode: string | null;
  pairingExpiresAt: Date | null;
  lastSeenAt: Date | null;
  appVersion: string | null;
  createdAt: Date;
}

/**
 * Alfabeto do código de pareamento.
 *
 * Sem `0/O` e `1/I/L`: o código é lido de uma tela e digitado num teclado de
 * maquininha, e confundir zero com "ó" transformaria um erro de digitação em
 * chamado de suporte. Restam 8 caracteres de 30 possibilidades — cerca de 39
 * bits, longe do alcance de tentativa e erro pela rede, que ainda por cima
 * passa pelo limitador de requisições.
 */
const ALFABETO_PAREAMENTO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TAMANHO_CODIGO = 8;

@Injectable()
export class TerminalsService {
  private readonly logger = new Logger(TerminalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Painel
  // ---------------------------------------------------------------------------

  async list(
    user: AuthenticatedUser,
    pagination: PaginationDto,
    filtros: { siteId?: string; status?: EntityStatus } = {},
  ): Promise<Paginated<TerminalView>> {
    const escopo = organizationFilter(user);
    const where: Prisma.TerminalWhereInput = {};

    if (escopo.organizationId) where.site = { organizationId: escopo.organizationId };
    if (filtros.siteId) where.siteId = filtros.siteId;
    if (filtros.status) where.status = filtros.status;

    const [registros, total] = await Promise.all([
      this.prisma.terminal.findMany({
        where,
        include: TERMINAL_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.pageSize,
      }),
      this.prisma.terminal.count({ where }),
    ]);

    return paginated(
      registros.map((t) => this.toView(t)),
      total,
      pagination,
    );
  }

  async get(user: AuthenticatedUser, id: string): Promise<TerminalView> {
    return this.toView(await this.buscarComEscopo(user, id));
  }

  /**
   * Cadastra a maquininha e já devolve o primeiro código de pareamento.
   *
   * O conector é obrigatório: um terminal sem conector não consegue iniciar
   * recarga nenhuma, e cadastrá-lo assim só adiaria a descoberta para o momento
   * em que houver um motorista esperando.
   */
  async create(
    user: AuthenticatedUser,
    dto: CreateTerminalDto,
    context: { ipAddress?: string; userAgent?: string },
  ): Promise<TerminalView> {
    const conector = await this.prisma.connector.findUnique({
      where: { id: dto.connectorId },
      select: {
        id: true,
        charger: { select: { siteId: true, site: { select: { organizationId: true } } } },
      },
    });

    if (!conector) {
      throw new BadRequestException({
        code: 'CONNECTOR_NOT_FOUND',
        message: 'O conector informado não existe.',
      });
    }

    assertSameOrganization(user, conector.charger.site.organizationId);

    const criado = await this.prisma.terminal.create({
      data: {
        siteId: conector.charger.siteId,
        connectorId: dto.connectorId,
        name: dto.name,
        model: dto.model,
        ...this.novoCodigoDePareamento(),
      },
      include: TERMINAL_INCLUDE,
    });

    await this.audit.record({
      user,
      action: 'terminal.create',
      entityType: 'Terminal',
      entityId: criado.id,
      organizationId: conector.charger.site.organizationId,
      // O código de pareamento NÃO vai para a auditoria: é uma credencial.
      newValue: { name: dto.name, connectorId: dto.connectorId },
      ...context,
    });

    return this.toView(criado);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateTerminalDto,
    context: { ipAddress?: string; userAgent?: string },
  ): Promise<TerminalView> {
    const anterior = await this.buscarComEscopo(user, id);

    if (dto.connectorId && dto.connectorId !== anterior.connectorId) {
      const conector = await this.prisma.connector.findUnique({
        where: { id: dto.connectorId },
        select: {
          charger: { select: { siteId: true, site: { select: { organizationId: true } } } },
        },
      });

      if (!conector) {
        throw new BadRequestException({
          code: 'CONNECTOR_NOT_FOUND',
          message: 'O conector informado não existe.',
        });
      }

      assertSameOrganization(user, conector.charger.site.organizationId);
    }

    const atualizado = await this.prisma.terminal.update({
      where: { id },
      data: { name: dto.name, model: dto.model, connectorId: dto.connectorId, status: dto.status },
      include: TERMINAL_INCLUDE,
    });

    await this.audit.record({
      user,
      action: 'terminal.update',
      entityType: 'Terminal',
      entityId: id,
      organizationId: anterior.site.organizationId,
      previousValue: {
        name: anterior.name,
        connectorId: anterior.connectorId,
        status: anterior.status,
      },
      newValue: { name: dto.name, connectorId: dto.connectorId, status: dto.status },
      ...context,
    });

    return this.toView(atualizado);
  }

  /**
   * Gera um código novo, invalidando o token atual.
   *
   * Invalidar é deliberado: o motivo mais comum para gerar código novo é o
   * equipamento ter sido trocado ou perdido. Manter o token antigo válido
   * deixaria a maquininha extraviada funcionando (risco R-32).
   */
  async generatePairingCode(
    user: AuthenticatedUser,
    id: string,
    context: { ipAddress?: string; userAgent?: string },
  ): Promise<{ pairingCode: string; expiresAt: Date; connectorLabel: string | null }> {
    const terminal = await this.buscarComEscopo(user, id);
    const codigo = this.novoCodigoDePareamento();

    const atualizado = await this.prisma.terminal.update({
      where: { id },
      data: { ...codigo, tokenHash: null, pairedAt: null },
      include: TERMINAL_INCLUDE,
    });

    await this.audit.record({
      user,
      action: 'terminal.generate_pairing_code',
      entityType: 'Terminal',
      entityId: id,
      organizationId: terminal.site.organizationId,
      newValue: { tokenAnteriorInvalidado: terminal.tokenHash !== null },
      ...context,
    });

    return {
      pairingCode: codigo.pairingCode,
      expiresAt: codigo.pairingExpiresAt,
      connectorLabel: this.connectorLabel(atualizado),
    };
  }

  /**
   * Corta o acesso da maquininha imediatamente.
   *
   * É o botão para "o terminal sumiu". Não apaga o cadastro: os pagamentos já
   * feitos apontam para ele, e a auditoria precisa saber de onde vieram.
   */
  async revoke(
    user: AuthenticatedUser,
    id: string,
    context: { ipAddress?: string; userAgent?: string },
  ): Promise<TerminalView> {
    const terminal = await this.buscarComEscopo(user, id);

    const atualizado = await this.prisma.terminal.update({
      where: { id },
      data: {
        tokenHash: null,
        pairedAt: null,
        pairingCode: null,
        pairingExpiresAt: null,
        status: 'INACTIVE',
      },
      include: TERMINAL_INCLUDE,
    });

    await this.audit.record({
      user,
      action: 'terminal.revoke',
      entityType: 'Terminal',
      entityId: id,
      organizationId: terminal.site.organizationId,
      previousValue: { status: terminal.status, pareado: terminal.tokenHash !== null },
      newValue: { status: 'INACTIVE', pareado: false },
      ...context,
    });

    this.logger.warn({ terminalId: id, por: user.id }, 'acesso do terminal revogado');

    return this.toView(atualizado);
  }

  // ---------------------------------------------------------------------------
  // Maquininha
  // ---------------------------------------------------------------------------

  /**
   * Troca o código de pareamento pelo token de acesso.
   *
   * O token é devolvido **uma única vez**, em claro; guardamos apenas o hash.
   * Perdido, o caminho é gerar outro código — não recuperar.
   */
  async pair(input: {
    pairingCode: string;
    serialNumber?: string;
    model?: string;
    appVersion?: string;
  }): Promise<{ token: string; terminal: TerminalView }> {
    const codigo = input.pairingCode.trim().toUpperCase();

    const terminal = await this.prisma.terminal.findUnique({
      where: { pairingCode: codigo },
      include: TERMINAL_INCLUDE,
    });

    /**
     * Mensagem idêntica para código inexistente, expirado e terminal inativo.
     *
     * Diferenciar diria a quem está tentando adivinhar quais códigos existem —
     * e o espaço de busca é pequeno o suficiente para que isso importe.
     */
    const invalido = new UnauthorizedException({
      code: 'INVALID_PAIRING_CODE',
      message: 'Código de pareamento inválido ou expirado. Gere um novo no painel.',
    });

    if (!terminal) throw invalido;
    if (!terminal.pairingExpiresAt || terminal.pairingExpiresAt.getTime() < Date.now()) {
      throw invalido;
    }
    if (terminal.status !== 'ACTIVE') throw invalido;

    if (!terminal.connectorId) {
      throw new ConflictException({
        code: 'TERMINAL_WITHOUT_CONNECTOR',
        message: 'Este terminal não está vinculado a nenhum conector. Ajuste o cadastro no painel.',
      });
    }

    const token = this.novoToken();

    const atualizado = await this.prisma.terminal.update({
      where: { id: terminal.id },
      data: {
        tokenHash: this.hashDoToken(token),
        // Consumido: um código de pareamento vale uma vez.
        pairingCode: null,
        pairingExpiresAt: null,
        pairedAt: new Date(),
        serialNumber: input.serialNumber ?? terminal.serialNumber,
        model: input.model ?? terminal.model,
        appVersion: input.appVersion,
        lastSeenAt: new Date(),
      },
      include: TERMINAL_INCLUDE,
    });

    await this.audit.record({
      action: 'terminal.paired',
      entityType: 'Terminal',
      entityId: terminal.id,
      organizationId: terminal.site.organizationId,
      // O token nunca vai para a auditoria.
      newValue: { serialNumber: input.serialNumber, appVersion: input.appVersion },
    });

    this.logger.log(
      { terminalId: terminal.id, connectorId: terminal.connectorId },
      'terminal pareado',
    );

    return { token, terminal: this.toView(atualizado) };
  }

  /**
   * Identifica o terminal pelo token do cabeçalho.
   *
   * O hash é SHA-256, não Argon2 — de propósito. O token é 32 bytes aleatórios,
   * não uma senha escolhida por gente: não há dicionário a resistir, e um hash
   * lento aqui só serviria para tornar impossível o índice único que faz esta
   * consulta ser uma busca direta em vez de uma varredura da tabela.
   */
  async authenticate(token: string): Promise<TerminalComRelacoes> {
    const naoAutorizado = new UnauthorizedException({
      code: 'INVALID_TERMINAL_TOKEN',
      message: 'Terminal não autorizado. Refaça o pareamento pelo painel.',
    });

    if (!token) throw naoAutorizado;

    const terminal = await this.prisma.terminal.findUnique({
      where: { tokenHash: this.hashDoToken(token) },
      include: TERMINAL_INCLUDE,
    });

    if (!terminal || !terminal.tokenHash) throw naoAutorizado;

    // Redundante depois da busca por hash, mas barato: garante que a comparação
    // final não dependa de igualdade curto-circuitada em nenhum caminho futuro.
    const esperado = Buffer.from(terminal.tokenHash);
    const recebido = Buffer.from(this.hashDoToken(token));
    if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) {
      throw naoAutorizado;
    }

    if (terminal.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        code: 'TERMINAL_INACTIVE',
        message: 'Este terminal está desativado.',
      });
    }

    if (!terminal.connectorId) {
      throw new ConflictException({
        code: 'TERMINAL_WITHOUT_CONNECTOR',
        message: 'Este terminal não está vinculado a nenhum conector.',
      });
    }

    return terminal;
  }

  /** Sinal de vida, usado pelo painel para mostrar terminal mudo. */
  async touch(id: string, appVersion?: string): Promise<void> {
    await this.prisma.terminal.update({
      where: { id },
      data: { lastSeenAt: new Date(), appVersion },
    });
  }

  // ---------------------------------------------------------------------------
  // Apoio
  // ---------------------------------------------------------------------------

  private async buscarComEscopo(user: AuthenticatedUser, id: string): Promise<TerminalComRelacoes> {
    const terminal = await this.prisma.terminal.findUnique({
      where: { id },
      include: TERMINAL_INCLUDE,
    });

    if (!terminal) {
      throw new NotFoundException({
        code: 'TERMINAL_NOT_FOUND',
        message: 'Terminal não encontrado.',
      });
    }

    assertSameOrganization(user, terminal.site.organizationId);

    return terminal;
  }

  private novoCodigoDePareamento(): { pairingCode: string; pairingExpiresAt: Date } {
    // `randomInt` é do gerador criptográfico e não enviesa o alfabeto, ao
    // contrário de `Math.random() * n` arredondado.
    let codigo = '';
    for (let i = 0; i < TAMANHO_CODIGO; i += 1) {
      codigo += ALFABETO_PAREAMENTO[randomInt(ALFABETO_PAREAMENTO.length)];
    }

    return {
      pairingCode: codigo,
      pairingExpiresAt: new Date(
        Date.now() + runtimeEnv.BORA_TERMINAL_PAIRING_TTL_MINUTES * 60_000,
      ),
    };
  }

  private novoToken(): string {
    // 32 bytes em base64url. O prefixo existe para que o token seja reconhecível
    // num log ou num arquivo de configuração e possa ser caçado e revogado.
    return `bora_pos_${randomBytes(32).toString('base64url')}`;
  }

  private hashDoToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private connectorLabel(terminal: TerminalComRelacoes): string | null {
    if (!terminal.connector) return null;

    return `${terminal.connector.charger.name} — conector ${terminal.connector.connectorNumber}`;
  }

  toView(terminal: TerminalComRelacoes): TerminalView {
    const codigoValido =
      terminal.pairingCode !== null &&
      terminal.pairingExpiresAt !== null &&
      terminal.pairingExpiresAt.getTime() > Date.now();

    return {
      id: terminal.id,
      name: terminal.name,
      siteId: terminal.siteId,
      siteName: terminal.site.name,
      connectorId: terminal.connectorId,
      connectorLabel: this.connectorLabel(terminal),
      serialNumber: terminal.serialNumber,
      model: terminal.model,
      status: terminal.status,
      paired: terminal.tokenHash !== null,
      pairedAt: terminal.pairedAt,
      // Código expirado não é mostrado: exibi-lo levaria o instalador a digitar
      // algo que já não funciona e a culpar o equipamento.
      pairingCode: codigoValido ? terminal.pairingCode : null,
      pairingExpiresAt: codigoValido ? terminal.pairingExpiresAt : null,
      lastSeenAt: terminal.lastSeenAt,
      appVersion: terminal.appVersion,
      createdAt: terminal.createdAt,
    };
  }
}
