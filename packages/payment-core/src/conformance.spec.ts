import { runProviderConformance } from './conformance';
import { MockPaymentProvider } from './mock';
import { ManualPaymentProvider } from './manual';

/**
 * A suíte de conformidade aplicada aos provedores que existem hoje.
 *
 * Quando o adapter do adquirente real ganhar credenciais de sandbox, ele entra
 * aqui com uma linha — e passa a ser cobrado exatamente pelas mesmas regras.
 */

runProviderConformance('mock', () => new MockPaymentProvider());

runProviderConformance('manual', () => new ManualPaymentProvider(), {
  // O manual é `initiatedBy: 'terminal'`: quem autoriza é a decisão de uma
  // pessoa. Ele herda `authorize` do mock, então o ciclo completo roda igual.
  amountCents: 15_000,
});
