import type { Cents } from '@bora/contracts';

/**
 * Porta de pagamento.
 *
 * O domínio nunca conhece adquirente (ADR-0004). Trocar de fornecedor é
 * escrever um adapter novo, não mexer em regra de negócio.
 *
 * A interface reflete o modelo do [ADR-0008]: pré-autorização, captura pelo
 * consumo real, e a distinção entre `void` (cancelar reserva) e `refund`
 * (devolver dinheiro já cobrado). Confundir os dois gera cobrança indevida.
 */

export type PaymentMethod = 'CREDIT_CARD' | 'DEBIT_CARD' | 'PIX' | 'MANUAL';

export type PaymentStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED'
  | 'VOIDED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'FAILED';

/**
 * Quem inicia a autorização.
 *
 * Distinção que só ficou clara ao considerar maquininha: num terminal SmartPOS,
 * a pré-autorização acontece **no próprio equipamento**, pelo SDK do fabricante.
 * Nosso backend não chama nada — ele **recebe** o resultado já autorizado.
 *
 * Num gateway web, é o contrário: nós chamamos a API para autorizar.
 *
 * Sem essa distinção, um adapter de terminal precisaria implementar um
 * `authorize()` que não faz sentido para ele.
 */
export type AuthorizationInitiator = 'backend' | 'terminal';

/**
 * O que o provedor sabe fazer.
 *
 * Declarado em código, não em documentação, para que o sistema possa **recusar
 * na inicialização** um provedor que não atende o modelo — em vez de descobrir
 * no primeiro pagamento real que não dá para capturar valor parcial.
 */
export interface PaymentCapabilities {
  /** Reserva sem cobrar. Sem isso, o ADR-0008 não se aplica. */
  preAuthorization: boolean;
  /** Capturar valor MENOR que o autorizado. É o que permite "pague o que consumiu". */
  partialCapture: boolean;
  /** Cancelar pré-autorização sem captura. */
  voidAuthorization: boolean;
  /** Devolver valor já capturado. */
  refund: boolean;
  /** Devolução parcial — obrigatória para Pix (ADR-0010 §4). */
  partialRefund: boolean;
  methods: PaymentMethod[];
  initiatedBy: AuthorizationInitiator;
  /**
   * Prazo típico, em dias, antes de a pré-autorização expirar.
   * Alimenta o alerta do risco R-23. `null` quando não se aplica.
   */
  authorizationValidityDays: number | null;
  /**
   * QUEM executa a captura de uma autorização nascida no terminal.
   *
   * `backend` (padrão quando omitido): a conciliação chama `capture()` na API
   * do provedor — o caso do e-commerce e dos simulados.
   *
   * `terminal`: a pré-autorização vive DENTRO do equipamento (PlugPag:
   * `doEffectuatePreAuto` é chamada do SDK, não da API) e o backend não tem
   * como capturá-la. A conciliação então publica a captura como PENDÊNCIA no
   * `GET /terminal/sessions/:id`, o aplicativo da maquininha executa no SDK e
   * confirma via `POST /terminal/sessions/:id/capture-result`.
   *
   * Só faz sentido em provedores `initiatedBy: 'terminal'`.
   */
  captureLocation?: 'backend' | 'terminal';
}

/** Dados que aceitamos guardar. Nunca número completo, CVV ou trilha. */
export interface PaymentInstrument {
  cardBrand?: string;
  /** Apenas os quatro últimos dígitos (briefing seção 12). */
  cardLastFour?: string;
  nsu?: string;
  authorizationCode?: string;
  terminalId?: string;
  pixEndToEndId?: string;
}

export interface AuthorizeInput {
  /** Valor a RESERVAR, em centavos. É o teto da sessão, não o valor final. */
  amountCents: Cents;
  method: PaymentMethod;
  /** Chave de idempotência. Repetir a mesma chave não pode gerar dois pagamentos. */
  idempotencyKey: string;
  description?: string;
  /** Identificador do terminal, quando houver. */
  terminalId?: string;
  metadata?: Record<string, unknown>;
}

/** Autorização já concluída no terminal, entregue ao backend para registro. */
export interface AdoptTerminalAuthorizationInput {
  /** Identificador gerado pelo terminal/adquirente. É por ele que se captura. */
  providerPaymentId: string;
  /** Valor efetivamente reservado no cartão do motorista. */
  amountAuthorizedCents: Cents;
  method: PaymentMethod;
  idempotencyKey: string;
  instrument?: PaymentInstrument;
  /** Quando a reserva expira, se o terminal informar (risco R-23). */
  expiresAt?: Date;
}

export interface PaymentResult {
  ok: boolean;
  status: PaymentStatus;
  /** Identificador do pagamento no provedor. */
  providerPaymentId: string;
  amountAuthorizedCents: number;
  amountCapturedCents: number;
  amountRefundedCents: number;
  instrument?: PaymentInstrument;
  /** Quando a pré-autorização expira, se o provedor informar. */
  expiresAt?: Date;
  /** Mensagem em português, pronta para a tela. */
  message: string;
  /** Código técnico do provedor, para diagnóstico. */
  providerCode?: string;
  raw?: unknown;
}

/** Evento recebido por webhook, já normalizado. */
export interface PaymentWebhookEvent {
  /** Identificador do evento no provedor — base da idempotência. */
  eventId: string;
  providerPaymentId: string;
  status: PaymentStatus;
  amountCents?: number;
  instrument?: PaymentInstrument;
  occurredAt: Date;
  raw: unknown;
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

/**
 * Contrato que todo adapter precisa cumprir.
 *
 * `capture` e `voidPayment` **não são opcionais** — o ADR-0008 tornou
 * pré-autorização com captura parcial o modelo do produto, e um provedor sem
 * eles não serve.
 */
export interface PaymentProvider {
  readonly name: string;
  readonly capabilities: PaymentCapabilities;

  /**
   * Reserva o valor. Só existe em provedores `initiatedBy: 'backend'`.
   *
   * Num terminal SmartPOS, a autorização acontece no equipamento e chega ao
   * backend já pronta — ver `PaymentsService.recordTerminalAuthorization`.
   */
  authorize?(input: AuthorizeInput): Promise<PaymentResult>;

  /**
   * Adota uma autorização que nasceu fora do backend.
   *
   * Só faz sentido em provedores `initiatedBy: 'terminal'`. A maquininha reserva
   * o valor pelo SDK do fabricante e nos entrega um identificador que o nosso
   * processo nunca viu — e é esse identificador que o fechamento vai capturar
   * horas depois.
   *
   * Num adquirente real isto é dispensável: a cobrança já existe no lado dele, e
   * `capture(id)` funciona. Nos provedores simulados, cujo estado vive em
   * memória, sem adoção o `capture` do fechamento falharia com `NOT_FOUND` — a
   * recarga aconteceria e o dinheiro nunca seria cobrado.
   */
  adoptTerminalAuthorization?(input: AdoptTerminalAuthorizationInput): Promise<void>;

  /** Cobra o valor real. Precisa aceitar valor menor que o autorizado. */
  capture(providerPaymentId: string, amountCents: Cents): Promise<PaymentResult>;

  /** Cancela a reserva. NÃO é estorno: nada foi cobrado. */
  voidPayment(providerPaymentId: string): Promise<PaymentResult>;

  /** Devolve dinheiro já capturado. Omitir o valor devolve tudo. */
  refund(providerPaymentId: string, amountCents?: Cents): Promise<PaymentResult>;

  getPayment(providerPaymentId: string): Promise<PaymentResult>;

  /**
   * Verifica a assinatura do webhook.
   *
   * `rawBody` são os **bytes originais** da requisição, e é sobre eles que a
   * assinatura é calculada. Reconverter o objeto já interpretado muda
   * espaçamento e ordem de chaves — a assinatura deixa de bater, e o sintoma é
   * "o adquirente manda webhook e nós recusamos todos".
   *
   * Provedores simulados podem ignorar `rawBody`; adapters reais, não.
   */
  verifyWebhook(
    payload: unknown,
    headers: Record<string, string>,
    rawBody?: Buffer,
  ): Promise<boolean>;

  parseWebhook(payload: unknown): Promise<PaymentWebhookEvent>;
}

/**
 * Confere se o provedor atende o modelo do produto.
 *
 * Chamado na inicialização. Falhar cedo e alto é melhor do que descobrir num
 * pagamento real que o provedor só captura o valor cheio — quando já há energia
 * entregue e um motorista esperando.
 */
export function assertProviderSupportsModel(
  provider: PaymentProvider,
  opts: { requirePix?: boolean } = {},
): void {
  const problemas: string[] = [];
  const c = provider.capabilities;

  if (!c.preAuthorization) {
    problemas.push('não suporta pré-autorização (ADR-0008)');
  }
  if (!c.partialCapture) {
    problemas.push(
      'não suporta captura parcial — sem isso não é possível cobrar apenas o consumido',
    );
  }
  if (!c.voidAuthorization) {
    problemas.push(
      'não suporta cancelar pré-autorização; falha antes do início cobraria o motorista',
    );
  }

  if (opts.requirePix && c.methods.includes('PIX') && !c.partialRefund) {
    // ADR-0010 §4: Pix pago sem energia entregue precisa ser devolvido.
    problemas.push(
      'aceita Pix mas não faz devolução — obrigatório para consumo zero (ADR-0010 §4)',
    );
  }

  if (problemas.length > 0) {
    throw new Error(
      `O provedor de pagamento "${provider.name}" não atende o modelo do produto:\n` +
        problemas.map((p) => `  - ${p}`).join('\n'),
    );
  }
}
