import { describe, expect, it } from 'vitest';
import { assertCents } from '@bora/contracts';
import { PagBankPosProvider } from './pagbank-pos';
import { assertProviderSupportsModel } from './provider';

/**
 * O provedor do piloto: PagBank dentro da maquininha (PlugPag).
 *
 * Não há sandbox para exercitar — o "sandbox" é o terminal DEBUG, e o que foi
 * provado nele está registrado em fase-8-maquininha.md §8.1-K. O que se testa
 * aqui é o contrato com o resto do sistema: capacidades que o registro valida
 * no boot e a recusa explícita de qualquer operação de dinheiro pela API.
 */
describe('pagbank-pos — PagBank na maquininha (PlugPag)', () => {
  const criar = () => new PagBankPosProvider();

  it('atende o modelo do produto, inclusive com Pix', () => {
    expect(() => assertProviderSupportsModel(criar(), { requirePix: true })).not.toThrow();
  });

  it('autoriza e captura NO TERMINAL, nos três meios', () => {
    const c = criar().capabilities;

    expect(c.initiatedBy).toBe('terminal');
    expect(c.captureLocation).toBe('terminal');
    expect(c.methods).toEqual(['CREDIT_CARD', 'DEBIT_CARD', 'PIX']);
    expect(c.preAuthorization).toBe(true);
    expect(c.partialCapture).toBe(true);
    expect(c.voidAuthorization).toBe(true);
    // Estorno no terminal é integral — exatamente o que o consumo zero exige.
    expect(c.refund).toBe(true);
    expect(c.partialRefund).toBe(false);
  });

  it('recusa, sem retentativa, qualquer operação de dinheiro pela API', async () => {
    const p = criar();

    for (const chamada of [
      () => p.capture('PLUGPAG-1', assertCents(500)),
      () => p.voidPayment('PLUGPAG-1'),
      () => p.getPayment('PLUGPAG-1'),
    ]) {
      await expect(chamada()).rejects.toMatchObject({
        name: 'PaymentProviderError',
        code: 'EXECUTED_ON_TERMINAL',
        retryable: false,
      });
    }

    // A devolução manual do painel precisa de um motivo que o operador entenda.
    await expect(p.refund('PLUGPAG-1')).rejects.toMatchObject({
      code: 'REFUND_ON_TERMINAL_OR_PORTAL',
      retryable: false,
      message: expect.stringContaining('portal PagBank'),
    });
  });

  it('adota a autorização sem guardar estado — e exige o identificador', async () => {
    const p = criar();
    const base = {
      amountAuthorizedCents: assertCents(20_000),
      method: 'CREDIT_CARD' as const,
      idempotencyKey: 'k1',
    };

    await expect(
      p.adoptTerminalAuthorization({ ...base, providerPaymentId: 'PLUGPAG-1' }),
    ).resolves.toBeUndefined();

    await expect(
      p.adoptTerminalAuthorization({ ...base, providerPaymentId: '' }),
    ).rejects.toMatchObject({ code: 'MISSING_PROVIDER_PAYMENT_ID' });
  });

  it('não tem webhook: o terminal confirma pelo contrato HTTP', async () => {
    const p = criar();

    expect(await p.verifyWebhook()).toBe(false);
    await expect(p.parseWebhook({})).rejects.toMatchObject({ code: 'NO_WEBHOOKS' });
  });
});
