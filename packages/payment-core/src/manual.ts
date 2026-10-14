import { assertCents, type Cents } from '@bora/contracts';
import { MockPaymentProvider } from './mock';
import type { PaymentCapabilities, PaymentResult } from './provider';

/**
 * Aprovação manual pelo operador.
 *
 * Serve para o teste com o WEMOB real (FASE 4) e para atendimento excepcional:
 * o operador confirma no painel que recebeu o valor por fora, e a recarga
 * começa. Não há adquirente envolvido.
 *
 * Herda do mock porque o comportamento de estados é o mesmo — o que muda é a
 * semântica: aqui não existe "recusado pelo emissor", existe "o operador não
 * aprovou". E `initiatedBy` é `terminal` porque a autorização acontece fora do
 * sistema: na decisão de uma pessoa.
 */
const CAPABILITIES: PaymentCapabilities = {
  preAuthorization: true,
  partialCapture: true,
  voidAuthorization: true,
  refund: true,
  partialRefund: true,
  methods: ['MANUAL'],
  initiatedBy: 'terminal',
  // Não expira: quem controla é o operador.
  authorizationValidityDays: null,
};

export class ManualPaymentProvider extends MockPaymentProvider {
  override readonly name = 'manual';
  override readonly capabilities = CAPABILITIES;

  /**
   * Registra que o operador aprovou. O valor é o teto da sessão.
   */
  async approve(amountCents: Cents, idempotencyKey: string): Promise<PaymentResult> {
    return this.authorize({
      amountCents: assertCents(amountCents),
      method: 'MANUAL',
      idempotencyKey,
      description: 'aprovação manual pelo operador',
    });
  }
}
