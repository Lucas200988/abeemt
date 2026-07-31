import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  assertCents,
  labelOf,
} from '@bora/contracts';
import { PaymentProviderError, type PaymentInstrument } from '@bora/payment-core';
import type { PricingBreakdown } from '@bora/pricing';
import { Prisma, type PaymentMethod, type PaymentStatus } from '@bora/database';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionPricingService } from '../pricing/session-pricing.service';
import { OcppCommands } from '../ocpp/ocpp-commands.service';
import { assertSameOrganization, organizationFilter } from '../../common/tenant-scope';
import { paginated, type Paginated, type PaginationDto } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PaymentProviderRegistry } from './payment-provider.registry';

/**
 * Orquestração de pagamento e sessão (ADR-0008).
 *
 * A ordem das operações é o que impede os dois erros caros:
 *
 *  1. **Criar a sessão antes de autorizar.** Sem isso, dois motoristas pagariam
 *     pelo mesmo conector — o índice `uma sessão ativa por conector` só protege
 *     depois que a linha existe. Criando antes, o segundo pagamento é recusado
 *     ANTES de tocar no cartão.
 *  2. **Cancelar a reserva quando a recarga não começa.** Dinheiro reservado
 *     sem energia entregue é reclamação garantida.
 */

/**
 * Relações do pagamento, em const com `satisfies`.
 *
 * Vindo de um método, o Prisma infere o modelo base sem as relações e `toView`
 * recebe um objeto incompleto — erro que o SWC dos testes não acusa.
 */
const PAYMENT_INCLUDE = {
  session: {
    select: {
      id: true,
      organizationId: true,
      status: true,
      energyWh: true,
      finalAmountCents: true,
    },
  },
} satisfies Prisma.PaymentInclude;

type PagamentoComRelacoes = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

export interface PaymentView {
  id: string;
  provider: string;
  method: string;
  methodLabel: string;
  status: string;
  statusLabel: string;
  amountAuthorizedCents: number;
  amountCapturedCents: number;
  amountRefundedCents: number;
  cardBrand: string | null;
  cardLastFour: string | null;
  nsu: string | null;
  authorizedAt: Date | null;
  capturedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  session: {
    id: string;
    status: string;
    energyWh: number | null;
    finalAmountCents: number | null;
  } | null;
}

/** Resultado de uma tentativa de iniciar recarga paga. */
export interface StartPaidSessionResult {
  sessionId: string;
  paymentId: string;
  status: PaymentStatus;
  approved: boolean;
  /** Mensagem em português, pronta para a tela do motorista. */
  message: string;
  amountAuthorizedCents: number;
  ceilingAmountCents: number;
  command?: { accepted: boolean; code: string; message: string };
}

export interface StartPaidSessionInput {
  connectorId: string;
  method: PaymentMethod;
  /** Valor a reservar. Omitido, usa a hierarquia de tetos do ADR-0008 §9. */
  amountCents?: number | null;
  /** Repetir a mesma chave nunca gera dois pagamentos (regra 11.3). */
  idempotencyKey?: string;
  description?: string;
  terminalId?: string;
}

/** Autorização que já aconteceu no terminal (maquininha) — só registramos. */
export interface RecordTerminalAuthorizationInput {
  connectorId: string;
  provider: string;
  providerPaymentId: string;
  method: PaymentMethod;
  amountAuthorizedCents: number;
  idempotencyKey: string;
  instrument?: PaymentInstrument;
  terminalId?: string;
  expiresAt?: Date;
  /** Terminal cadastrado que originou a cobrança, quando veio de um (FASE 8). */
  terminalRefId?: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviderRegistry,
    private readonly pricing: SessionPricingService,
    private readonly commands: OcppCommands,
  ) {}

  // ---------------------------------------------------------------------------
  // Início da recarga paga
  // ---------------------------------------------------------------------------

  /**
   * Fluxo do motorista: reserva o valor e manda o carregador iniciar.
   *
   * Vale para provedores `initiatedBy: 'backend'`. Numa maquininha, a reserva
   * acontece no equipamento e o caminho é `recordTerminalAuthorization`.
   */
  async startPaidSession(input: StartPaidSessionInput): Promise<StartPaidSessionResult> {
    const provider = this.providers.default();

    if (!provider.authorize) {
      throw new BadRequestException({
        code: 'PROVIDER_IS_TERMINAL_INITIATED',
        message:
          `O provedor "${provider.name}" autoriza no próprio terminal. ` +
          'Use o registro de autorização do terminal.',
      });
    }

    const termos = await this.resolverTermos(input.connectorId, input.amountCents);
    const idempotencyKey = input.idempotencyKey ?? randomUUID();

    const { payment, session } = await this.criarPagamentoESessao({
      ...termos,
      connectorId: input.connectorId,
      provider: provider.name,
      method: input.method,
      idempotencyKey,
      terminalId: input.terminalId,
    });

    let resultado;
    try {
      resultado = await provider.authorize({
        amountCents: assertCents(termos.preAuthCeilingCents, 'amountCents'),
        method: input.method,
        idempotencyKey,
        description: input.description ?? 'Recarga de veículo elétrico',
        terminalId: input.terminalId,
        metadata: { sessionId: session.id },
      });
    } catch (error) {
      // Adquirente fora do ar. Nada foi reservado — encerramos a sessão para
      // liberar o conector, em vez de deixá-la ocupando o índice de ativas.
      await this.marcarFalha(payment.id, session.id, error);

      throw new ConflictException({
        code: 'PAYMENT_PROVIDER_UNAVAILABLE',
        message:
          error instanceof PaymentProviderError && error.retryable
            ? 'Não conseguimos falar com o sistema de pagamento. Tente de novo em instantes.'
            : 'Não foi possível processar o pagamento.',
      });
    }

    if (!resultado.ok || resultado.status !== 'AUTHORIZED') {
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: resultado.status,
            providerPaymentId: resultado.providerPaymentId,
            rawMetadata: { message: resultado.message } as Prisma.InputJsonValue,
          },
        }),
        this.prisma.chargingSession.update({
          where: { id: session.id },
          data: { status: 'DECLINED', stoppedAt: new Date(), failureReason: resultado.message },
        }),
      ]);

      return {
        sessionId: session.id,
        paymentId: payment.id,
        status: resultado.status,
        approved: false,
        message: resultado.message,
        amountAuthorizedCents: 0,
        ceilingAmountCents: termos.ceilingAmountCents,
      };
    }

    /**
     * Pix é pré-pago, não reserva (ADR-0010).
     *
     * O motorista já transferiu o dinheiro; não existe "capturar depois". Por
     * isso capturamos na hora — e o que sobra não vira troco automático, exceto
     * consumo zero, que é devolvido integralmente (ADR-0010 §4).
     */
    if (input.method === 'PIX') {
      const capturado = await provider.capture(
        resultado.providerPaymentId,
        assertCents(resultado.amountAuthorizedCents),
      );

      await this.aplicarResultado(payment.id, capturado);
    } else {
      await this.aplicarResultado(payment.id, resultado);
    }

    return this.aprovarEIniciar({
      paymentId: payment.id,
      sessionId: session.id,
      status: input.method === 'PIX' ? 'CAPTURED' : 'AUTHORIZED',
      amountAuthorizedCents: resultado.amountAuthorizedCents,
      ceilingAmountCents: termos.ceilingAmountCents,
    });
  }

  /**
   * Registra uma autorização feita na maquininha e inicia a recarga.
   *
   * Aqui o backend **não chama adquirente nenhum**: quando a maquininha executa
   * a pré-autorização pelo SDK do fabricante, ela devolve NSU, bandeira e código
   * de autorização, e o nosso papel é guardar isso e mandar o carregador ligar.
   *
   * É o caminho previsto para o SmartPOS (FASE 8).
   */
  async recordTerminalAuthorization(
    input: RecordTerminalAuthorizationInput,
  ): Promise<StartPaidSessionResult> {
    const provider = this.providers.get(input.provider);

    if (provider.capabilities.initiatedBy !== 'terminal') {
      throw new BadRequestException({
        code: 'PROVIDER_IS_BACKEND_INITIATED',
        message: `O provedor "${input.provider}" autoriza pelo backend, não pelo terminal.`,
      });
    }

    const termos = await this.resolverTermos(input.connectorId, input.amountAuthorizedCents);

    // Repetição da mesma chave: a maquininha reenviou. Devolvemos o que já
    // existe em vez de recusar — para o operador, a operação deu certo.
    const existente = await this.prisma.payment.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { session: { select: { id: true, ceilingAmountCents: true } } },
    });

    if (existente) {
      return {
        sessionId: existente.session?.id ?? '',
        paymentId: existente.id,
        status: existente.status,
        approved: existente.status === 'AUTHORIZED' || existente.status === 'CAPTURED',
        message: 'Pagamento já registrado anteriormente.',
        amountAuthorizedCents: existente.amountAuthorizedCents,
        ceilingAmountCents: existente.session?.ceilingAmountCents ?? termos.ceilingAmountCents,
      };
    }

    const { payment, session } = await this.criarPagamentoESessao({
      ...termos,
      // O teto é o valor que a maquininha reservou, não a hierarquia de
      // configuração: cobrar acima disso seria recusado pelo adquirente.
      preAuthCeilingCents: input.amountAuthorizedCents,
      ceilingAmountCents:
        termos.snapshot.maximumAmountCents === null
          ? input.amountAuthorizedCents
          : Math.min(input.amountAuthorizedCents, termos.snapshot.maximumAmountCents),
      connectorId: input.connectorId,
      provider: input.provider,
      method: input.method,
      idempotencyKey: input.idempotencyKey,
      terminalId: input.terminalId,
      terminalRefId: input.terminalRefId,
    });

    /**
     * O provedor precisa reconhecer o identificador que a maquininha criou.
     *
     * Sem este passo, o fechamento — que roda minutos ou horas depois — chamaria
     * `capture` com um identificador que o provedor nunca viu. Nos provedores
     * simulados isso falhava com `NOT_FOUND`: a recarga acontecia e o valor
     * nunca era cobrado, sem erro visível até a conciliação. Encontrado ao
     * ligar o fluxo da maquininha ponta a ponta na FASE 8.
     */
    await provider.adoptTerminalAuthorization?.({
      providerPaymentId: input.providerPaymentId,
      amountAuthorizedCents: assertCents(input.amountAuthorizedCents, 'amountAuthorizedCents'),
      method: input.method,
      idempotencyKey: input.idempotencyKey,
      instrument: input.instrument,
      expiresAt: input.expiresAt,
    });

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'AUTHORIZED',
        providerPaymentId: input.providerPaymentId,
        authorizedAt: new Date(),
        expiresAt: input.expiresAt,
        ...this.camposDoInstrumento(input.instrument),
      },
    });

    return this.aprovarEIniciar({
      paymentId: payment.id,
      sessionId: session.id,
      status: 'AUTHORIZED',
      amountAuthorizedCents: input.amountAuthorizedCents,
      ceilingAmountCents: termos.ceilingAmountCents,
    });
  }

  // ---------------------------------------------------------------------------
  // Fechamento
  // ---------------------------------------------------------------------------

  /**
   * Fecha a sessão: calcula o valor e cobra o que foi consumido.
   *
   * Idempotente por construção — só age em sessão encerrada cujo valor final
   * ainda não foi gravado. Chamado pelo worker de conciliação, que reexecuta até
   * dar certo: energia entregue e não faturada é o risco R-23.
   */
  async settleSession(sessionId: string): Promise<{ settled: boolean; reason: string }> {
    const sessao = await this.prisma.chargingSession.findUnique({
      where: { id: sessionId },
      include: { payment: true },
    });

    if (!sessao) return { settled: false, reason: 'sessão não encontrada' };
    if (sessao.finalAmountCents !== null) return { settled: false, reason: 'já fechada' };
    if (!sessao.stoppedAt) return { settled: false, reason: 'ainda em andamento' };

    const calculo = this.pricing.finalAmount(sessao);

    if (!calculo) {
      // Sessão sem tarifa congelada (manual ou iniciada no carregador). Fecha com
      // zero para sair da fila; a ausência de pagamento já a marca na conciliação.
      await this.prisma.chargingSession.update({
        where: { id: sessionId },
        data: { finalAmountCents: 0 },
      });

      return { settled: true, reason: 'sessão sem tarifa — fechada com valor zero' };
    }

    if (!sessao.payment) {
      await this.prisma.chargingSession.update({
        where: { id: sessionId },
        data: { finalAmountCents: calculo.totalCents },
      });

      return { settled: true, reason: 'sessão sem pagamento — valor apenas registrado' };
    }

    const provider = this.providers.get(sessao.payment.provider);
    const providerPaymentId = sessao.payment.providerPaymentId;

    if (!providerPaymentId) {
      throw new Error(`pagamento ${sessao.payment.id} sem identificador no provedor`);
    }

    /**
     * Pix já foi cobrado no início (ADR-0010). Só há o que fazer quando a
     * energia entregue foi zero: aí a devolução é obrigatória, porque o
     * motorista pagou e não recebeu nada.
     */
    if (sessao.payment.method === 'PIX') {
      if ((sessao.energyWh ?? 0) === 0 && sessao.payment.status === 'CAPTURED') {
        const devolvido = await provider.refund(providerPaymentId);
        await this.aplicarResultado(sessao.payment.id, devolvido);

        await this.prisma.chargingSession.update({
          where: { id: sessionId },
          data: { finalAmountCents: 0 },
        });

        return { settled: true, reason: 'Pix devolvido: nenhuma energia foi entregue' };
      }

      // Valor fixo: o que sobrou não é devolvido (ADR-0010, decisão do cliente).
      await this.prisma.chargingSession.update({
        where: { id: sessionId },
        data: { finalAmountCents: sessao.payment.amountCapturedCents },
      });

      return { settled: true, reason: 'Pix de valor fixo — sem ajuste' };
    }

    if (sessao.payment.status !== 'AUTHORIZED') {
      // Nada reservado para capturar. Registramos o valor calculado para a
      // conciliação enxergar a diferença.
      await this.prisma.chargingSession.update({
        where: { id: sessionId },
        data: { finalAmountCents: calculo.totalCents },
      });

      return { settled: true, reason: `pagamento em ${sessao.payment.status} — sem captura` };
    }

    // Trava final contra o risco R-22: o teto congelado na sessão pode ter sido
    // calculado com outra configuração, mas o autorizado é o limite real.
    const aCobrar = Math.min(
      this.semEntregaNaoCobra(calculo, sessao.energyWh),
      sessao.payment.amountAuthorizedCents,
    );

    if (aCobrar < calculo.totalCents) {
      this.logger.error(
        {
          sessionId,
          calculado: calculo.totalCents,
          autorizado: sessao.payment.amountAuthorizedCents,
        },
        'valor calculado acima do autorizado — cobrando apenas o autorizado',
      );
    }

    const resultado = await provider.capture(providerPaymentId, assertCents(aCobrar));
    await this.aplicarResultado(sessao.payment.id, resultado);

    await this.prisma.chargingSession.update({
      where: { id: sessionId },
      data: { finalAmountCents: aCobrar },
    });

    this.logger.log(
      {
        sessionId,
        energyWh: sessao.energyWh,
        cobradoCents: aCobrar,
        autorizadoCents: sessao.payment.amountAuthorizedCents,
      },
      aCobrar === 0 ? 'sessão sem consumo — reserva cancelada' : 'valor capturado',
    );

    return {
      settled: true,
      reason: aCobrar === 0 ? 'sem consumo: reserva cancelada' : `capturado ${aCobrar} centavos`,
    };
  }

  /**
   * Cancela a reserva de uma sessão que não vai acontecer.
   *
   * Usado quando o carregador não responde ou o veículo não inicia (regra 11.5).
   * `void`, não `refund`: nada foi cobrado, e confundir os dois deixaria um
   * estorno registrado onde não houve cobrança.
   */
  async voidSessionPayment(sessionId: string, motivo: string): Promise<void> {
    const sessao = await this.prisma.chargingSession.findUnique({
      where: { id: sessionId },
      include: { payment: true },
    });

    if (!sessao?.payment?.providerPaymentId) return;

    // Lido pelo caminho já estreitado acima: o estreitamento não acompanha o
    // alias `pagamento`.
    const providerPaymentId = sessao.payment.providerPaymentId;
    const pagamento = sessao.payment;

    if (pagamento.status === 'AUTHORIZED') {
      const provider = this.providers.get(pagamento.provider);
      const resultado = await provider.voidPayment(providerPaymentId);
      await this.aplicarResultado(pagamento.id, resultado);

      this.logger.log({ sessionId, paymentId: pagamento.id, motivo }, 'reserva cancelada');
      return;
    }

    // Pix já capturado e recarga que não começou: devolução obrigatória.
    if (pagamento.status === 'CAPTURED' && pagamento.method === 'PIX') {
      const provider = this.providers.get(pagamento.provider);
      const resultado = await provider.refund(providerPaymentId);
      await this.aplicarResultado(pagamento.id, resultado);

      this.logger.log(
        { sessionId, paymentId: pagamento.id, motivo },
        'Pix devolvido: a recarga não chegou a começar',
      );
    }
  }

  /**
   * Devolução manual, decidida por uma pessoa no painel.
   *
   * Separada da devolução automática de propósito: quem devolve, quanto e por
   * quê precisa ficar na auditoria com nome e sobrenome.
   */
  async refund(paymentId: string, amountCents?: number): Promise<{ status: PaymentStatus }> {
    const pagamento = await this.prisma.payment.findUnique({ where: { id: paymentId } });

    if (!pagamento) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Pagamento não encontrado.',
      });
    }

    if (!pagamento.providerPaymentId) {
      throw new ConflictException({
        code: 'PAYMENT_NOT_PROCESSED',
        message: 'Este pagamento nunca chegou ao provedor.',
      });
    }

    const provider = this.providers.get(pagamento.provider);

    try {
      const resultado =
        pagamento.status === 'AUTHORIZED'
          ? await provider.voidPayment(pagamento.providerPaymentId)
          : await provider.refund(
              pagamento.providerPaymentId,
              amountCents === undefined ? undefined : assertCents(amountCents),
            );

      await this.aplicarResultado(pagamento.id, resultado);
      return { status: resultado.status };
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        throw new ConflictException({ code: error.code, message: error.message });
      }
      throw error;
    }
  }

  /**
   * Recarga que não entregou energia não é cobrada.
   *
   * O cálculo da tarifa soma a taxa de conexão mesmo com zero kWh — está certo
   * do ponto de vista do preço, e é o que o `@bora/pricing` deve fazer. Mas
   * cobrar R$ 3,00 de quem plugou, esperou e não recebeu nada é a reclamação
   * mais previsível do produto, e o custo de atendê-la é maior do que o valor.
   *
   * Só vale quando o tempo também não é cobrado: numa tarifa por minuto, o
   * veículo ocupou o ponto e impediu outro motorista de usar — aí há o que
   * cobrar mesmo sem energia entregue.
   *
   * Decisão comercial, deliberada, e por isso mora aqui e não no cálculo puro.
   */
  private semEntregaNaoCobra(calculo: PricingBreakdown, energyWh: number | null): number {
    if ((energyWh ?? 0) > 0) return calculo.totalCents;
    if (calculo.timeCents > 0) return calculo.totalCents;

    return 0;
  }

  // ---------------------------------------------------------------------------
  // Consulta
  // ---------------------------------------------------------------------------

  /**
   * Lista pagamentos, escopados pela organização.
   *
   * O pagamento não tem `organizationId` próprio — ele alcança a organização
   * pela sessão. Consequência assumida: um pagamento sem sessão não aparece para
   * o administrador do estabelecimento. É o lado seguro do erro; vazar receita de
   * outro estabelecimento seria o lado caro.
   */
  async list(
    user: AuthenticatedUser,
    pagination: PaginationDto,
    filtros: { status?: PaymentStatus; method?: PaymentMethod } = {},
  ): Promise<Paginated<PaymentView>> {
    const where: Prisma.PaymentWhereInput = {};

    if (user.role !== 'SUPER_ADMIN') {
      const escopo = organizationFilter(user);
      where.session = { organizationId: escopo.organizationId };
    }

    if (filtros.status) where.status = filtros.status;
    if (filtros.method) where.method = filtros.method;

    const [registros, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: PAYMENT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.pageSize,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return paginated(registros.map((p) => this.toView(p)), total, pagination);
  }

  async get(user: AuthenticatedUser, id: string): Promise<PaymentView> {
    const pagamento = await this.prisma.payment.findUnique({
      where: { id },
      include: PAYMENT_INCLUDE,
    });

    if (!pagamento) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Pagamento não encontrado.',
      });
    }

    if (pagamento.session) {
      assertSameOrganization(user, pagamento.session.organizationId);
    } else if (user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException({
        code: 'PAYMENT_WITHOUT_SESSION',
        message: 'Este pagamento não está vinculado a nenhuma recarga sua.',
      });
    }

    return this.toView(pagamento);
  }

  /** Provedores registrados, para a tela de simulação saber o que oferecer. */
  providerInfo(): {
    default: string;
    terminal: string;
    available: { name: string; initiatedBy: string; methods: string[]; simulated: boolean }[];
  } {
    return {
      default: this.providers.default().name,
      terminal: this.providers.terminalDefault().name,
      available: this.providers.names().map((name) => {
        const p = this.providers.get(name);
        return {
          name,
          initiatedBy: p.capabilities.initiatedBy,
          methods: p.capabilities.methods,
          simulated: this.providers.simulado(name),
        };
      }),
    };
  }

  private toView(pagamento: PagamentoComRelacoes): PaymentView {
    return {
      id: pagamento.id,
      provider: pagamento.provider,
      method: pagamento.method,
      methodLabel: labelOf(PAYMENT_METHOD_LABELS, pagamento.method),
      status: pagamento.status,
      statusLabel: labelOf(PAYMENT_STATUS_LABELS, pagamento.status),
      amountAuthorizedCents: pagamento.amountAuthorizedCents,
      amountCapturedCents: pagamento.amountCapturedCents,
      amountRefundedCents: pagamento.amountRefundedCents,
      cardBrand: pagamento.cardBrand,
      cardLastFour: pagamento.cardLastFour,
      nsu: pagamento.nsu,
      authorizedAt: pagamento.authorizedAt,
      capturedAt: pagamento.capturedAt,
      expiresAt: pagamento.expiresAt,
      createdAt: pagamento.createdAt,
      session: pagamento.session
        ? {
            id: pagamento.session.id,
            status: pagamento.session.status,
            energyWh: pagamento.session.energyWh,
            finalAmountCents: pagamento.session.finalAmountCents,
          }
        : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Apoio
  // ---------------------------------------------------------------------------

  private async resolverTermos(connectorId: string, amountCents?: number | null) {
    try {
      return await this.pricing.resolveTerms({
        connectorId,
        requestedCeilingCents: amountCents ?? null,
      });
    } catch {
      throw new NotFoundException({
        code: 'CONNECTOR_NOT_FOUND',
        message: 'Conector não encontrado.',
      });
    }
  }

  /**
   * Cria pagamento e sessão juntos.
   *
   * Na mesma transação porque um pagamento sem sessão é dinheiro sem destino, e
   * uma sessão sem pagamento é energia sem cobrança. Se o conector estiver
   * ocupado, o índice parcial recusa a sessão e o pagamento some com ela — antes
   * de qualquer contato com o adquirente.
   */
  private async criarPagamentoESessao(input: {
    connectorId: string;
    organizationId: string;
    siteId: string;
    chargerId: string;
    provider: string;
    method: PaymentMethod;
    idempotencyKey: string;
    terminalId?: string;
    terminalRefId?: string;
    tariffId: string | null;
    snapshot: unknown;
    preAuthCeilingCents: number;
    ceilingAmountCents: number;
  }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const payment = await tx.payment.create({
          data: {
            provider: input.provider,
            method: input.method,
            idempotencyKey: input.idempotencyKey,
            terminalId: input.terminalId,
            terminalRefId: input.terminalRefId,
            amountAuthorizedCents: input.preAuthCeilingCents,
            status: 'PENDING',
          },
        });

        const session = await tx.chargingSession.create({
          data: {
            organizationId: input.organizationId,
            siteId: input.siteId,
            chargerId: input.chargerId,
            connectorId: input.connectorId,
            paymentId: payment.id,
            status: 'AWAITING_PAYMENT',
            tariffId: input.tariffId,
            tariffSnapshot: input.snapshot as Prisma.InputJsonValue,
            ceilingAmountCents: input.ceilingAmountCents,
          },
        });

        return { payment, session };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const alvo = String(error.meta?.target ?? '');

        throw new ConflictException(
          alvo.includes('idempotency')
            ? {
                code: 'DUPLICATE_PAYMENT',
                message: 'Este pagamento já foi registrado.',
              }
            : {
                code: 'CONNECTOR_BUSY',
                message: 'Este conector já possui uma recarga em andamento.',
              },
        );
      }

      throw error;
    }
  }

  /**
   * Marca a sessão como paga e manda o carregador iniciar.
   *
   * Se o comando não for aceito, a reserva é cancelada na hora: não faz sentido
   * segurar dinheiro do motorista por uma recarga que não vai acontecer.
   */
  private async aprovarEIniciar(input: {
    paymentId: string;
    sessionId: string;
    status: PaymentStatus;
    amountAuthorizedCents: number;
    ceilingAmountCents: number;
  }): Promise<StartPaidSessionResult> {
    await this.prisma.chargingSession.update({
      where: { id: input.sessionId },
      data: { status: 'PAYMENT_APPROVED', authorizedAt: new Date() },
    });

    const comando = await this.commands.remoteStart({ sessionId: input.sessionId });

    if (!comando.accepted) {
      await this.voidSessionPayment(input.sessionId, `comando recusado: ${comando.code}`);
    }

    return {
      sessionId: input.sessionId,
      paymentId: input.paymentId,
      status: input.status,
      approved: true,
      message: comando.accepted
        ? 'Pagamento aprovado. Conecte o cabo e aguarde o início da recarga.'
        : `Pagamento aprovado, mas a recarga não pôde começar: ${comando.message} ` +
          'Nada foi cobrado.',
      amountAuthorizedCents: input.amountAuthorizedCents,
      ceilingAmountCents: input.ceilingAmountCents,
      command: { accepted: comando.accepted, code: comando.code, message: comando.message },
    };
  }

  /** Grava no banco o estado que o provedor devolveu. */
  private async aplicarResultado(
    paymentId: string,
    resultado: {
      status: PaymentStatus;
      providerPaymentId: string;
      amountAuthorizedCents: number;
      amountCapturedCents: number;
      amountRefundedCents: number;
      instrument?: PaymentInstrument;
      expiresAt?: Date;
    },
  ): Promise<void> {
    const agora = new Date();

    await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: resultado.status,
        providerPaymentId: resultado.providerPaymentId,
        amountAuthorizedCents: resultado.amountAuthorizedCents,
        amountCapturedCents: resultado.amountCapturedCents,
        amountRefundedCents: resultado.amountRefundedCents,
        expiresAt: resultado.expiresAt,
        authorizedAt: resultado.status === 'AUTHORIZED' ? agora : undefined,
        capturedAt: resultado.status === 'CAPTURED' ? agora : undefined,
        cancelledAt: resultado.status === 'VOIDED' ? agora : undefined,
        refundedAt:
          resultado.status === 'REFUNDED' || resultado.status === 'PARTIALLY_REFUNDED'
            ? agora
            : undefined,
        ...this.camposDoInstrumento(resultado.instrument),
      },
    });
  }

  /**
   * Só os campos que temos permissão de guardar.
   *
   * Número completo, CVV e trilha magnética não têm coluna nem chegam aqui
   * (briefing seção 12). A lista é explícita para que um provedor novo, que
   * devolva mais dados, não os grave por acidente.
   */
  private camposDoInstrumento(instrument?: PaymentInstrument) {
    if (!instrument) return {};

    return {
      cardBrand: instrument.cardBrand,
      cardLastFour: instrument.cardLastFour,
      nsu: instrument.nsu,
      authorizationCode: instrument.authorizationCode,
      pixEndToEndId: instrument.pixEndToEndId,
    };
  }

  private async marcarFalha(paymentId: string, sessionId: string, error: unknown): Promise<void> {
    const detalhe = error instanceof Error ? error.message : String(error);

    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: 'FAILED', rawMetadata: { erro: detalhe } as Prisma.InputJsonValue },
      }),
      this.prisma.chargingSession.update({
        where: { id: sessionId },
        data: {
          status: 'FAILED',
          stoppedAt: new Date(),
          failureReason: `falha no pagamento: ${detalhe}`,
        },
      }),
    ]);
  }
}
