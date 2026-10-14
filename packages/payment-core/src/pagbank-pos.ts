import type { Cents } from '@bora/contracts';
import {
  PaymentProviderError,
  type AdoptTerminalAuthorizationInput,
  type PaymentCapabilities,
  type PaymentProvider,
  type PaymentResult,
  type PaymentWebhookEvent,
} from './provider';

/**
 * PagBank na MAQUININHA (PlugPag) — o provedor do piloto.
 *
 * Diferente do `pagbank` (API online), aqui o backend não fala com o PagBank.
 * Reserva, captura parcial, cancelamento, venda à vista e estorno são chamadas
 * do SDK, DENTRO do equipamento (`doPreAutoCreate`, `doEffectuatePreAuto`,
 * `doPreAutoCancel`, `doPayment`, `voidPayment`). O servidor registra o que o
 * terminal fez e publica pendências (`pendingCapture`, `pendingRefund`) que o
 * aplicativo executa e confirma — ver fase-8-maquininha.md §3.5 e §3.6.
 *
 * Por isso este provedor não tem estado nem rede. Cada método de dinheiro
 * recusa com `EXECUTED_ON_TERMINAL`: ser chamado seria um defeito de
 * orquestração, e falhar alto é melhor do que fingir um resultado.
 *
 * Procedência (terminal DEBUG Gertec GPOS780S, 2026-10-10): pré-autorização,
 * captura PARCIAL (R$ 200 → R$ 5) e cancelamento PROVADOS no equipamento.
 * Débito, Pix e estorno: assinaturas confirmadas no .aar 1.35.0 e no app demo
 * oficial; comportamento a confirmar (testes 8–11 do README do aplicativo).
 * `BORA_PAGBANK_POS_VERIFIED` registra quando a bateria inteira passou.
 */
const CAPABILITIES: PaymentCapabilities = {
  preAuthorization: true,
  partialCapture: true,
  voidAuthorization: true,
  refund: true,
  // O estorno no terminal (voidPayment) é INTEGRAL — o que o ADR-0010 §4 exige
  // para consumo zero. Devolução parcial de venda feita na maquininha é feita
  // pelo portal/aplicativo PagBank, fora deste sistema.
  partialRefund: false,
  methods: ['CREDIT_CARD', 'DEBIT_CARD', 'PIX'],
  initiatedBy: 'terminal',
  // Mesmo pior caso do adapter online: 6 a 29 dias conforme a bandeira.
  authorizationValidityDays: 6,
  captureLocation: 'terminal',
};

export class PagBankPosProvider implements PaymentProvider {
  readonly name = 'pagbank-pos';
  readonly capabilities = CAPABILITIES;

  /**
   * A transação já existe no PagBank — foi o PlugPag quem a criou. Não há
   * estado a adotar; só não registramos uma autorização sem identificador,
   * porque é ele que a maquininha usa para efetivar ou cancelar depois.
   */
  adoptTerminalAuthorization(input: AdoptTerminalAuthorizationInput): Promise<void> {
    if (!input.providerPaymentId) {
      return Promise.reject(
        new PaymentProviderError(
          'Autorização do terminal sem identificador do PlugPag.',
          'MISSING_PROVIDER_PAYMENT_ID',
          false,
        ),
      );
    }
    return Promise.resolve();
  }

  capture(providerPaymentId: string, amountCents: Cents): Promise<PaymentResult> {
    return Promise.reject(this.executadaNoTerminal('capture', providerPaymentId, amountCents));
  }

  voidPayment(providerPaymentId: string): Promise<PaymentResult> {
    return Promise.reject(this.executadaNoTerminal('voidPayment', providerPaymentId));
  }

  refund(providerPaymentId: string, amountCents?: Cents): Promise<PaymentResult> {
    return Promise.reject(
      new PaymentProviderError(
        'Venda feita na maquininha. A devolução integral por consumo zero é executada pelo ' +
          'próprio terminal (pendência de devolução). Qualquer outra devolução é feita pelo ' +
          'aplicativo ou portal PagBank — registre aqui depois.',
        'REFUND_ON_TERMINAL_OR_PORTAL',
        false,
        { providerPaymentId, amountCents },
      ),
    );
  }

  getPayment(providerPaymentId: string): Promise<PaymentResult> {
    return Promise.reject(this.executadaNoTerminal('getPayment', providerPaymentId));
  }

  /** O PlugPag não notifica por webhook: o terminal confirma pelo contrato HTTP. */
  verifyWebhook(): Promise<boolean> {
    return Promise.resolve(false);
  }

  parseWebhook(payload: unknown): Promise<PaymentWebhookEvent> {
    return Promise.reject(
      new PaymentProviderError('O PlugPag não envia webhooks.', 'NO_WEBHOOKS', false, payload),
    );
  }

  private executadaNoTerminal(
    operacao: string,
    providerPaymentId: string,
    amountCents?: Cents,
  ): PaymentProviderError {
    return new PaymentProviderError(
      `A operação "${operacao}" do pagamento ${providerPaymentId} é executada na maquininha ` +
        '(PlugPag), não pela API. Com captureLocation=terminal o servidor publica a pendência ' +
        'e o aplicativo a executa — chegar aqui é defeito de orquestração.',
      'EXECUTED_ON_TERMINAL',
      false,
      { operacao, providerPaymentId, amountCents },
    );
  }
}
