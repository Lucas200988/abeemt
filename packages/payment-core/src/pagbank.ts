import { assertCents, type Cents } from '@bora/contracts';
import { HttpPaymentProvider, type HttpProviderConfig } from './http-provider';
import {
  PaymentProviderError,
  type AuthorizeInput,
  type PaymentCapabilities,
  type PaymentProvider,
  type PaymentResult,
  type PaymentStatus,
  type PaymentWebhookEvent,
} from './provider';

/**
 * Adapter do PagBank.
 *
 * ⚠️ **NÃO VERIFICADO CONTRA A API REAL.**
 *
 * O portal de documentação do PagBank recusa acesso automatizado (HTTP 403,
 * confirmado em 2026-07-31 em `developer.pagbank.com.br` e `docs.pagar.me`).
 * Sem poder ler o contrato, escrever caminhos e nomes de campos por suposição
 * produziria código que **parece** pronto e não é — e pagamento é o pior lugar
 * possível para isso.
 *
 * A saída foi separar o que se sabe do que se supõe:
 *
 *  * tudo que **não** depende do fornecedor está em `HttpPaymentProvider`, e é
 *    testado de verdade — prazo, retentativa, idempotência, assinatura HMAC,
 *    redação de credencial;
 *  * tudo que depende está em `CONTRATO`, abaixo, com a procedência de cada
 *    item marcada. Confirmar o adapter é conferir essa tabela contra a
 *    documentação e rodar a suíte de conformidade contra o sandbox.
 *
 * Enquanto `BORA_PAGBANK_VERIFIED` não for `true`, o registro de provedores
 * recusa este adapter. Um adapter de pagamento não verificado no ar é como se
 * perde dinheiro sem perceber.
 *
 * Ver `docs/payments/fase-7-o-que-falta.md`.
 */

/** Procedência de cada item do contrato. Honestidade explícita, não decorativa. */
type Procedencia = 'confirmado' | 'a confirmar';

interface ItemContrato<T> {
  valor: T;
  procedencia: Procedencia;
  nota?: string;
}

const item = <T>(valor: T, procedencia: Procedencia, nota?: string): ItemContrato<T> => ({
  valor,
  procedencia,
  nota,
});

/**
 * O contrato do fornecedor, em um só lugar.
 *
 * Cada campo aqui é uma pergunta a ser respondida com a documentação aberta. É
 * o único arquivo que precisa mudar quando as credenciais chegarem.
 */
export const CONTRATO = {
  baseUrlSandbox: item(
    'https://sandbox.api.pagseguro.com',
    'confirmado',
    'lido no portal oficial (Ambientes disponíveis) em 2026-08-01, trazido por Lucas',
  ),
  baseUrlProducao: item(
    'https://api.pagseguro.com',
    'confirmado',
    'idem; Transferências/Pix Bacen usam secure.api.pagseguro.com — fora do nosso escopo atual',
  ),

  /** Criação do pedido com pré-autorização. */
  criarPedido: item('/orders', 'a confirmar'),
  /** Captura de uma cobrança pré-autorizada. `{chargeId}` é substituído. */
  capturar: item('/charges/{chargeId}/capture', 'a confirmar'),
  /** Cancelamento da pré-autorização não capturada. */
  cancelar: item('/charges/{chargeId}/cancel', 'a confirmar'),
  /** Devolução de valor já capturado. */
  devolver: item(
    '/charges/{chargeId}/cancel',
    'a confirmar',
    'pode ser o mesmo caminho do cancelamento',
  ),
  consultar: item('/charges/{chargeId}', 'a confirmar'),

  /**
   * Pré-autorização é `capture: false` na cobrança.
   *
   * Este item veio de material público do PagBank e é o que sustenta o
   * ADR-0008 no fornecedor: reserva de 6 a 29 dias, com `capture_before`
   * definindo o prazo, e captura parcial suportada.
   */
  campoPreAutorizacao: item('capture', 'confirmado', 'false = pré-autoriza; true = cobra direto'),
  campoPrazoCaptura: item('capture_before', 'confirmado'),

  /** Valores em centavos, no campo `amount.value`. */
  campoValor: item('amount.value', 'a confirmar'),
  campoMoeda: item('amount.currency', 'a confirmar'),

  /** Cabeçalho que carrega a assinatura do webhook. */
  cabecalhoAssinatura: item('x-authenticity-token', 'a confirmar'),

  /** Estados do fornecedor → estados nossos. */
  mapaDeEstados: item<Record<string, PaymentStatus>>(
    {
      AUTHORIZED: 'AUTHORIZED',
      PAID: 'CAPTURED',
      AVAILABLE: 'CAPTURED',
      IN_ANALYSIS: 'PENDING',
      WAITING: 'PENDING',
      DECLINED: 'DECLINED',
      CANCELED: 'VOIDED',
      REFUNDED: 'REFUNDED',
    },
    'a confirmar',
  ),
} as const;

/** Itens que ainda precisam ser confirmados contra a documentação. */
export function pendenciasDoContrato(): string[] {
  return Object.entries(CONTRATO)
    .filter(([, item]) => (item as ItemContrato<unknown>).procedencia === 'a confirmar')
    .map(([chave]) => chave);
}

const CAPABILITIES: PaymentCapabilities = {
  preAuthorization: true,
  partialCapture: true,
  voidAuthorization: true,
  refund: true,
  partialRefund: true,
  // Pix entra quando o fluxo dele for confirmado; declarar antes faria o
  // sistema oferecer ao motorista algo que o adapter não sabe fazer.
  methods: ['CREDIT_CARD', 'DEBIT_CARD'],
  initiatedBy: 'backend',
  // 6 a 29 dias conforme a bandeira; assumimos o pior caso para o alerta do
  // risco R-23 disparar cedo o bastante.
  authorizationValidityDays: 6,
};

export interface PagBankConfig extends HttpProviderConfig {
  /**
   * Só `true` depois de o adapter ter sido exercitado contra o sandbox e a
   * suíte de conformidade ter passado. Ver `docs/payments/fase-7-o-que-falta.md`.
   */
  verificado?: boolean;
}

export class PagBankProvider extends HttpPaymentProvider implements PaymentProvider {
  readonly name = 'pagbank';
  readonly capabilities = CAPABILITIES;

  /** Falso enquanto o contrato não for confirmado contra o sandbox. */
  readonly verificado: boolean;

  constructor(config: PagBankConfig) {
    super(config);
    this.verificado = config.verificado ?? false;
  }

  async authorize(input: AuthorizeInput): Promise<PaymentResult> {
    this.exigirVerificacao();
    assertCents(input.amountCents, 'amountCents');

    const { body } = await this.request<Record<string, unknown>>(
      'POST',
      CONTRATO.criarPedido.valor,
      {
        idempotencyKey: input.idempotencyKey,
        body: {
          reference_id: input.idempotencyKey,
          charges: [
            {
              reference_id: input.idempotencyKey,
              description: input.description ?? 'Recarga de veículo elétrico',
              amount: { value: input.amountCents, currency: 'BRL' },
              payment_method: {
                type: input.method === 'DEBIT_CARD' ? 'DEBIT_CARD' : 'CREDIT_CARD',
                // O campo que faz a diferença entre reservar e cobrar.
                [CONTRATO.campoPreAutorizacao.valor]: false,
              },
            },
          ],
        },
      },
    );

    return this.toResult(this.primeiraCobranca(body), input.amountCents);
  }

  async capture(providerPaymentId: string, amountCents: Cents): Promise<PaymentResult> {
    this.exigirVerificacao();
    assertCents(amountCents, 'amountCents');

    const { body } = await this.request<Record<string, unknown>>(
      'POST',
      CONTRATO.capturar.valor.replace('{chargeId}', providerPaymentId),
      {
        idempotencyKey: `capture-${providerPaymentId}-${amountCents}`,
        body: { amount: { value: amountCents, currency: 'BRL' } },
      },
    );

    return this.toResult(body);
  }

  async voidPayment(providerPaymentId: string): Promise<PaymentResult> {
    this.exigirVerificacao();

    const { body } = await this.request<Record<string, unknown>>(
      'POST',
      CONTRATO.cancelar.valor.replace('{chargeId}', providerPaymentId),
      { idempotencyKey: `void-${providerPaymentId}` },
    );

    return this.toResult(body);
  }

  async refund(providerPaymentId: string, amountCents?: Cents): Promise<PaymentResult> {
    this.exigirVerificacao();

    const { body } = await this.request<Record<string, unknown>>(
      'POST',
      CONTRATO.devolver.valor.replace('{chargeId}', providerPaymentId),
      {
        idempotencyKey: `refund-${providerPaymentId}-${amountCents ?? 'total'}`,
        body:
          amountCents === undefined
            ? undefined
            : { amount: { value: assertCents(amountCents), currency: 'BRL' } },
      },
    );

    return this.toResult(body);
  }

  async getPayment(providerPaymentId: string): Promise<PaymentResult> {
    this.exigirVerificacao();

    const { body } = await this.request<Record<string, unknown>>(
      'GET',
      CONTRATO.consultar.valor.replace('{chargeId}', providerPaymentId),
    );

    return this.toResult(body);
  }

  /**
   * A verificação de assinatura **não** exige `verificado`.
   *
   * Ela é criptografia pura, não depende do contrato do fornecedor, e já está
   * coberta por teste. Bloqueá-la só atrapalharia o dia de ligar o sandbox.
   */
  async verifyWebhook(
    _payload: unknown,
    headers: Record<string, string>,
    rawBody?: Buffer,
  ): Promise<boolean> {
    return this.verificarAssinaturaHmac(rawBody, headers[CONTRATO.cabecalhoAssinatura.valor]);
  }

  async parseWebhook(payload: unknown): Promise<PaymentWebhookEvent> {
    const p = payload as Record<string, unknown>;
    const cobranca = this.primeiraCobranca(p);

    const eventId = typeof p?.id === 'string' ? p.id : undefined;
    const chargeId = typeof cobranca?.id === 'string' ? cobranca.id : undefined;

    if (!eventId || !chargeId) {
      throw new PaymentProviderError(
        'webhook sem identificador de evento ou de cobrança',
        'MALFORMED',
        false,
      );
    }

    return {
      eventId,
      providerPaymentId: chargeId,
      status: this.mapearEstado(cobranca),
      amountCents: this.valorDe(cobranca, 'summary.paid') ?? this.valorDe(cobranca, 'amount.value'),
      occurredAt: new Date(),
      raw: payload,
    };
  }

  // -------------------------------------------------------------------------

  /**
   * Trava de segurança.
   *
   * O adapter está escrito, mas o contrato não foi conferido. Deixá-lo operar
   * significaria descobrir a divergência com dinheiro de motorista.
   */
  private exigirVerificacao(): void {
    if (this.verificado) return;

    throw new PaymentProviderError(
      'O adapter do PagBank ainda não foi verificado contra o sandbox. ' +
        `Itens pendentes no contrato: ${pendenciasDoContrato().join(', ')}. ` +
        'Ver docs/payments/fase-7-o-que-falta.md.',
      'ADAPTER_NOT_VERIFIED',
      false,
    );
  }

  private primeiraCobranca(body: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!body) return {};
    const charges = body.charges;
    if (Array.isArray(charges) && charges.length > 0) {
      return charges[0] as Record<string, unknown>;
    }
    return body;
  }

  private mapearEstado(cobranca: Record<string, unknown>): PaymentStatus {
    const bruto = typeof cobranca.status === 'string' ? cobranca.status.toUpperCase() : '';
    // Estado desconhecido vira FAILED, e não algo otimista: tratar o que não se
    // entende como sucesso é como se confirma recarga sem pagamento.
    return CONTRATO.mapaDeEstados.valor[bruto] ?? 'FAILED';
  }

  /** Lê um valor em centavos por caminho pontilhado, sem confiar no formato. */
  private valorDe(objeto: Record<string, unknown>, caminho: string): number | undefined {
    const valor = caminho
      .split('.')
      .reduce<unknown>((atual, chave) => (atual as Record<string, unknown>)?.[chave], objeto);

    return typeof valor === 'number' && Number.isInteger(valor) ? valor : undefined;
  }

  private toResult(cobranca: Record<string, unknown>, autorizadoFallback = 0): PaymentResult {
    const status = this.mapearEstado(cobranca);
    const autorizado = this.valorDe(cobranca, 'amount.value') ?? autorizadoFallback;
    const capturado = this.valorDe(cobranca, 'summary.paid') ?? 0;
    const devolvido = this.valorDe(cobranca, 'summary.refunded') ?? 0;

    const cartao = (cobranca.payment_method as Record<string, unknown>)?.card as
      Record<string, unknown> | undefined;

    return {
      ok: status !== 'DECLINED' && status !== 'FAILED',
      status,
      providerPaymentId: String(cobranca.id ?? ''),
      amountAuthorizedCents: autorizado,
      amountCapturedCents: capturado,
      amountRefundedCents: devolvido,
      instrument: {
        cardBrand: typeof cartao?.brand === 'string' ? cartao.brand : undefined,
        // Só os quatro últimos. O número completo nunca entra (seção 12).
        cardLastFour: typeof cartao?.last_digits === 'string' ? cartao.last_digits : undefined,
      },
      message: this.mensagemDe(status),
      providerCode: typeof cobranca.status === 'string' ? cobranca.status : undefined,
      raw: cobranca,
    };
  }

  /** Frase pronta para a tela do motorista (briefing seção 14). */
  private mensagemDe(status: PaymentStatus): string {
    switch (status) {
      case 'AUTHORIZED':
        return 'Valor reservado no cartão.';
      case 'CAPTURED':
        return 'Valor cobrado.';
      case 'VOIDED':
        return 'Reserva cancelada: nada foi cobrado.';
      case 'REFUNDED':
      case 'PARTIALLY_REFUNDED':
        return 'Devolução realizada.';
      case 'DECLINED':
        return 'Pagamento recusado pelo emissor do cartão.';
      case 'PENDING':
        return 'Pagamento em análise.';
      default:
        return 'Não foi possível concluir o pagamento.';
    }
  }
}
