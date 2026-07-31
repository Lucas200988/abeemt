import { assertCents, type Cents } from '@bora/contracts';
import {
  PaymentProviderError,
  type AuthorizeInput,
  type PaymentCapabilities,
  type PaymentProvider,
  type PaymentResult,
  type PaymentWebhookEvent,
} from './provider';

/**
 * Provedor simulado, para desenvolvimento e testes.
 *
 * Simula um adquirente que faz tudo certo — e, sob comando, tudo errado.
 * Um mock que só faz o caminho feliz não prova nada: os testes precisam de
 * recusa, timeout, captura acima do autorizado e webhook duplicado.
 *
 * O estado fica em memória. Não serve para produção, e por isso o construtor
 * não aceita configuração que faça parecer que serve.
 */

interface MockPayment {
  id: string;
  status: PaymentResult['status'];
  amountAuthorizedCents: number;
  amountCapturedCents: number;
  amountRefundedCents: number;
  method: AuthorizeInput['method'];
  idempotencyKey: string;
  createdAt: Date;
  expiresAt: Date;
  instrument: PaymentResult['instrument'];
}

export interface MockBehavior {
  /** Recusa toda autorização. */
  declineAll?: boolean;
  /** Lança erro de comunicação em toda chamada. */
  failAll?: boolean;
  /** Recusa a captura, simulando adquirente fora do ar. */
  failCapture?: boolean;
  /** Marca a pré-autorização como já expirada (risco R-23). */
  expireImmediately?: boolean;
}

const CAPABILITIES: PaymentCapabilities = {
  preAuthorization: true,
  partialCapture: true,
  voidAuthorization: true,
  refund: true,
  partialRefund: true,
  methods: ['CREDIT_CARD', 'DEBIT_CARD', 'PIX', 'MANUAL'],
  initiatedBy: 'backend',
  authorizationValidityDays: 5,
};

export class MockPaymentProvider implements PaymentProvider {
  // Tipados de forma ampla para que subclasses possam sobrescrever: com o tipo
  // inferido do literal, `ManualPaymentProvider` não conseguiria trocar o nome.
  readonly name: string = 'mock';
  readonly capabilities: PaymentCapabilities = CAPABILITIES;

  private readonly payments = new Map<string, MockPayment>();
  /** Índice por chave de idempotência — repetir a chave devolve o mesmo pagamento. */
  private readonly byIdempotencyKey = new Map<string, string>();
  private sequence = 0;

  constructor(private behavior: MockBehavior = {}) {}

  /** Ajusta o comportamento entre testes, sem recriar o provedor. */
  setBehavior(behavior: MockBehavior): void {
    this.behavior = behavior;
  }

  reset(): void {
    this.payments.clear();
    this.byIdempotencyKey.clear();
    this.sequence = 0;
    this.behavior = {};
  }

  async authorize(input: AuthorizeInput): Promise<PaymentResult> {
    this.falharSePreciso();
    assertCents(input.amountCents, 'amountCents');

    // Idempotência: a mesma chave devolve o mesmo pagamento, sem criar outro.
    const existente = this.byIdempotencyKey.get(input.idempotencyKey);
    if (existente) {
      return this.toResult(this.payments.get(existente)!, 'Pagamento já autorizado anteriormente.');
    }

    this.sequence += 1;
    const id = `mock_${String(this.sequence).padStart(6, '0')}`;

    if (this.behavior.declineAll) {
      const recusado: MockPayment = {
        id,
        status: 'DECLINED',
        amountAuthorizedCents: 0,
        amountCapturedCents: 0,
        amountRefundedCents: 0,
        method: input.method,
        idempotencyKey: input.idempotencyKey,
        createdAt: new Date(),
        expiresAt: new Date(),
        instrument: {},
      };

      this.payments.set(id, recusado);
      this.byIdempotencyKey.set(input.idempotencyKey, id);

      return this.toResult(recusado, 'Pagamento recusado pelo emissor do cartão.');
    }

    const agora = new Date();
    const pagamento: MockPayment = {
      id,
      status: 'AUTHORIZED',
      amountAuthorizedCents: input.amountCents,
      amountCapturedCents: 0,
      amountRefundedCents: 0,
      method: input.method,
      idempotencyKey: input.idempotencyKey,
      createdAt: agora,
      expiresAt: this.behavior.expireImmediately
        ? new Date(agora.getTime() - 1000)
        : new Date(agora.getTime() + 5 * 24 * 3600 * 1000),
      instrument:
        input.method === 'PIX'
          ? { pixEndToEndId: `E${Date.now()}${this.sequence}` }
          : {
              cardBrand: 'VISA',
              cardLastFour: '1234',
              nsu: String(100_000 + this.sequence),
              authorizationCode: String(200_000 + this.sequence),
              terminalId: input.terminalId,
            },
    };

    this.payments.set(id, pagamento);
    this.byIdempotencyKey.set(input.idempotencyKey, id);

    return this.toResult(pagamento, 'Valor reservado no cartão.');
  }

  async capture(providerPaymentId: string, amountCents: Cents): Promise<PaymentResult> {
    this.falharSePreciso();
    if (this.behavior.failCapture) {
      throw new PaymentProviderError('adquirente indisponível', 'PROVIDER_UNAVAILABLE', true);
    }

    const pagamento = this.buscar(providerPaymentId);
    assertCents(amountCents, 'amountCents');

    if (pagamento.status !== 'AUTHORIZED') {
      throw new PaymentProviderError(
        `não é possível capturar um pagamento em ${pagamento.status}`,
        'INVALID_STATE',
        false,
      );
    }

    if (pagamento.expiresAt.getTime() < Date.now()) {
      // Risco R-23: energia entregue e não faturada.
      pagamento.status = 'EXPIRED';
      throw new PaymentProviderError(
        'a pré-autorização expirou antes da captura',
        'AUTHORIZATION_EXPIRED',
        false,
      );
    }

    // Capturar acima do autorizado é recusado pelo adquirente de verdade.
    // O mock precisa recusar também, senão o teste do risco R-22 passaria em falso.
    if (amountCents > pagamento.amountAuthorizedCents) {
      throw new PaymentProviderError(
        `captura de ${amountCents} acima do autorizado (${pagamento.amountAuthorizedCents})`,
        'AMOUNT_EXCEEDS_AUTHORIZATION',
        false,
      );
    }

    // Captura de zero equivale a cancelar a reserva.
    if (amountCents === 0) {
      pagamento.status = 'VOIDED';
      return this.toResult(pagamento, 'Reserva cancelada: nada foi cobrado.');
    }

    pagamento.status = 'CAPTURED';
    pagamento.amountCapturedCents = amountCents;

    return this.toResult(pagamento, 'Valor cobrado.');
  }

  async voidPayment(providerPaymentId: string): Promise<PaymentResult> {
    this.falharSePreciso();
    const pagamento = this.buscar(providerPaymentId);

    if (pagamento.status === 'VOIDED') {
      // Idempotente: cancelar duas vezes não é erro.
      return this.toResult(pagamento, 'Reserva já estava cancelada.');
    }

    if (pagamento.status !== 'AUTHORIZED') {
      throw new PaymentProviderError(
        `não é possível cancelar a reserva de um pagamento em ${pagamento.status}`,
        'INVALID_STATE',
        false,
      );
    }

    pagamento.status = 'VOIDED';
    return this.toResult(pagamento, 'Reserva cancelada: nada foi cobrado.');
  }

  async refund(providerPaymentId: string, amountCents?: Cents): Promise<PaymentResult> {
    this.falharSePreciso();
    const pagamento = this.buscar(providerPaymentId);

    if (pagamento.status !== 'CAPTURED' && pagamento.status !== 'PARTIALLY_REFUNDED') {
      throw new PaymentProviderError(
        'só é possível devolver valor já cobrado',
        'INVALID_STATE',
        false,
      );
    }

    const disponivel = pagamento.amountCapturedCents - pagamento.amountRefundedCents;
    const valor = amountCents ?? assertCents(disponivel);

    if (valor > disponivel) {
      throw new PaymentProviderError(
        `devolução de ${valor} acima do disponível (${disponivel})`,
        'AMOUNT_EXCEEDS_CAPTURED',
        false,
      );
    }

    pagamento.amountRefundedCents += valor;
    pagamento.status =
      pagamento.amountRefundedCents >= pagamento.amountCapturedCents
        ? 'REFUNDED'
        : 'PARTIALLY_REFUNDED';

    return this.toResult(pagamento, 'Devolução realizada.');
  }

  async getPayment(providerPaymentId: string): Promise<PaymentResult> {
    return this.toResult(this.buscar(providerPaymentId), 'Consulta realizada.');
  }

  /**
   * O mock aceita um cabeçalho fixo como "assinatura".
   *
   * Não é criptografia de verdade — é para que o **caminho** de verificação
   * exista e seja testado. Um adapter real substitui isto por HMAC.
   */
  async verifyWebhook(
    _payload: unknown,
    headers: Record<string, string>,
    _rawBody?: Buffer,
  ): Promise<boolean> {
    return headers['x-mock-signature'] === 'valida';
  }

  async parseWebhook(payload: unknown): Promise<PaymentWebhookEvent> {
    const p = payload as Record<string, unknown>;

    if (typeof p?.eventId !== 'string' || typeof p?.paymentId !== 'string') {
      throw new PaymentProviderError('webhook sem eventId ou paymentId', 'MALFORMED', false);
    }

    return {
      eventId: p.eventId,
      providerPaymentId: p.paymentId,
      status: (p.status as PaymentResult['status']) ?? 'AUTHORIZED',
      amountCents: typeof p.amountCents === 'number' ? p.amountCents : undefined,
      occurredAt: new Date(),
      raw: payload,
    };
  }

  private buscar(id: string): MockPayment {
    const pagamento = this.payments.get(id);
    if (!pagamento) {
      throw new PaymentProviderError(`pagamento ${id} não encontrado`, 'NOT_FOUND', false);
    }
    return pagamento;
  }

  private falharSePreciso(): void {
    if (this.behavior.failAll) {
      throw new PaymentProviderError('falha de comunicação simulada', 'NETWORK', true);
    }
  }

  private toResult(p: MockPayment, message: string): PaymentResult {
    return {
      ok: p.status !== 'DECLINED' && p.status !== 'FAILED',
      status: p.status,
      providerPaymentId: p.id,
      amountAuthorizedCents: p.amountAuthorizedCents,
      amountCapturedCents: p.amountCapturedCents,
      amountRefundedCents: p.amountRefundedCents,
      instrument: p.instrument,
      expiresAt: p.expiresAt,
      message,
    };
  }
}
