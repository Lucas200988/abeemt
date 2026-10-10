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
import { PaymentProviderError, isPrepaidMethod, type PaymentInstrument } from '@bora/payment-core';
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
     * Pix e débito são pré-pagos, não reserva (ADR-0010; débito na emenda §6).
     *
     * O motorista já pagou; não existe "capturar depois". Por isso capturamos
     * na hora — e o que sobra não vira troco automático, exceto consumo zero,
     * que é devolvido integralmente (ADR-0010 §4).
     */
    const prePago = isPrepaidMethod(input.method);

    if (prePago) {
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
      status: prePago ? 'CAPTURED' : 'AUTHORIZED',
      prePago,
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

    /**
     * Débito e Pix na maquininha são venda IMEDIATA (ADR-0010): o dinheiro já
     * saiu quando o terminal nos avisa. Registrar como "reserva" faria a
     * conciliação tentar capturar depois — e, com a captura no terminal,
     * publicaria um `pendingCapture` que o SDK não tem como executar numa
     * venda já concluída. Então o pagamento nasce CAPTURED, com o valor pago
     * como teto.
     *
     * Provedor que captura pelo backend (simulados) precisa ter o próprio
     * estado atualizado, senão a devolução por consumo zero não acha nada
     * para devolver. Com a captura no terminal, o SDK já fez isso de verdade.
     */
    const prePago = isPrepaidMethod(input.method);
    const agora = new Date();

    if (prePago && provider.capabilities.captureLocation !== 'terminal') {
      await provider.capture(
        input.providerPaymentId,
        assertCents(input.amountAuthorizedCents, 'amountAuthorizedCents'),
      );
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: prePago ? 'CAPTURED' : 'AUTHORIZED',
        providerPaymentId: input.providerPaymentId,
        authorizedAt: agora,
        capturedAt: prePago ? agora : undefined,
        amountCapturedCents: prePago ? input.amountAuthorizedCents : undefined,
        expiresAt: input.expiresAt,
        ...this.camposDoInstrumento(input.instrument),
      },
    });

    return this.aprovarEIniciar({
      paymentId: payment.id,
      sessionId: session.id,
      status: prePago ? 'CAPTURED' : 'AUTHORIZED',
      prePago,
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
     * Pix e débito já foram cobrados no início (ADR-0010). Só há o que fazer
     * quando a energia entregue foi zero: aí a devolução é obrigatória, porque
     * o motorista pagou e não recebeu nada.
     */
    if (isPrepaidMethod(sessao.payment.method)) {
      if ((sessao.energyWh ?? 0) === 0 && sessao.payment.status === 'CAPTURED') {
        /**
         * Devolução que vive no equipamento (PlugPag: `voidPayment` é chamada
         * do SDK). Mesma mecânica da captura: congela zero em
         * `finalAmountCents`, deixa o pagamento CAPTURED e publica a pendência
         * em `pendingRefund`; quem fecha é o `refund-result` do terminal.
         */
        if (provider.capabilities.captureLocation === 'terminal') {
          await this.prisma.chargingSession.update({
            where: { id: sessionId },
            data: { finalAmountCents: 0 },
          });

          this.logger.log(
            { sessionId, paymentId: sessao.payment.id, provider: provider.name },
            'devolução pendente no terminal — nenhuma energia foi entregue',
          );

          return { settled: true, reason: 'devolução pendente no terminal: nenhuma energia' };
        }

        const devolvido = await provider.refund(providerPaymentId);
        await this.aplicarResultado(sessao.payment.id, devolvido);

        await this.prisma.chargingSession.update({
          where: { id: sessionId },
          data: { finalAmountCents: 0 },
        });

        return { settled: true, reason: 'pré-pago devolvido: nenhuma energia foi entregue' };
      }

      // Valor fixo: o que sobrou não é devolvido (ADR-0010, decisão do cliente).
      await this.prisma.chargingSession.update({
        where: { id: sessionId },
        data: { finalAmountCents: sessao.payment.amountCapturedCents },
      });

      return { settled: true, reason: 'pré-pago de valor fixo — sem ajuste' };
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

    /**
     * Captura que vive no equipamento (PlugPag: `doEffectuatePreAuto` é chamada
     * do SDK, não da API). O backend não tem como capturar — ele CONGELA o
     * valor em `finalAmountCents` e publica a pendência no
     * `GET /terminal/sessions/:id`. O aplicativo executa no SDK e confirma via
     * `POST /terminal/sessions/:id/capture-result`, que é quem fecha o
     * pagamento. Até lá ele fica AUTHORIZED — e o alerta de cobrança pendente
     * do painel continua apontando para ele, que é o comportamento certo para
     * uma maquininha que ficou muda antes de efetivar.
     */
    if (provider.capabilities.captureLocation === 'terminal') {
      await this.prisma.chargingSession.update({
        where: { id: sessionId },
        data: { finalAmountCents: aCobrar },
      });

      this.logger.log(
        { sessionId, aCobrarCents: aCobrar, provider: provider.name },
        'captura pendente no terminal — aguardando o equipamento efetivar',
      );

      return { settled: true, reason: `captura de ${aCobrar} centavos pendente no terminal` };
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

      /**
       * No PlugPag o cancelamento da reserva (`doPreAutoCancel`) também é
       * chamada do SDK, dentro do equipamento. Congelar `finalAmountCents = 0`
       * publica a pendência com valor zero — o vocabulário que o aplicativo
       * entende como "cancele a reserva" — e o pagamento só sai de AUTHORIZED
       * quando o capture-result confirmar.
       */
      if (provider.capabilities.captureLocation === 'terminal') {
        await this.prisma.chargingSession.update({
          where: { id: sessionId },
          data: { finalAmountCents: 0 },
        });

        this.logger.log(
          { sessionId, paymentId: pagamento.id, motivo },
          'cancelamento da reserva pendente no terminal',
        );
        return;
      }

      const resultado = await provider.voidPayment(providerPaymentId);
      await this.aplicarResultado(pagamento.id, resultado);

      this.logger.log({ sessionId, paymentId: pagamento.id, motivo }, 'reserva cancelada');
      return;
    }

    // Pré-pago já cobrado e recarga que não começou: devolução obrigatória.
    if (pagamento.status === 'CAPTURED' && isPrepaidMethod(pagamento.method)) {
      const provider = this.providers.get(pagamento.provider);

      // Devolução que vive no equipamento: publica a pendência (valor final
      // zero + pagamento CAPTURED) e espera o terminal executar o estorno.
      if (provider.capabilities.captureLocation === 'terminal') {
        await this.prisma.chargingSession.update({
          where: { id: sessionId },
          data: { finalAmountCents: 0 },
        });

        this.logger.log(
          { sessionId, paymentId: pagamento.id, motivo },
          'devolução do pré-pago pendente no terminal: a recarga não chegou a começar',
        );
        return;
      }

      const resultado = await provider.refund(providerPaymentId);
      await this.aplicarResultado(pagamento.id, resultado);

      this.logger.log(
        { sessionId, paymentId: pagamento.id, motivo },
        'pré-pago devolvido: a recarga não chegou a começar',
      );
    }
  }

  /**
   * O terminal confirmou (ou não) a DEVOLUÇÃO de um pré-pago sem energia.
   *
   * Espelho do `registerTerminalCaptureResult` para o outro lado do dinheiro:
   * a conciliação (ou o cancelamento de sessão que não começou) congelou
   * `finalAmountCents = 0` num pagamento CAPTURED, e este método é quem o
   * fecha em REFUNDED. Mesmas regras: valor exato, idempotente, falha mantém
   * a pendência viva (e o alerta de cobrança pendente aceso).
   */
  async registerTerminalRefundResult(input: {
    sessionId: string;
    success: boolean;
    amountRefundedCents?: number;
    errorMessage?: string;
  }): Promise<{ recorded: boolean; status: PaymentStatus | null; message: string }> {
    const sessao = await this.prisma.chargingSession.findUnique({
      where: { id: input.sessionId },
      include: { payment: true },
    });

    if (!sessao?.payment) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Esta recarga não tem pagamento associado.',
      });
    }

    const pagamento = sessao.payment;
    const provider = this.providers.get(pagamento.provider);

    if (provider.capabilities.captureLocation !== 'terminal') {
      throw new BadRequestException({
        code: 'REFUND_NOT_TERMINAL',
        message: 'A devolução deste provedor é feita pelo servidor, não pelo terminal.',
      });
    }

    if (!isPrepaidMethod(pagamento.method)) {
      throw new BadRequestException({
        code: 'NOT_PREPAID',
        message: 'Só pagamentos pré-pagos (débito e Pix) são devolvidos pelo terminal.',
      });
    }

    const esperado = pagamento.amountCapturedCents;

    // Reenvio de uma confirmação já aplicada: idempotente.
    if (pagamento.status === 'REFUNDED') {
      if (input.success) {
        return { recorded: true, status: pagamento.status, message: 'Devolução já registrada.' };
      }
      throw new ConflictException({
        code: 'ALREADY_REFUNDED',
        message: 'Este pagamento já foi devolvido.',
      });
    }

    if (pagamento.status !== 'CAPTURED' || sessao.finalAmountCents !== 0 || esperado <= 0) {
      throw new ConflictException({
        code: 'NO_PENDING_REFUND',
        message: 'Não há devolução pendente para esta recarga.',
      });
    }

    if (!input.success) {
      this.logger.warn(
        { sessionId: input.sessionId, paymentId: pagamento.id, erro: input.errorMessage },
        'terminal reportou falha ao devolver o pré-pago — pagamento segue CAPTURED',
      );
      return {
        recorded: false,
        status: pagamento.status,
        message: 'Falha registrada. A devolução continua pendente; tente novamente.',
      };
    }

    if (input.amountRefundedCents !== esperado) {
      throw new BadRequestException({
        code: 'AMOUNT_MISMATCH',
        message:
          `O valor devolvido (${input.amountRefundedCents ?? 'nenhum'}) difere do valor pago ` +
          `(${esperado}). A devolução por consumo zero é sempre integral.`,
      });
    }

    await this.prisma.payment.update({
      where: { id: pagamento.id },
      data: { status: 'REFUNDED', amountRefundedCents: esperado, refundedAt: new Date() },
    });

    this.logger.log(
      { sessionId: input.sessionId, paymentId: pagamento.id, valorCents: esperado },
      'devolução do pré-pago confirmada pelo terminal',
    );

    return { recorded: true, status: 'REFUNDED', message: 'Valor pago devolvido integralmente.' };
  }

  /**
   * Cancela, agora, uma recarga que ainda não começou — a pedido do terminal.
   *
   * O worker já expira sessões paradas (regra 11.5), mas depois de 2 a 5
   * minutos. Quem está na frente da maquininha e desistiu não pode ficar esse
   * tempo olhando um botão travado: cancela-se na hora, com o mesmo efeito
   * financeiro do worker (reserva cancelada; pré-pago devolvido).
   *
   * `updateMany` condicionado ao status fecha a corrida com o StartTransaction:
   * se o carregador iniciou neste instante, a sessão já não está em espera, o
   * cancelamento não acontece e quem chamou tenta o encerramento normal.
   * A outra metade da corrida — o carregador iniciar DEPOIS do cancelamento —
   * é tratada no tratador OCPP, que recusa o idTag de sessão cancelada.
   */
  async cancelNotStartedSession(sessionId: string, motivo: string): Promise<boolean> {
    const resultado = await this.prisma.chargingSession.updateMany({
      where: {
        id: sessionId,
        status: { in: ['PAYMENT_APPROVED', 'AWAITING_CHARGER', 'COMMAND_SENT', 'STARTING'] },
      },
      data: { status: 'CANCELLED', stoppedAt: new Date(), failureReason: motivo },
    });

    if (resultado.count === 0) return false;

    try {
      await this.voidSessionPayment(sessionId, motivo);
    } catch (error) {
      this.logger.error(
        { err: error, sessionId },
        'recarga cancelada antes de começar, mas o pagamento não pôde ser desfeito — verificar no adquirente',
      );
    }

    this.logger.log(
      { sessionId, motivo },
      'recarga cancelada antes de começar, a pedido do terminal',
    );
    return true;
  }

  /**
   * O terminal confirmou (ou não) a captura que a conciliação deixou pendente.
   *
   * É a segunda metade do circuito `captureLocation: 'terminal'`: a conciliação
   * congelou o valor em `finalAmountCents` e ESTE método é quem fecha o
   * pagamento. As regras espelham o R-32 — o terminal executa, mas não decide:
   *
   * - o VALOR aceito é exatamente o congelado pela conciliação. Confirmar um
   *   valor diferente é recusado, porque aceitaria uma captura que ninguém
   *   calculou;
   * - valor congelado zero significa "cancele a reserva" (VOIDED), nunca
   *   captura;
   * - repetir a confirmação de um pagamento já fechado devolve sucesso sem
   *   mexer em nada — a maquininha reenvia quando a resposta se perde;
   * - falha reportada mantém AUTHORIZED: o aplicativo tenta de novo e o
   *   alerta de cobrança pendente continua aceso até resolver.
   */
  async registerTerminalCaptureResult(input: {
    sessionId: string;
    success: boolean;
    amountCapturedCents?: number;
    nsu?: string;
    authorizationCode?: string;
    errorMessage?: string;
  }): Promise<{ recorded: boolean; status: PaymentStatus | null; message: string }> {
    const sessao = await this.prisma.chargingSession.findUnique({
      where: { id: input.sessionId },
      include: { payment: true },
    });

    if (!sessao?.payment) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Esta recarga não tem pagamento associado.',
      });
    }

    const pagamento = sessao.payment;
    const provider = this.providers.get(pagamento.provider);

    if (provider.capabilities.captureLocation !== 'terminal') {
      throw new BadRequestException({
        code: 'CAPTURE_NOT_TERMINAL',
        message: 'A captura deste provedor é feita pelo servidor, não pelo terminal.',
      });
    }

    if (sessao.finalAmountCents === null) {
      throw new ConflictException({
        code: 'NO_PENDING_CAPTURE',
        message: 'A conciliação ainda não definiu o valor. Aguarde e consulte a sessão de novo.',
      });
    }

    const esperado = sessao.finalAmountCents;

    // Reenvio de uma confirmação que já foi aplicada: idempotente.
    if (pagamento.status !== 'AUTHORIZED') {
      const jaFechadoCoerente =
        (esperado > 0 && pagamento.status === 'CAPTURED') ||
        (esperado === 0 && pagamento.status === 'VOIDED');

      if (input.success && jaFechadoCoerente) {
        return {
          recorded: true,
          status: pagamento.status,
          message: 'Resultado já registrado anteriormente.',
        };
      }

      throw new ConflictException({
        code: 'PAYMENT_NOT_AUTHORIZED',
        message: `O pagamento está em ${pagamento.status} e não aguarda captura.`,
      });
    }

    if (!input.success) {
      this.logger.warn(
        { sessionId: input.sessionId, paymentId: pagamento.id, erro: input.errorMessage },
        'terminal reportou falha ao efetivar a captura — pagamento segue AUTHORIZED',
      );
      return {
        recorded: false,
        status: pagamento.status,
        message: 'Falha registrada. A captura continua pendente; tente novamente.',
      };
    }

    if (esperado > 0 && input.amountCapturedCents !== esperado) {
      throw new BadRequestException({
        code: 'AMOUNT_MISMATCH',
        message:
          `O valor confirmado (${input.amountCapturedCents ?? 'nenhum'}) difere do valor ` +
          `pendente (${esperado}). O terminal executa a captura, mas não decide o valor.`,
      });
    }

    const agora = new Date();
    const novoStatus: PaymentStatus = esperado > 0 ? 'CAPTURED' : 'VOIDED';

    await this.prisma.payment.update({
      where: { id: pagamento.id },
      data: {
        status: novoStatus,
        amountCapturedCents: esperado,
        capturedAt: novoStatus === 'CAPTURED' ? agora : undefined,
        cancelledAt: novoStatus === 'VOIDED' ? agora : undefined,
        ...this.camposDoInstrumento({
          nsu: input.nsu,
          authorizationCode: input.authorizationCode,
        }),
      },
    });

    this.logger.log(
      { sessionId: input.sessionId, paymentId: pagamento.id, valorCents: esperado, novoStatus },
      novoStatus === 'CAPTURED'
        ? 'captura confirmada pelo terminal'
        : 'cancelamento da reserva confirmado pelo terminal',
    );

    return {
      recorded: true,
      status: novoStatus,
      message:
        novoStatus === 'CAPTURED'
          ? 'Cobrança do consumo confirmada.'
          : 'Reserva cancelada. Nada foi cobrado.',
    };
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

    return paginated(
      registros.map((p) => this.toView(p)),
      total,
      pagination,
    );
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
    /** Pré-pago: se a recarga não começar, o valor é DEVOLVIDO — não "nada cobrado". */
    prePago?: boolean;
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
          (input.prePago ? 'O valor pago será devolvido.' : 'Nada foi cobrado.'),
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
