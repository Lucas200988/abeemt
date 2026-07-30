import { beforeEach, describe, expect, it } from 'vitest';
import { assertCents } from '@bora/contracts';
import { MockPaymentProvider } from './mock';
import { ManualPaymentProvider } from './manual';
import { assertProviderSupportsModel, PaymentProviderError } from './provider';

let provider: MockPaymentProvider;

beforeEach(() => {
  provider = new MockPaymentProvider();
});

/** Reserva de R$ 200 — o teto padrão do ADR-0008 §9. */
async function autorizar(valor = 20_000, chave = `k-${Math.trunc(performance.now() * 1000)}`) {
  return provider.authorize({
    amountCents: assertCents(valor),
    method: 'CREDIT_CARD',
    idempotencyKey: chave,
  });
}

describe('ciclo de vida do ADR-0008', () => {
  it('autoriza sem cobrar', async () => {
    const r = await autorizar();

    expect(r.ok).toBe(true);
    expect(r.status).toBe('AUTHORIZED');
    expect(r.amountAuthorizedCents).toBe(20_000);
    // O ponto do modelo: reservado, nada cobrado.
    expect(r.amountCapturedCents).toBe(0);
  });

  it('captura valor MENOR que o autorizado', async () => {
    const a = await autorizar();
    const c = await provider.capture(a.providerPaymentId, assertCents(6240));

    expect(c.status).toBe('CAPTURED');
    expect(c.amountCapturedCents).toBe(6240);
    expect(c.amountAuthorizedCents).toBe(20_000);
    // O saldo é liberado pelo emissor; do nosso lado, simplesmente não cobramos.
    expect(c.amountAuthorizedCents - c.amountCapturedCents).toBe(13_760);
  });

  /**
   * Risco R-22. Se o mock aceitasse, o teste da parada automática passaria em
   * falso — e o defeito só apareceria com dinheiro real.
   */
  it('recusa captura acima do autorizado', async () => {
    const a = await autorizar(10_000);

    await expect(provider.capture(a.providerPaymentId, assertCents(15_000))).rejects.toThrow(
      /acima do autorizado/,
    );
  });

  it('captura de zero equivale a cancelar a reserva', async () => {
    const a = await autorizar();
    const c = await provider.capture(a.providerPaymentId, assertCents(0));

    expect(c.status).toBe('VOIDED');
    expect(c.amountCapturedCents).toBe(0);
  });

  it('cancela a reserva sem cobrar nada', async () => {
    const a = await autorizar();
    const v = await provider.voidPayment(a.providerPaymentId);

    expect(v.status).toBe('VOIDED');
    expect(v.amountCapturedCents).toBe(0);
  });

  it('cancelar duas vezes é idempotente', async () => {
    const a = await autorizar();
    await provider.voidPayment(a.providerPaymentId);

    await expect(provider.voidPayment(a.providerPaymentId)).resolves.toMatchObject({
      status: 'VOIDED',
    });
  });

  it('não cancela reserva já capturada — aí é estorno', async () => {
    const a = await autorizar();
    await provider.capture(a.providerPaymentId, assertCents(5000));

    await expect(provider.voidPayment(a.providerPaymentId)).rejects.toThrow(/INVALID_STATE|não é possível/);
  });

  it('devolve valor já capturado, total e parcialmente', async () => {
    const a = await autorizar();
    await provider.capture(a.providerPaymentId, assertCents(10_000));

    const parcial = await provider.refund(a.providerPaymentId, assertCents(3000));
    expect(parcial.status).toBe('PARTIALLY_REFUNDED');
    expect(parcial.amountRefundedCents).toBe(3000);

    const resto = await provider.refund(a.providerPaymentId, assertCents(7000));
    expect(resto.status).toBe('REFUNDED');
    expect(resto.amountRefundedCents).toBe(10_000);
  });

  it('recusa devolução acima do capturado', async () => {
    const a = await autorizar();
    await provider.capture(a.providerPaymentId, assertCents(5000));

    await expect(provider.refund(a.providerPaymentId, assertCents(9000))).rejects.toThrow(
      /acima do disponível/,
    );
  });

  it('não devolve o que não foi cobrado', async () => {
    const a = await autorizar();

    await expect(provider.refund(a.providerPaymentId)).rejects.toThrow(/já cobrado/);
  });
});

describe('idempotência', () => {
  /**
   * Regra 11.3 e risco R-08: a mesma chave não pode gerar dois pagamentos.
   */
  it('a mesma chave devolve o mesmo pagamento', async () => {
    const primeira = await autorizar(20_000, 'chave-repetida');
    const segunda = await autorizar(20_000, 'chave-repetida');

    expect(segunda.providerPaymentId).toBe(primeira.providerPaymentId);
    expect(segunda.message).toMatch(/já autorizado/);
  });

  it('chaves diferentes geram pagamentos diferentes', async () => {
    const a = await autorizar(20_000, 'chave-a');
    const b = await autorizar(20_000, 'chave-b');

    expect(a.providerPaymentId).not.toBe(b.providerPaymentId);
  });
});

describe('falhas simuladas', () => {
  it('recusa a autorização quando o emissor nega', async () => {
    provider.setBehavior({ declineAll: true });
    const r = await autorizar();

    expect(r.ok).toBe(false);
    expect(r.status).toBe('DECLINED');
    // Mensagem pronta para a tela do motorista.
    expect(r.message).toBe('Pagamento recusado pelo emissor do cartão.');
  });

  it('sinaliza falha de comunicação como recuperável', async () => {
    provider.setBehavior({ failAll: true });

    try {
      await autorizar();
      expect.unreachable('deveria ter lançado');
    } catch (e) {
      expect(e).toBeInstanceOf(PaymentProviderError);
      // Retentativa faz sentido: o adquirente pode voltar.
      expect((e as PaymentProviderError).retryable).toBe(true);
    }
  });

  it('falha de captura é recuperável — a energia já foi entregue', async () => {
    const a = await autorizar();
    provider.setBehavior({ failCapture: true });

    try {
      await provider.capture(a.providerPaymentId, assertCents(5000));
      expect.unreachable('deveria ter lançado');
    } catch (e) {
      expect((e as PaymentProviderError).retryable).toBe(true);
    }
  });

  /** Risco R-23: energia entregue e não faturada. */
  it('recusa captura de pré-autorização expirada', async () => {
    provider.setBehavior({ expireImmediately: true });
    const a = await autorizar();

    await expect(provider.capture(a.providerPaymentId, assertCents(5000))).rejects.toThrow(
      /expirou/,
    );
  });
});

describe('dados do instrumento', () => {
  it('guarda apenas os quatro últimos dígitos do cartão', async () => {
    const a = await autorizar();

    expect(a.instrument?.cardLastFour).toHaveLength(4);
    expect(a.instrument?.cardBrand).toBeTruthy();
    expect(a.instrument?.nsu).toBeTruthy();
    // O número completo nunca aparece (briefing seção 12).
    expect(JSON.stringify(a.instrument)).not.toMatch(/\d{13,}/);
  });

  it('Pix traz o identificador ponta a ponta, não dados de cartão', async () => {
    const r = await provider.authorize({
      amountCents: assertCents(3000),
      method: 'PIX',
      idempotencyKey: 'pix-1',
    });

    expect(r.instrument?.pixEndToEndId).toMatch(/^E/);
    expect(r.instrument?.cardLastFour).toBeUndefined();
  });
});

describe('webhook', () => {
  it('recusa webhook sem assinatura válida', async () => {
    expect(await provider.verifyWebhook({}, {})).toBe(false);
    expect(await provider.verifyWebhook({}, { 'x-mock-signature': 'errada' })).toBe(false);
    expect(await provider.verifyWebhook({}, { 'x-mock-signature': 'valida' })).toBe(true);
  });

  it('normaliza o evento', async () => {
    const evento = await provider.parseWebhook({
      eventId: 'evt_1',
      paymentId: 'mock_000001',
      status: 'CAPTURED',
      amountCents: 6240,
    });

    expect(evento).toMatchObject({
      eventId: 'evt_1',
      providerPaymentId: 'mock_000001',
      status: 'CAPTURED',
      amountCents: 6240,
    });
  });

  it('recusa webhook malformado', async () => {
    await expect(provider.parseWebhook({ foo: 'bar' })).rejects.toThrow(/eventId/);
  });
});

describe('assertProviderSupportsModel', () => {
  it('aceita um provedor completo', () => {
    expect(() => assertProviderSupportsModel(new MockPaymentProvider())).not.toThrow();
  });

  /**
   * A verificação existe para falhar na INICIALIZAÇÃO, não no primeiro
   * pagamento real — quando já haveria energia entregue e motorista esperando.
   */
  it('recusa provedor sem captura parcial', () => {
    const ruim = new MockPaymentProvider();
    Object.defineProperty(ruim, 'capabilities', {
      value: { ...ruim.capabilities, partialCapture: false },
    });

    expect(() => assertProviderSupportsModel(ruim)).toThrow(/captura parcial/);
  });

  it('recusa provedor sem pré-autorização', () => {
    const ruim = new MockPaymentProvider();
    Object.defineProperty(ruim, 'capabilities', {
      value: { ...ruim.capabilities, preAuthorization: false },
    });

    expect(() => assertProviderSupportsModel(ruim)).toThrow(/pré-autorização/);
  });

  /** ADR-0010 §4: Pix pago sem energia entregue precisa ser devolvido. */
  it('recusa provedor que aceita Pix mas não devolve', () => {
    const ruim = new MockPaymentProvider();
    Object.defineProperty(ruim, 'capabilities', {
      value: { ...ruim.capabilities, partialRefund: false },
    });

    expect(() => assertProviderSupportsModel(ruim, { requirePix: true })).toThrow(/Pix/);
  });

  it('lista todos os problemas de uma vez', () => {
    const ruim = new MockPaymentProvider();
    Object.defineProperty(ruim, 'capabilities', {
      value: {
        ...ruim.capabilities,
        preAuthorization: false,
        partialCapture: false,
        voidAuthorization: false,
      },
    });

    try {
      assertProviderSupportsModel(ruim);
      expect.unreachable('deveria ter lançado');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('pré-autorização');
      expect(msg).toContain('captura parcial');
      expect(msg).toContain('cancelar');
    }
  });
});

describe('ManualPaymentProvider', () => {
  it('aprova pelo operador e mantém o ciclo completo', async () => {
    const manual = new ManualPaymentProvider();

    const a = await manual.approve(assertCents(20_000), 'manual-1');
    expect(a.status).toBe('AUTHORIZED');
    expect(manual.name).toBe('manual');

    const c = await manual.capture(a.providerPaymentId, assertCents(6240));
    expect(c.status).toBe('CAPTURED');
  });

  it('declara que a autorização acontece fora do backend', () => {
    // Numa aprovação manual, quem "autoriza" é a decisão de uma pessoa.
    expect(new ManualPaymentProvider().capabilities.initiatedBy).toBe('terminal');
  });

  it('atende o modelo do produto', () => {
    expect(() => assertProviderSupportsModel(new ManualPaymentProvider())).not.toThrow();
  });
});
