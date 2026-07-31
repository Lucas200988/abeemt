import { describe, expect, it } from 'vitest';
import { assertCents } from '@bora/contracts';
import { ManualPaymentProvider } from './manual';
import { TerminalMockPaymentProvider } from './terminal-mock';
import { assertProviderSupportsModel } from './provider';

/**
 * A autorização que nasce fora do backend.
 *
 * Numa maquininha, quem reserva o valor é o SDK do fabricante, no equipamento.
 * O identificador da cobrança chega ao servidor já pronto — e é ele que o
 * fechamento, minutos ou horas depois, precisa capturar.
 */

const criar = () => new TerminalMockPaymentProvider();

describe('maquininha simulada', () => {
  it('declara que a autorização nasce no terminal', () => {
    expect(criar().capabilities.initiatedBy).toBe('terminal');
  });

  it('aceita crédito e débito — o que o motorista passa na maquininha', () => {
    const metodos = criar().capabilities.methods;

    expect(metodos).toContain('CREDIT_CARD');
    expect(metodos).toContain('DEBIT_CARD');
    // Pix no SmartPOS tem outro fluxo; declará-lo faria o terminal oferecer ao
    // motorista um meio que este provedor não sabe executar.
    expect(metodos).not.toContain('PIX');
  });

  it('atende o modelo do produto', () => {
    expect(() => assertProviderSupportsModel(criar())).not.toThrow();
  });
});

describe('adoção da autorização do terminal', () => {
  /**
   * O defeito que este teste tranca.
   *
   * Sem a adoção, `capture` era chamado com um identificador que o provedor
   * nunca tinha visto e falhava com `NOT_FOUND`. O sintoma seria o pior
   * possível: recarga entregue, nada cobrado, e nenhum erro visível até a
   * conciliação.
   */
  it('sem adotar, capturar um identificador do terminal falha', async () => {
    await expect(criar().capture('NSU-DO-TERMINAL', assertCents(800))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('depois de adotada, a captura parcial funciona', async () => {
    const p = criar();

    await p.adoptTerminalAuthorization({
      providerPaymentId: 'NSU-DO-TERMINAL',
      amountAuthorizedCents: assertCents(20_000),
      method: 'CREDIT_CARD',
      idempotencyKey: 'k1',
      instrument: { cardBrand: 'VISA', cardLastFour: '4321' },
    });

    const resultado = await p.capture('NSU-DO-TERMINAL', assertCents(800));

    expect(resultado.status).toBe('CAPTURED');
    expect(resultado.amountCapturedCents).toBe(800);
    // O que sobrou da reserva não é cobrado — é o modelo inteiro do ADR-0008.
    expect(resultado.amountAuthorizedCents).toBe(20_000);
  });

  it('capturar acima do reservado continua sendo recusado', async () => {
    const p = criar();

    await p.adoptTerminalAuthorization({
      providerPaymentId: 'NSU-2',
      amountAuthorizedCents: assertCents(5_000),
      method: 'CREDIT_CARD',
      idempotencyKey: 'k2',
    });

    await expect(p.capture('NSU-2', assertCents(5_001))).rejects.toMatchObject({
      code: 'AMOUNT_EXCEEDS_AUTHORIZATION',
    });
  });

  /**
   * A maquininha reenvia quando a resposta se perde. Recusar a repetição
   * transformaria uma retentativa de rede em falha de cobrança.
   */
  it('adotar duas vezes não é erro e não duplica', async () => {
    const p = criar();

    const entrada = {
      providerPaymentId: 'NSU-3',
      amountAuthorizedCents: assertCents(3_000),
      method: 'CREDIT_CARD' as const,
      idempotencyKey: 'k3',
    };

    await p.adoptTerminalAuthorization(entrada);
    await p.adoptTerminalAuthorization(entrada);

    const consulta = await p.getPayment('NSU-3');
    expect(consulta.amountAuthorizedCents).toBe(3_000);
    expect(consulta.amountCapturedCents).toBe(0);
  });

  it('cancelar a reserva de uma autorização adotada funciona', async () => {
    const p = criar();

    await p.adoptTerminalAuthorization({
      providerPaymentId: 'NSU-4',
      amountAuthorizedCents: assertCents(1_000),
      method: 'DEBIT_CARD',
      idempotencyKey: 'k4',
    });

    expect((await p.voidPayment('NSU-4')).status).toBe('VOIDED');
  });

  /**
   * O `manual` também é terminal-iniciado — é o caminho do operador que aprova
   * no painel e do teste com o equipamento real (FASE 4). O mesmo defeito valia
   * para ele.
   */
  it('vale igualmente para a aprovação manual', async () => {
    const p = new ManualPaymentProvider();

    await p.adoptTerminalAuthorization({
      providerPaymentId: 'APROVACAO-MANUAL-1',
      amountAuthorizedCents: assertCents(10_000),
      method: 'MANUAL',
      idempotencyKey: 'k5',
    });

    expect((await p.capture('APROVACAO-MANUAL-1', assertCents(2_500))).status).toBe('CAPTURED');
  });
});
