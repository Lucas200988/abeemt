import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SESSION_STATUS_LABELS, isActiveSession, labelOf } from '@bora/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentProviderRegistry } from '../payments/payment-provider.registry';
import { SessionPricingService } from '../pricing/session-pricing.service';
import { OcppCommands } from '../ocpp/ocpp-commands.service';
import type { TerminalIdentity } from './terminal.guard';
import type { TerminalAuthorizationDto } from './dto/terminal.dto';

/**
 * O que a maquininha pode fazer (FASE 8, caminho A).
 *
 * A regra que organiza este arquivo inteiro: **o terminal informa o que
 * aconteceu no cartão, e nada além disso.** Conector, provedor, tarifa e teto
 * são resolvidos aqui, no servidor, a partir do cadastro do próprio terminal.
 *
 * É a mitigação do risco R-32 (token de terminal furtado). Um token roubado de
 * um poste consegue, no máximo, mexer no conector daquele poste — não em outro
 * carregador, não em outro estabelecimento, e não com um provedor simulado.
 */

/** O que a tela da maquininha precisa mostrar antes de passar o cartão. */
export interface TerminalContext {
  terminal: { id: string; name: string };
  connector: {
    id: string;
    label: string;
    /** Estado OCPP do conector, para a tela dizer "fora de serviço". */
    status: string;
    available: boolean;
  };
  tariff: {
    name: string;
    pricePerKwhCents: number;
    connectionFeeCents: number;
    pricePerMinuteCents: number;
    idleFeePerMinuteCents: number;
  };
  /** Valor a pré-autorizar no cartão, em centavos (ADR-0008 §9). */
  preAuthAmountCents: number;
  /** Teto efetivo da recarga, em centavos. Nunca maior que o pré-autorizado. */
  ceilingAmountCents: number;
  /** Meios que o provedor configurado sabe executar neste terminal. */
  methods: string[];
  /** Sessão em andamento neste conector, se houver. */
  activeSessionId: string | null;
}

/** Estado da recarga, no vocabulário da tela do motorista. */
export interface TerminalSessionView {
  sessionId: string;
  status: string;
  statusLabel: string;
  active: boolean;
  energyWh: number;
  durationSeconds: number;
  /** Valor corrente, recalculado agora. Nulo em sessão sem tarifa congelada. */
  runningAmountCents: number | null;
  finalAmountCents: number | null;
  ceilingAmountCents: number | null;
  amountAuthorizedCents: number | null;
  amountCapturedCents: number | null;
  /** Mensagem pronta para a tela, em português. */
  message: string;
}

@Injectable()
export class TerminalSessionService {
  private readonly logger = new Logger(TerminalSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly providers: PaymentProviderRegistry,
    private readonly pricing: SessionPricingService,
    private readonly commands: OcppCommands,
    private readonly audit: AuditService,
  ) {}

  /**
   * Tudo o que a tela precisa antes de o motorista passar o cartão.
   *
   * O valor a pré-autorizar sai daqui, do servidor. Se saísse do aplicativo,
   * mudar o teto exigiria atualizar o aplicativo de cada maquininha instalada.
   */
  async context(terminal: TerminalIdentity): Promise<TerminalContext> {
    const conector = await this.prisma.connector.findUniqueOrThrow({
      where: { id: terminal.connectorId },
      select: {
        id: true,
        connectorNumber: true,
        status: true,
        charger: { select: { name: true, operationalStatus: true } },
      },
    });

    const termos = await this.pricing.resolveTerms({ connectorId: terminal.connectorId });

    const sessaoAtiva = await this.prisma.chargingSession.findFirst({
      where: { connectorId: terminal.connectorId, stoppedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    });

    const provider = this.providers.terminalDefault();

    return {
      terminal: { id: terminal.id, name: terminal.name },
      connector: {
        id: conector.id,
        label: `${conector.charger.name} — conector ${conector.connectorNumber}`,
        status: conector.status,
        available:
          conector.charger.operationalStatus === 'AVAILABLE' &&
          (conector.status === 'AVAILABLE' || conector.status === 'PREPARING'),
      },
      tariff: {
        name: termos.snapshot.name,
        pricePerKwhCents: termos.snapshot.pricePerKwhCents,
        connectionFeeCents: termos.snapshot.connectionFeeCents,
        pricePerMinuteCents: termos.snapshot.pricePerMinuteCents,
        idleFeePerMinuteCents: termos.snapshot.idleFeePerMinuteCents,
      },
      preAuthAmountCents: termos.preAuthCeilingCents,
      ceilingAmountCents: termos.ceilingAmountCents,
      methods: provider.capabilities.methods,
      activeSessionId: sessaoAtiva && isActiveSession(sessaoAtiva.status) ? sessaoAtiva.id : null,
    };
  }

  /**
   * Registra a pré-autorização feita no equipamento e manda o carregador ligar.
   *
   * Nenhuma chamada a adquirente parte daqui: o dinheiro já foi reservado pelo
   * SDK do fabricante, na maquininha. O nosso papel é guardar o resultado,
   * amarrá-lo ao conector certo e iniciar a recarga.
   */
  async authorize(terminal: TerminalIdentity, dto: TerminalAuthorizationDto) {
    const provider = this.providers.terminalDefault();

    if (!provider.capabilities.methods.includes(dto.method)) {
      throw new BadRequestException({
        code: 'METHOD_NOT_SUPPORTED',
        message: `O provedor configurado não aceita ${dto.method}.`,
      });
    }

    /**
     * O valor reservado não pode passar do teto configurado.
     *
     * O aplicativo da maquininha recebe o valor pelo `/terminal/me` e deveria
     * usá-lo; recusar quem manda mais é o que impede que um erro no aplicativo —
     * ou um token furtado — reserve um valor que ninguém autorizou.
     */
    const termos = await this.pricing.resolveTerms({ connectorId: terminal.connectorId });

    if (dto.amountAuthorizedCents > termos.preAuthCeilingCents) {
      throw new BadRequestException({
        code: 'AMOUNT_ABOVE_CEILING',
        message:
          `O valor reservado (${dto.amountAuthorizedCents}) está acima do teto configurado ` +
          `(${termos.preAuthCeilingCents}). Cancele a autorização no terminal.`,
      });
    }

    const resultado = await this.payments.recordTerminalAuthorization({
      // Do cadastro do terminal, NUNCA do corpo da requisição (risco R-32).
      connectorId: terminal.connectorId,
      provider: provider.name,
      providerPaymentId: dto.providerPaymentId,
      method: dto.method,
      amountAuthorizedCents: dto.amountAuthorizedCents,
      idempotencyKey: dto.idempotencyKey,
      terminalId: terminal.name,
      terminalRefId: terminal.id,
      instrument: {
        cardBrand: dto.cardBrand,
        cardLastFour: dto.cardLastFour,
        nsu: dto.nsu,
        authorizationCode: dto.authorizationCode,
        terminalId: terminal.name,
      },
    });

    await this.audit.record({
      action: 'terminal.authorization',
      entityType: 'Payment',
      entityId: resultado.paymentId,
      organizationId: terminal.organizationId,
      newValue: {
        terminalId: terminal.id,
        sessionId: resultado.sessionId,
        method: dto.method,
        amountAuthorizedCents: dto.amountAuthorizedCents,
        approved: resultado.approved,
      },
    });

    this.logger.log(
      {
        terminalId: terminal.id,
        connectorId: terminal.connectorId,
        sessionId: resultado.sessionId,
        aprovado: resultado.approved,
      },
      'autorização registrada pela maquininha',
    );

    return resultado;
  }

  /** Estado da recarga, para a tela da maquininha atualizar sozinha. */
  async session(terminal: TerminalIdentity, sessionId: string): Promise<TerminalSessionView> {
    const sessao = await this.buscarSessaoDoTerminal(terminal, sessionId);
    const agora = new Date();

    const inicio = sessao.startedAt ?? sessao.requestedAt;
    const fim = sessao.stoppedAt ?? agora;
    const durationSeconds =
      sessao.durationSeconds ?? Math.max(0, Math.floor((fim.getTime() - inicio.getTime()) / 1000));

    const corrente = sessao.stoppedAt
      ? null
      : this.pricing.runningAmount({
          tariffSnapshot: sessao.tariffSnapshot,
          energyWh: sessao.energyWh,
          startedAt: sessao.startedAt,
          idleSeconds: sessao.idleSeconds,
          ceilingAmountCents: sessao.ceilingAmountCents,
        });

    return {
      sessionId: sessao.id,
      status: sessao.status,
      statusLabel: labelOf(SESSION_STATUS_LABELS, sessao.status),
      active: isActiveSession(sessao.status),
      energyWh: sessao.energyWh ?? 0,
      durationSeconds,
      runningAmountCents: corrente,
      finalAmountCents: sessao.finalAmountCents,
      ceilingAmountCents: sessao.ceilingAmountCents,
      amountAuthorizedCents: sessao.payment?.amountAuthorizedCents ?? null,
      amountCapturedCents: sessao.payment?.amountCapturedCents ?? null,
      message: this.mensagemDaTela(sessao.status, sessao.ceilingReachedAt !== null),
    };
  }

  /**
   * O motorista aperta "encerrar" na maquininha.
   *
   * A cobrança **não** acontece aqui: quem cobra é o worker de conciliação,
   * depois que o carregador confirmar a parada e a leitura final do medidor
   * chegar. Cobrar agora seria faturar um consumo que ainda pode subir.
   */
  async stop(
    terminal: TerminalIdentity,
    sessionId: string,
    reason?: string,
  ): Promise<TerminalSessionView & { command: { accepted: boolean; message: string } }> {
    const sessao = await this.buscarSessaoDoTerminal(terminal, sessionId);

    if (!isActiveSession(sessao.status)) {
      return {
        ...(await this.session(terminal, sessionId)),
        command: { accepted: false, message: 'Esta recarga já foi encerrada.' },
      };
    }

    await this.audit.record({
      action: 'terminal.stop_session',
      entityType: 'ChargingSession',
      entityId: sessionId,
      organizationId: terminal.organizationId,
      previousValue: { status: sessao.status },
      newValue: { terminalId: terminal.id, motivo: reason },
    });

    const comando = await this.commands.remoteStop({ sessionId });

    return {
      ...(await this.session(terminal, sessionId)),
      command: {
        accepted: comando.accepted,
        message: comando.accepted
          ? 'Encerrando a recarga. Aguarde o desligamento e retire o cabo.'
          : `Não conseguimos encerrar agora: ${comando.message}`,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Apoio
  // ---------------------------------------------------------------------------

  /**
   * Busca a sessão exigindo que ela seja do conector deste terminal.
   *
   * É a segunda metade da mitigação do risco R-32: sem esta verificação, um
   * token furtado consultaria e **encerraria** a recarga de qualquer motorista
   * da plataforma pelo id da sessão.
   */
  private async buscarSessaoDoTerminal(terminal: TerminalIdentity, sessionId: string) {
    const sessao = await this.prisma.chargingSession.findUnique({
      where: { id: sessionId },
      include: {
        payment: {
          select: { amountAuthorizedCents: true, amountCapturedCents: true, status: true },
        },
      },
    });

    if (!sessao) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: 'Recarga não encontrada.',
      });
    }

    if (sessao.connectorId !== terminal.connectorId) {
      throw new ForbiddenException({
        code: 'SESSION_FROM_ANOTHER_CONNECTOR',
        message: 'Esta recarga não é deste ponto de recarga.',
      });
    }

    return sessao;
  }

  /** Texto curto, em português, para a tela pequena da maquininha. */
  private mensagemDaTela(status: string, tetoAtingido: boolean): string {
    if (tetoAtingido && status !== 'CHARGING') {
      return 'Recarga encerrada: o valor máximo foi atingido. Você paga apenas o que consumiu.';
    }

    switch (status) {
      case 'AWAITING_PAYMENT':
        return 'Aguardando a confirmação do pagamento.';
      case 'PAYMENT_APPROVED':
      case 'AWAITING_CHARGER':
      case 'COMMAND_SENT':
        return 'Pagamento aprovado. Conecte o cabo ao veículo.';
      case 'STARTING':
        return 'Iniciando a recarga.';
      case 'CHARGING':
        return 'Carregando. Você paga apenas o que consumir.';
      case 'FINISHING':
        return 'Encerrando a recarga. Aguarde.';
      case 'COMPLETED':
        return 'Recarga concluída. Retire o cabo. Obrigado!';
      case 'DECLINED':
        return 'Pagamento não aprovado. Nada foi cobrado.';
      case 'EXPIRED':
        return 'O tempo de espera acabou e a reserva foi cancelada. Nada foi cobrado.';
      case 'FAILED':
        return 'A recarga falhou. Nada além do consumido será cobrado.';
      default:
        return 'Recarga encerrada.';
    }
  }
}
