import { describe, expect, it } from 'vitest';
import { assertCents, formatCents, MoneyError, reaisToCents, roundToCents } from './money';

describe('assertCents — a garantia do ADR-0005', () => {
  it('aceita inteiros não negativos', () => {
    expect(assertCents(0)).toBe(0);
    expect(assertCents(20000)).toBe(20000); // teto padrão do ADR-0008 §9
    expect(assertCents(6240)).toBe(6240);
  });

  it('recusa fração — o caso que o banco deixaria passar truncando', () => {
    expect(() => assertCents(1234.56)).toThrow(MoneyError);
    expect(() => assertCents(1234.56)).toThrow(/centavos inteiros/);
  });

  it('recusa o resultado clássico de aritmética de ponto flutuante', () => {
    // 0.1 + 0.2 === 0.30000000000000004
    expect(() => assertCents(0.1 + 0.2)).toThrow(MoneyError);
  });

  it('recusa negativo, NaN e infinito', () => {
    expect(() => assertCents(-1)).toThrow(/negativo/);
    expect(() => assertCents(Number.NaN)).toThrow(/não é um número/);
    expect(() => assertCents(Number.POSITIVE_INFINITY)).toThrow(/não é finito/);
  });

  it('inclui o nome do campo na mensagem', () => {
    expect(() => assertCents(1.5, 'amountAuthorizedCents')).toThrow(/amountAuthorizedCents/);
  });
});

describe('reaisToCents', () => {
  it('converte valores com até duas casas', () => {
    expect(reaisToCents(200)).toBe(20000);
    expect(reaisToCents(62.4)).toBe(6240);
    expect(reaisToCents(19.99)).toBe(1999);
    expect(reaisToCents(0)).toBe(0);
  });

  it('recusa mais de duas casas decimais em vez de arredondar sozinho', () => {
    expect(() => reaisToCents(12.345)).toThrow(/duas casas/);
  });
});

describe('roundToCents', () => {
  it('arredonda conforme o modo pedido', () => {
    expect(roundToCents(1234.4, 'nearest')).toBe(1234);
    expect(roundToCents(1234.6, 'nearest')).toBe(1235);
    expect(roundToCents(1234.9, 'floor')).toBe(1234);
    expect(roundToCents(1234.1, 'ceil')).toBe(1235);
  });

  it('nunca produz negativo', () => {
    expect(() => roundToCents(-0.4, 'floor')).toThrow(/negativo/);
  });
});

/** O Intl separa "R$" do número com espaço não separável (U+00A0). */
const semNbsp = (s: string) => s.replace(/\u00a0/g, ' ');

describe('formatCents', () => {
  it('formata em real brasileiro', () => {
    expect(semNbsp(formatCents(20000))).toBe('R$ 200,00');
    expect(semNbsp(formatCents(6240))).toBe('R$ 62,40');
    expect(semNbsp(formatCents(0))).toBe('R$ 0,00');
  });
});

describe('cenário do ADR-0008 — pré-autorização e captura', () => {
  it('mantém a aritmética exata do exemplo documentado', () => {
    const reservado = assertCents(20000); // R$ 200,00
    const capturado = assertCents(6240); // R$ 62,40
    const liberado = assertCents(reservado - capturado);

    expect(liberado).toBe(13760); // R$ 137,60
    expect(semNbsp(formatCents(liberado))).toBe('R$ 137,60');
  });

  it('calcula o limiar de parada sem perder centavo', () => {
    const teto = assertCents(20000);

    // 95% no cartão (ADR-0008 §4) — divisão inteira, não float.
    const limiarCartao = roundToCents((teto * 95) / 100, 'floor');
    expect(limiarCartao).toBe(19000);

    // 100% no Pix (ADR-0010 §3), porque parar antes prejudica o motorista.
    const limiarPix = roundToCents((teto * 100) / 100, 'floor');
    expect(limiarPix).toBe(20000);
    expect(limiarPix).toBeGreaterThan(limiarCartao);
  });
});
