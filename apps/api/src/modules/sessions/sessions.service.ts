import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CONNECTOR_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  SESSION_STATUS_LABELS,
  STOP_REASON_LABELS,
  isActiveSession,
  labelOf,
} from '@bora/contracts';
import { Prisma, type SessionStatus } from '@bora/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SessionPricingService } from '../pricing/session-pricing.service';
import { OcppCommands } from '../ocpp/ocpp-commands.service';
import { assertSameOrganization, organizationFilter } from '../../common/tenant-scope';
import { paginated, type Paginated, type PaginationDto } from '../../common/dto/pagination.dto';
import { runtimeEnv } from '../../config/runtime-env';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { ListSessionsQueryDto, StartManualSessionDto } from './dto/session.dto';

/**
 * Relações da sessão para o painel.
 *
 * Const com `satisfies`, não método: vindo de um método, o Prisma infere o
 * modelo base sem as relações e o `toView` recebe um objeto incompleto — erro
 * que o SWC dos testes não acusa.
 */
const SESSION_INCLUDE = {
  charger: { select: { id: true, name: true, chargePointIdentity: true } },
  site: { select: { name: true } },
  connector: { select: { connectorNumber: true, status: true } },
  payment: {
    select: {
      id: true,
      status: true,
      method: true,
      amountAuthorizedCents: true,
      amountCapturedCents: true,
      amountRefundedCents: true,
    },
  },
} satisfies Prisma.ChargingSessionInclude;

type SessaoComRelacoes = Prisma.ChargingSessionGetPayload<{ include: typeof SESSION_INCLUDE }>;

/**
 * Estados em que a sessão ocupa o conector.
 *
 * Espelha o índice parcial `charging_sessions_one_active_per_connector`. Se
 * divergirem, a listagem de "em andamento" deixa de refletir o que o banco
 * considera ativo.
 */
const STATUS_ATIVOS: SessionStatus[] = [
  'AWAITING_PAYMENT',
  'PAYMENT_APPROVED',
  'AWAITING_CHARGER',
  'COMMAND_SENT',
  'STARTING',
  'CHARGING',
  'FINISHING',
];

/** Um passo da linha do tempo da sessão (briefing seção 13). */
export interface TimelineStep {
  key: string;
  label: string;
  at: Date | null;
  done: boolean;
}

export interface SessionView {
  id: string;
  status: string;
  statusLabel: string;
  isActive: boolean;

  chargerId: string;
  chargerName: string;
  chargePointIdentity: string;
  siteName: string;
  connectorNumber: number;
  connectorStatusLabel: string;

  ocppTransactionId: number | null;
  idTag: string | null;

  requestedAt: Date;
  authorizedAt: Date | null;
  startedAt: Date | null;
  stoppedAt: Date | null;

  meterStartWh: number | null;
  meterStopWh: number | null;
  energyWh: number | null;
  /** Duração já decorrida, calculada agora para sessões em curso. */
  durationSeconds: number | null;

  estimatedAmountCents: number | null;
  finalAmountCents: number | null;
  ceilingAmountCents: number | null;
  /** Valor corrente, recalculado agora. Nulo em sessão sem tarifa congelada. */
  runningAmountCents: number | null;
  /** Quando o teto foi atingido e a parada automática disparou (ADR-0008 §4). */
  ceilingReachedAt: Date | null;

  stopReason: string | null;
  stopReasonLabel: string | null;
  failureReason: string | null;

  payment: {
    id: string;
    status: string;
    statusLabel: string;
    method: string;
    methodLabel: string;
    amountAuthorizedCents: number;
    amountCapturedCents: number;
    amountRefundedCents: number;
  } | null;

  createdAt: Date;
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly commands: OcppCommands,
    private readonly pricing: SessionPricingService,
  ) {}

  async list(
    user: AuthenticatedUser,
    pagination: PaginationDto,
    filtros: Pick<ListSessionsQueryDto, 'chargerId' | 'status' | 'activeOnly'> = {},
  ): Promise<Paginated<SessionView>> {
    // Montado explicitamente, e não por spread condicional: com spread, `status`
    // aparecia como string OU objeto e o tipo do Prisma rejeitava a união.
    const where: Prisma.ChargingSessionWhereInput = organizationFilter(user);

    if (filtros.chargerId) where.chargerId = filtros.chargerId;

    // `activeOnly` vence um status específico: pedir os dois é contraditório, e
    // a intenção mais provável é "o que está em curso".
    if (filtros.activeOnly) {
      where.status = { in: STATUS_ATIVOS };
    } else if (filtros.status) {
      where.status = filtros.status;
    }

    const [registros, total] = await Promise.all([
      this.prisma.chargingSession.findMany({
        where,
        include: SESSION_INCLUDE,
        orderBy: { requestedAt: 'desc' },
        skip: pagination.skip,
        take: pagination.pageSize,
      }),
      this.prisma.chargingSession.count({ where }),
    ]);

    const agora = new Date();
    return paginated(
      registros.map((s) => this.toView(s, agora)),
      total,
      pagination,
    );
  }

  async get(
    user: AuthenticatedUser,
    id: string,
  ): Promise<SessionView & { timeline: TimelineStep[] }> {
    const sessao = await this.prisma.chargingSession.findUnique({
      where: { id },
      include: SESSION_INCLUDE,
    });

    if (!sessao) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: 'Sessão não encontrada.',
      });
    }

    assertSameOrganization(user, sessao.organizationId);

    const view = this.toView(sessao, new Date());
    return { ...view, timeline: this.timeline(sessao) };
  }

  /** Últimas leituras do medidor, para o gráfico da sessão ao vivo. */
  async meterValues(user: AuthenticatedUser, id: string, limit = 60) {
    const sessao = await this.prisma.chargingSession.findUnique({
      where: { id },
      select: { id: true, organizationId: true, meterStartWh: true },
    });

    if (!sessao) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: 'Sessão não encontrada.',
      });
    }

    assertSameOrganization(user, sessao.organizationId);

    const leituras = await this.prisma.meterValue.findMany({
      where: { sessionId: id, measurand: 'Energy.Active.Import.Register', phase: null },
      orderBy: { timestamp: 'desc' },
      take: limit,
      select: { timestamp: true, value: true, unit: true },
    });

    // Devolvemos energia relativa ao início da sessão, que é o que o operador
    // quer ver — a leitura absoluta do medidor não diz nada sozinha.
    return leituras
      .reverse()
      .map((l) => {
        const bruto = Number(l.value);
        const wh = l.unit?.toLowerCase() === 'kwh' ? bruto * 1000 : bruto;
        const relativo =
          sessao.meterStartWh === null ? null : Math.max(0, Math.round(wh - sessao.meterStartWh));

        return { timestamp: l.timestamp, energyWh: relativo };
      })
      .filter((l) => l.energyWh !== null);
  }

  /**
   * Inicia uma recarga manualmente, sem pagamento.
   *
   * Existe para operação e teste (briefing seção 4.1). Cria a sessão já
   * aprovada e envia o comando. Fica marcada como sessão sem pagamento, para
   * aparecer na conciliação — uma recarga manual continua consumindo energia
   * que alguém pagou.
   */
  async startManual(
    user: AuthenticatedUser,
    dto: StartManualSessionDto,
    context: { ipAddress?: string; userAgent?: string },
  ): Promise<{
    session: SessionView;
    command: { accepted: boolean; message: string; code: string };
  }> {
    const connector = await this.prisma.connector.findUnique({
      where: { id: dto.connectorId },
      include: {
        charger: {
          include: {
            site: {
              select: {
                id: true,
                organizationId: true,
                preAuthCeilingCents: true,
                organization: { select: { preAuthCeilingCents: true } },
              },
            },
          },
        },
      },
    });

    if (!connector) {
      throw new BadRequestException({
        code: 'CONNECTOR_NOT_FOUND',
        message: 'Conector não encontrado.',
      });
    }

    assertSameOrganization(user, connector.charger.site.organizationId);

    const teto =
      dto.ceilingAmountCents ??
      connector.charger.preAuthCeilingCents ??
      connector.charger.site.preAuthCeilingCents ??
      connector.charger.site.organization.preAuthCeilingCents ??
      runtimeEnv.BORA_PREAUTH_CEILING_CENTS;

    let sessao;
    try {
      sessao = await this.prisma.chargingSession.create({
        data: {
          organizationId: connector.charger.site.organizationId,
          siteId: connector.charger.siteId,
          chargerId: connector.chargerId,
          connectorId: connector.id,
          status: 'PAYMENT_APPROVED',
          authorizedAt: new Date(),
          ceilingAmountCents: teto,
          // `failureReason` NÃO é usado aqui de propósito. Ele significa falha, e
          // uma recarga manual que funciona não é falha — o painel mostrava um
          // alerta vermelho em sessão saudável. Quem iniciou já está no
          // AuditLog (`session.manual_start`), e a ausência de `paymentId`
          // é o que identifica a sessão sem pagamento.
        },
      });
    } catch {
      // O índice parcial recusa uma segunda sessão ativa no mesmo conector
      // (regra 11.1). Aqui é o caminho real onde isso acontece.
      throw new ConflictException({
        code: 'CONNECTOR_BUSY',
        message: 'Este conector já possui uma recarga em andamento.',
      });
    }

    await this.audit.record({
      user,
      action: 'session.manual_start',
      entityType: 'ChargingSession',
      entityId: sessao.id,
      organizationId: connector.charger.site.organizationId,
      newValue: {
        chargePointIdentity: connector.charger.chargePointIdentity,
        connectorNumber: connector.connectorNumber,
        ceilingAmountCents: teto,
      },
      ...context,
    });

    const comando = await this.commands.remoteStart({ sessionId: sessao.id });

    /**
     * Se o comando não foi aceito, a sessão precisa sair do estado ativo.
     *
     * Descoberto em 2026-07-29 testando com o carregador offline: as
     * pré-condições do `remoteStart` (offline, bloqueado, conector indisponível)
     * retornam sem alterar o status, e a sessão ficava em `PAYMENT_APPROVED`
     * **para sempre** — ocupando o conector pelo índice da regra 11.1 e
     * impedindo qualquer tentativa nova. O operador ficaria sem saída pelo painel.
     *
     * No início manual não há pagamento a preservar, então encerramos na hora.
     * No fluxo com pagamento (FASE 5) a decisão é diferente: a regra 11.5 dá uma
     * janela para o carregador aparecer antes de desistir, e é o worker de
     * timeouts que vai fechar a sessão.
     */
    if (!comando.accepted) {
      const jaMudou = await this.prisma.chargingSession.findUniqueOrThrow({
        where: { id: sessao.id },
        select: { status: true },
      });

      // Só limpamos se o `remoteStart` não tiver definido um estado final.
      if (isActiveSession(jaMudou.status)) {
        await this.prisma.chargingSession.update({
          where: { id: sessao.id },
          data: {
            status: 'FAILED',
            stoppedAt: new Date(),
            failureReason: `início manual não pôde ser executado: ${comando.message}`,
          },
        });
      }
    }

    const atualizada = await this.prisma.chargingSession.findUniqueOrThrow({
      where: { id: sessao.id },
      include: SESSION_INCLUDE,
    });

    return {
      session: this.toView(atualizada, new Date()),
      command: { accepted: comando.accepted, message: comando.message, code: comando.code },
    };
  }

  /** Encerra uma recarga em andamento. */
  async stopManual(
    user: AuthenticatedUser,
    id: string,
    context: { ipAddress?: string; userAgent?: string },
  ): Promise<{
    session: SessionView;
    command: { accepted: boolean; message: string; code: string };
  }> {
    const sessao = await this.prisma.chargingSession.findUnique({
      where: { id },
      select: { id: true, organizationId: true, status: true },
    });

    if (!sessao) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: 'Sessão não encontrada.',
      });
    }

    assertSameOrganization(user, sessao.organizationId);

    await this.audit.record({
      user,
      action: 'session.manual_stop',
      entityType: 'ChargingSession',
      entityId: id,
      organizationId: sessao.organizationId,
      previousValue: { status: sessao.status },
      ...context,
    });

    const comando = await this.commands.remoteStop({ sessionId: id });

    const atualizada = await this.prisma.chargingSession.findUniqueOrThrow({
      where: { id },
      include: SESSION_INCLUDE,
    });

    return {
      session: this.toView(atualizada, new Date()),
      command: { accepted: comando.accepted, message: comando.message, code: comando.code },
    };
  }

  /**
   * Cancela uma sessão que ainda não começou (briefing seção 4.1).
   *
   * Só vale antes do início: uma recarga em curso precisa ser **parada**, não
   * cancelada, porque energia já foi entregue e há leitura de medidor a fechar.
   */
  async cancel(
    user: AuthenticatedUser,
    id: string,
    reason: string | undefined,
    context: { ipAddress?: string; userAgent?: string },
  ): Promise<SessionView> {
    const sessao = await this.prisma.chargingSession.findUnique({
      where: { id },
      select: { id: true, organizationId: true, status: true, ocppTransactionId: true },
    });

    if (!sessao) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: 'Sessão não encontrada.',
      });
    }

    assertSameOrganization(user, sessao.organizationId);

    if (sessao.ocppTransactionId !== null) {
      throw new ConflictException({
        code: 'SESSION_ALREADY_STARTED',
        message: 'Esta recarga já começou. Use "Parar recarga" em vez de cancelar.',
      });
    }

    if (!isActiveSession(sessao.status)) {
      throw new ConflictException({
        code: 'SESSION_NOT_CANCELLABLE',
        message: 'Esta sessão já está encerrada.',
      });
    }

    const atualizada = await this.prisma.chargingSession.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        stoppedAt: new Date(),
        failureReason: reason
          ? `cancelada pelo painel: ${reason}`
          : `cancelada pelo painel por ${user.email}`,
      },
      include: SESSION_INCLUDE,
    });

    await this.audit.record({
      user,
      action: 'session.cancel',
      entityType: 'ChargingSession',
      entityId: id,
      organizationId: sessao.organizationId,
      previousValue: { status: sessao.status },
      newValue: { status: 'CANCELLED', motivo: reason },
      ...context,
    });

    return this.toView(atualizada, new Date());
  }

  // -------------------------------------------------------------------------
  // Apoio
  // -------------------------------------------------------------------------

  /**
   * Linha do tempo da sessão (briefing seção 13).
   *
   * Mostra ao operador onde a sessão está — e, quando algo falha, em que ponto
   * parou. É a diferença entre "deu erro" e "o carregador aceitou o comando mas
   * o veículo não iniciou".
   */
  private timeline(sessao: SessaoComRelacoes): TimelineStep[] {
    return [
      {
        key: 'requested',
        label: 'Sessão criada',
        at: sessao.requestedAt,
        done: true,
      },
      {
        key: 'authorized',
        label: 'Pagamento aprovado',
        at: sessao.authorizedAt,
        done: sessao.authorizedAt !== null,
      },
      {
        key: 'command',
        label: 'Comando enviado ao carregador',
        at: sessao.commandSentAt,
        done: sessao.commandSentAt !== null,
      },
      {
        key: 'started',
        label: 'Recarga iniciada',
        at: sessao.startedAt,
        done: sessao.startedAt !== null,
      },
      {
        key: 'measured',
        label: 'Medição recebida',
        at: null,
        done: (sessao.energyWh ?? 0) > 0,
      },
      {
        key: 'stopped',
        label: 'Recarga encerrada',
        at: sessao.stoppedAt,
        done: sessao.stoppedAt !== null,
      },
      {
        key: 'amount',
        label:
          sessao.stopReason === 'CEILING_REACHED'
            ? 'Valor cobrado (encerrada por atingir o teto)'
            : 'Valor cobrado',
        at: null,
        done: sessao.finalAmountCents !== null,
      },
    ];
  }

  private toView(sessao: SessaoComRelacoes, agora: Date): SessionView {
    return {
      id: sessao.id,
      status: sessao.status,
      statusLabel: labelOf(SESSION_STATUS_LABELS, sessao.status),
      isActive: isActiveSession(sessao.status),

      chargerId: sessao.chargerId,
      chargerName: sessao.charger.name,
      chargePointIdentity: sessao.charger.chargePointIdentity,
      siteName: sessao.site.name,
      connectorNumber: sessao.connector.connectorNumber,
      connectorStatusLabel: labelOf(CONNECTOR_STATUS_LABELS, sessao.connector.status),

      ocppTransactionId: sessao.ocppTransactionId,
      idTag: sessao.idTag,

      requestedAt: sessao.requestedAt,
      authorizedAt: sessao.authorizedAt,
      startedAt: sessao.startedAt,
      stoppedAt: sessao.stoppedAt,

      meterStartWh: sessao.meterStartWh,
      meterStopWh: sessao.meterStopWh,
      energyWh: sessao.energyWh,
      // Para sessão em curso, a duração é calculada agora; para encerrada, é a
      // gravada. Sem isso o painel mostraria "—" durante toda a recarga.
      durationSeconds:
        sessao.durationSeconds ??
        (sessao.startedAt
          ? Math.max(0, Math.floor((agora.getTime() - sessao.startedAt.getTime()) / 1000))
          : null),

      estimatedAmountCents: sessao.estimatedAmountCents,
      finalAmountCents: sessao.finalAmountCents,
      ceilingAmountCents: sessao.ceilingAmountCents,
      // Recalculado a cada leitura em vez de guardado: gravar a cada MeterValues
      // daria uma escrita por minuto por sessão sem nenhum ganho — o número só
      // existe para a tela.
      runningAmountCents: isActiveSession(sessao.status)
        ? this.pricing.runningAmount(sessao, agora)
        : null,
      ceilingReachedAt: sessao.ceilingReachedAt,

      stopReason: sessao.stopReason,
      stopReasonLabel: sessao.stopReason ? labelOf(STOP_REASON_LABELS, sessao.stopReason) : null,
      failureReason: sessao.failureReason,

      payment: sessao.payment
        ? {
            id: sessao.payment.id,
            status: sessao.payment.status,
            statusLabel: labelOf(PAYMENT_STATUS_LABELS, sessao.payment.status),
            method: sessao.payment.method,
            methodLabel: labelOf(PAYMENT_METHOD_LABELS, sessao.payment.method),
            amountAuthorizedCents: sessao.payment.amountAuthorizedCents,
            amountCapturedCents: sessao.payment.amountCapturedCents,
            amountRefundedCents: sessao.payment.amountRefundedCents,
          }
        : null,

      createdAt: sessao.createdAt,
    };
  }
}
