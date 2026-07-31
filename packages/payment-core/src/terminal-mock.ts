import { MockPaymentProvider } from './mock';
import type { PaymentCapabilities } from './provider';

/**
 * Maquininha simulada (FASE 8).
 *
 * Existe por um motivo prático: o único provedor `initiatedBy: 'terminal'` que
 * havia era o `manual`, e ele só aceita o método `MANUAL` — a aprovação de uma
 * pessoa no painel. Com ele não dá para exercitar o fluxo do SmartPOS, em que o
 * motorista passa um cartão de crédito ou débito no equipamento.
 *
 * Este provedor preenche exatamente essa lacuna: aceita crédito e débito,
 * declara que a autorização nasce no terminal, e herda do mock o estado em
 * memória — inclusive a adoção de identificadores criados fora do backend, que
 * é o que permite o fechamento capturar horas depois.
 *
 * **Não é adquirente.** Nenhum dinheiro se move. Vale para desenvolvimento e
 * para o aplicativo da maquininha ser desenvolvido antes de existir SDK e
 * credencial de homologação — e o registro de provedores recusa subir com ele
 * em produção, pela mesma regra que vale para o `mock`.
 */
const CAPABILITIES: PaymentCapabilities = {
  preAuthorization: true,
  partialCapture: true,
  voidAuthorization: true,
  refund: true,
  partialRefund: true,
  // Sem PIX: no SmartPOS o Pix tem outro fluxo (QR na tela, confirmação
  // assíncrona) e declará-lo aqui faria o terminal oferecer ao motorista um
  // meio que este provedor não sabe executar.
  methods: ['CREDIT_CARD', 'DEBIT_CARD'],
  initiatedBy: 'terminal',
  // Pior caso conhecido entre as bandeiras, para o alerta do risco R-23
  // disparar cedo o bastante.
  authorizationValidityDays: 6,
};

export class TerminalMockPaymentProvider extends MockPaymentProvider {
  override readonly name = 'terminal-mock';
  override readonly capabilities = CAPABILITIES;
}
