import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import {
  CONNECTOR_STATUS_LABELS,
  CONNECTION_STATUS_LABELS,
  OPERATIONAL_STATUS_LABELS,
  labelOf,
} from '@bora/contracts';
import { Prisma } from '@bora/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConnectionRegistry } from '../ocpp/connection-registry';
import { assertSameOrganization, siteScopedFilter } from '../../common/tenant-scope';
import { paginated, type Paginated, type PaginationDto } from '../../common/dto/pagination.dto';
import { runtimeEnv } from '../../config/runtime-env';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type {
  CreateChargerDto,
  CreateConnectorDto,
  UpdateChargerDto,
  UpdateConnectorDto,
} from './dto/charger.dto';

const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

/**
 * Relações necessárias para montar a visão do painel.
 *
 * Declarado como const com `satisfies` — e não devolvido por um método — para
 * que o Prisma infira o tipo COM as relações. Vindo de um método, a inferência
 * cai no modelo base e o `toView` passa a receber um objeto sem `site` nem
 * `connectors`, erro que o SWC dos testes não acusa.
 */
const CHARGER_INCLUDE = {
  site: {
    select: {
      id: true,
      name: true,
      organizationId: true,
      preAuthCeilingCents: true,
      organization: { select: { preAuthCeilingCents: true } },
    },
  },
  connectors: {
    orderBy: { connectorNumber: 'asc' },
    include: {
      sessions: {
        // Só a sessão em curso interessa para o painel.
        where: {
          status: {
            in: [
              'PAYMENT_APPROVED',
              'AWAITING_CHARGER',
              'COMMAND_SENT',
              'STARTING',
              'CHARGING',
              'FINISHING',
            ],
          },
        },
        select: { id: true },
        take: 1,
      },
    },
  },
} satisfies Prisma.ChargerInclude;

type ChargerComRelacoes = Prisma.ChargerGetPayload<{ include: typeof CHARGER_INCLUDE }>;

export interface ConnectorView {
  id: string;
  connectorNumber: number;
  connectorType: string | null;
  ratedPowerKw: number | null;
  status: string;
  statusLabel: string;
  errorCode: string | null;
  lastStatusAt: Date | null;
  /** Sessão em curso neste conector, se houver. */
  activeSessionId: string | null;
}

export interface ChargerView {
  id: string;
  siteId: string;
  siteName: string;
  organizationId: string;
  chargePointIdentity: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  firmwareVersion: string | null;
  protocolVersion: string;
  address: string | null;

  connectionStatus: string;
  connectionStatusLabel: string;
  operationalStatus: string;
  operationalStatusLabel: string;
  /** Conectado ao servidor **neste momento**, segundo o registro em memória. */
  liveConnected: boolean;

  lastSeenAt: Date | null;
  lastBootAt: Date | null;
  lastHeartbeatAt: Date | null;
  hasCredentials: boolean;

  /** Teto efetivo de pré-autorização e de onde ele veio (ADR-0008 §9). */
  effectivePreAuthCeilingCents: number;
  preAuthCeilingSource: 'carregador' | 'estabelecimento' | 'organização' | 'padrão do sistema';

  /** URL que precisa ser configurada no equipamento. */
  ocppUrl: string;

  connectors: ConnectorView[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Mensagem OCPP como o painel consome.
 *
 * Tipo próprio, e não o modelo do Prisma, porque o `JsonValue` dele referencia
 * um módulo interno do runtime que o TypeScript não consegue nomear a partir de
 * outro pacote do monorepo — o build quebrava com TS2742.
 */
export interface OcppMessageView {
  id: string;
  direction: string;
  messageType: number;
  messageId: string;
  action: string | null;
  payload: unknown;
  responsePayload: unknown;
  errorCode: string | null;
  errorDescription: string | null;
  correlationId: string | null;
  receivedAt: Date;
  respondedAt: Date | null;
  processingDurationMs: number | null;
}

@Injectable()
export class ChargersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly registry: ConnectionRegistry,
  ) {}

  async list(
    user: AuthenticatedUser,
    pagination: PaginationDto,
    filtros: { siteId?: string; onlineOnly?: boolean } = {},
  ): Promise<Paginated<ChargerView>> {
    const where = {
      ...siteScopedFilter(user),
      ...(filtros.siteId ? { siteId: filtros.siteId } : {}),
      ...(filtros.onlineOnly ? { connectionStatus: 'ONLINE' as const } : {}),
    };

    const [registros, total] = await Promise.all([
      this.prisma.charger.findMany({
        where,
        include: CHARGER_INCLUDE,
        orderBy: [{ connectionStatus: 'asc' }, { name: 'asc' }],
        skip: pagination.skip,
        take: pagination.pageSize,
      }),
      this.prisma.charger.count({ where }),
    ]);

    return paginated(
      registros.map((c) => this.toView(c)),
      total,
      pagination,
    );
  }

  async get(user: AuthenticatedUser, id: string): Promise<ChargerView> {
    const charger = await this.prisma.charger.findUnique({
      where: { id },
      include: CHARGER_INCLUDE,
    });

    if (!charger) {
      throw new NotFoundException({
        code: 'CHARGER_NOT_FOUND',
        message: 'Carregador não encontrado.',
      });
    }

    assertSameOrganization(user, charger.site.organizationId);

    return this.toView(charger);
  }

  /**
   * Cadastra um carregador e, opcionalmente, gera a credencial individual.
   *
   * A credencial é devolvida **uma única vez**, em claro. Guardamos apenas o
   * hash: se ela for perdida, o caminho é gerar outra, não recuperar — é o mesmo
   * princípio de uma senha.
   */
  async create(
    user: AuthenticatedUser,
    dto: CreateChargerDto,
    context: { ipAddress?: string; userAgent?: string },
  ): Promise<ChargerView & { credential?: string }> {
    const site = await this.prisma.site.findUnique({
      where: { id: dto.siteId },
      select: { id: true, organizationId: true },
    });

    if (!site) {
      throw new BadRequestException({
        code: 'SITE_NOT_FOUND',
        message: 'O estabelecimento informado não existe.',
      });
    }

    assertSameOrganization(user, site.organizationId);

    const credential = dto.generateCredential ? this.gerarCredencial() : undefined;

    const criado = await this.prisma.charger.create({
      data: {
        siteId: dto.siteId,
        chargePointIdentity: dto.chargePointIdentity,
        name: dto.name,
        manufacturer: dto.manufacturer,
        model: dto.model,
        serialNumber: dto.serialNumber,
        address: dto.address,
        preAuthCeilingCents: dto.preAuthCeilingCents,
        credentialsHash: credential ? await hash(credential, ARGON2) : undefined,
        // Conectores informados no cadastro; podem ser ajustados depois. O
        // carregador também pode anunciar conectores por StatusNotification.
        connectors: dto.connectors?.length
          ? {
              create: dto.connectors.map((c) => ({
                connectorNumber: c.connectorNumber,
                connectorType: c.connectorType,
                ratedPowerKw: c.ratedPowerKw,
              })),
            }
          : undefined,
      },
      include: CHARGER_INCLUDE,
    });

    await this.audit.record({
      user,
      action: 'charger.create',
      entityType: 'Charger',
      entityId: criado.id,
      organizationId: site.organizationId,
      newValue: {
        chargePointIdentity: criado.chargePointIdentity,
        name: criado.name,
        comCredencial: Boolean(credential),
      },
      ...context,
    });

    return { ...this.toView(criado), credential };
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateChargerDto,
    context: { ipAddress?: string; userAgent?: string },
  ): Promise<ChargerView> {
    const anterior = await this.buscarComEscopo(user, id);

    const atualizado = await this.prisma.charger.update({
      where: { id },
      data: {
        name: dto.name,
        manufacturer: dto.manufacturer,
        model: dto.model,
        serialNumber: dto.serialNumber,
        address: dto.address,
        preAuthCeilingCents: dto.preAuthCeilingCents,
      },
      include: CHARGER_INCLUDE,
    });

    await this.audit.record({
      user,
      action: 'charger.update',
      entityType: 'Charger',
      entityId: id,
      organizationId: anterior.site.organizationId,
      previousValue: { name: anterior.name, preAuthCeilingCents: anterior.preAuthCeilingCents },
      newValue: { name: atualizado.name, preAuthCeilingCents: atualizado.preAuthCeilingCents },
      ...context,
    });

    return this.toView(atualizado);
  }

  /**
   * Bloqueia ou libera um carregador.
   *
   * Bloquear **não** derruba a conexão nem interrompe recarga em andamento: só
   * impede novas. Interromper uma recarga paga porque alguém clicou em bloquear
   * seria uma surpresa desagradável para quem está carregando.
   */
  async setOperationalStatus(
    user: AuthenticatedUser,
    id: string,
    status: 'AVAILABLE' | 'BLOCKED' | 'MAINTENANCE',
    context: { ipAddress?: string; userAgent?: string; reason?: string },
  ): Promise<ChargerView> {
    const anterior = await this.buscarComEscopo(user, id);

    const atualizado = await this.prisma.charger.update({
      where: { id },
      data: { operationalStatus: status },
      include: CHARGER_INCLUDE,
    });

    await this.audit.record({
      user,
      action: status === 'AVAILABLE' ? 'charger.unblock' : 'charger.block',
      entityType: 'Charger',
      entityId: id,
      organizationId: anterior.site.organizationId,
      previousValue: { operationalStatus: anterior.operationalStatus },
      newValue: { operationalStatus: status, motivo: context.reason },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return this.toView(atualizado);
  }

  /** Gera uma credencial nova, invalidando a anterior. */
  async rotateCredential(
    user: AuthenticatedUser,
    id: string,
    context: { ipAddress?: string; userAgent?: string },
  ): Promise<{ credential: string; chargePointIdentity: string; ocppUrl: string }> {
    const charger = await this.buscarComEscopo(user, id);
    const credential = this.gerarCredencial();

    await this.prisma.charger.update({
      where: { id },
      data: { credentialsHash: await hash(credential, ARGON2) },
    });

    await this.audit.record({
      user,
      action: 'charger.rotate_credential',
      entityType: 'Charger',
      entityId: id,
      organizationId: charger.site.organizationId,
      // A credencial em si nunca vai para o log de auditoria.
      newValue: { credencialRotacionada: true },
      ...context,
    });

    return {
      credential,
      chargePointIdentity: charger.chargePointIdentity,
      ocppUrl: this.ocppUrl(charger.chargePointIdentity),
    };
  }

  // -------------------------------------------------------------------------
  // Conectores
  // -------------------------------------------------------------------------

  async addConnector(
    user: AuthenticatedUser,
    chargerId: string,
    dto: CreateConnectorDto,
    context: { ipAddress?: string; userAgent?: string },
  ): Promise<ConnectorView> {
    const charger = await this.buscarComEscopo(user, chargerId);

    const criado = await this.prisma.connector.create({
      data: {
        chargerId,
        connectorNumber: dto.connectorNumber,
        connectorType: dto.connectorType,
        ratedPowerKw: dto.ratedPowerKw,
      },
    });

    await this.audit.record({
      user,
      action: 'connector.create',
      entityType: 'Connector',
      entityId: criado.id,
      organizationId: charger.site.organizationId,
      newValue: { connectorNumber: dto.connectorNumber, connectorType: dto.connectorType },
      ...context,
    });

    return this.connectorToView(criado, null);
  }

  async updateConnector(
    user: AuthenticatedUser,
    chargerId: string,
    connectorId: string,
    dto: UpdateConnectorDto,
    context: { ipAddress?: string; userAgent?: string },
  ): Promise<ConnectorView> {
    const charger = await this.buscarComEscopo(user, chargerId);

    const conector = await this.prisma.connector.findFirst({
      where: { id: connectorId, chargerId },
    });

    if (!conector) {
      throw new NotFoundException({
        code: 'CONNECTOR_NOT_FOUND',
        message: 'Conector não encontrado neste carregador.',
      });
    }

    const atualizado = await this.prisma.connector.update({
      where: { id: connectorId },
      data: { connectorType: dto.connectorType, ratedPowerKw: dto.ratedPowerKw },
    });

    await this.audit.record({
      user,
      action: 'connector.update',
      entityType: 'Connector',
      entityId: connectorId,
      organizationId: charger.site.organizationId,
      previousValue: { connectorType: conector.connectorType },
      newValue: { connectorType: atualizado.connectorType },
      ...context,
    });

    return this.connectorToView(atualizado, null);
  }

  // -------------------------------------------------------------------------
  // Diagnóstico
  // -------------------------------------------------------------------------

  /**
   * Mensagens OCPP de um carregador.
   *
   * Esta é a "área de diagnóstico" da seção 14 do briefing: aqui o termo técnico
   * é bem-vindo, porque quem abre esta tela quer exatamente o payload cru.
   */
  async messages(
    user: AuthenticatedUser,
    chargerId: string,
    pagination: PaginationDto,
    filtros: { action?: string; direction?: 'INBOUND' | 'OUTBOUND'; onlyErrors?: boolean } = {},
  ): Promise<Paginated<OcppMessageView>> {
    await this.buscarComEscopo(user, chargerId);

    const where = {
      chargerId,
      ...(filtros.action ? { action: filtros.action } : {}),
      ...(filtros.direction ? { direction: filtros.direction } : {}),
      ...(filtros.onlyErrors ? { errorCode: { not: null } } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.ocppMessage.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: pagination.skip,
        take: pagination.pageSize,
      }),
      this.prisma.ocppMessage.count({ where }),
    ]);

    const views: OcppMessageView[] = items.map((m) => ({
      id: m.id,
      direction: m.direction,
      messageType: m.messageType,
      messageId: m.messageId,
      action: m.action,
      payload: m.payload,
      responsePayload: m.responsePayload,
      errorCode: m.errorCode,
      errorDescription: m.errorDescription,
      correlationId: m.correlationId,
      receivedAt: m.receivedAt,
      respondedAt: m.respondedAt,
      processingDurationMs: m.processingDurationMs,
    }));

    return paginated(views, total, pagination);
  }

  // -------------------------------------------------------------------------
  // Apoio
  // -------------------------------------------------------------------------

  private async buscarComEscopo(user: AuthenticatedUser, id: string) {
    const charger = await this.prisma.charger.findUnique({
      where: { id },
      include: { site: { select: { organizationId: true } } },
    });

    if (!charger) {
      throw new NotFoundException({
        code: 'CHARGER_NOT_FOUND',
        message: 'Carregador não encontrado.',
      });
    }

    assertSameOrganization(user, charger.site.organizationId);
    return charger;
  }

  /**
   * Resolve o teto de pré-autorização pela hierarquia do ADR-0008 §9.
   * Vence o primeiro valor não-nulo, do mais específico para o mais geral.
   */
  private resolverTeto(charger: {
    preAuthCeilingCents: number | null;
    site: {
      preAuthCeilingCents: number | null;
      organization: { preAuthCeilingCents: number | null };
    };
  }): { valor: number; origem: ChargerView['preAuthCeilingSource'] } {
    if (charger.preAuthCeilingCents !== null) {
      return { valor: charger.preAuthCeilingCents, origem: 'carregador' };
    }
    if (charger.site.preAuthCeilingCents !== null) {
      return { valor: charger.site.preAuthCeilingCents, origem: 'estabelecimento' };
    }
    if (charger.site.organization.preAuthCeilingCents !== null) {
      return { valor: charger.site.organization.preAuthCeilingCents, origem: 'organização' };
    }
    return { valor: runtimeEnv.BORA_PREAUTH_CEILING_CENTS, origem: 'padrão do sistema' };
  }

  private ocppUrl(identity: string): string {
    // Em desenvolvimento é ws://localhost; em produção, wss://ocpp.sonare.com.br
    // (ADR-0009). A base vem da configuração para não ficar cravada no código.
    const base =
      runtimeEnv.NODE_ENV === 'production'
        ? 'wss://ocpp.sonare.com.br/ocpp'
        : `ws://localhost:${runtimeEnv.API_PORT}/ocpp`;

    return `${base}/${encodeURIComponent(identity)}`;
  }

  private gerarCredencial(): string {
    // 32 bytes em base64url: forte o suficiente e sem caracteres que quebrem
    // em campo de configuração de firmware.
    return randomBytes(24).toString('base64url');
  }

  private connectorToView(
    conector: {
      id: string;
      connectorNumber: number;
      connectorType: string | null;
      ratedPowerKw: Prisma.Decimal | null;
      status: string;
      errorCode: string | null;
      lastStatusAt: Date | null;
    },
    activeSessionId: string | null,
  ): ConnectorView {
    return {
      id: conector.id,
      connectorNumber: conector.connectorNumber,
      connectorType: conector.connectorType,
      // Decimal do Prisma não serializa bem em JSON; convertemos para número.
      ratedPowerKw: conector.ratedPowerKw === null ? null : Number(conector.ratedPowerKw),
      status: conector.status,
      statusLabel: labelOf(CONNECTOR_STATUS_LABELS, conector.status),
      errorCode: conector.errorCode,
      lastStatusAt: conector.lastStatusAt,
      activeSessionId,
    };
  }

  private toView(charger: ChargerComRelacoes): ChargerView {
    const teto = this.resolverTeto(charger);

    return {
      id: charger.id,
      siteId: charger.siteId,
      siteName: charger.site.name,
      organizationId: charger.site.organizationId,
      chargePointIdentity: charger.chargePointIdentity,
      name: charger.name,
      manufacturer: charger.manufacturer,
      model: charger.model,
      serialNumber: charger.serialNumber,
      firmwareVersion: charger.firmwareVersion,
      protocolVersion: charger.protocolVersion,
      address: charger.address,

      connectionStatus: charger.connectionStatus,
      connectionStatusLabel: labelOf(CONNECTION_STATUS_LABELS, charger.connectionStatus),
      operationalStatus: charger.operationalStatus,
      operationalStatusLabel: labelOf(OPERATIONAL_STATUS_LABELS, charger.operationalStatus),
      // O banco pode estar desatualizado por instantes após uma queda; o
      // registro em memória diz se dá para falar com o equipamento AGORA.
      liveConnected: this.registry.isOnline(charger.chargePointIdentity),

      lastSeenAt: charger.lastSeenAt,
      lastBootAt: charger.lastBootAt,
      lastHeartbeatAt: charger.lastHeartbeatAt,
      hasCredentials: charger.credentialsHash !== null,

      effectivePreAuthCeilingCents: teto.valor,
      preAuthCeilingSource: teto.origem,

      ocppUrl: this.ocppUrl(charger.chargePointIdentity),

      connectors: charger.connectors.map((c) => this.connectorToView(c, c.sessions[0]?.id ?? null)),
      createdAt: charger.createdAt,
      updatedAt: charger.updatedAt,
    };
  }
}
