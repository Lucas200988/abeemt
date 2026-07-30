import { describe, expect, it } from 'vitest';
import {
  autoStopThresholdCents,
  calculateSessionAmount,
  estimateRunningAmount,
  PricingError,
  shouldAutoStop,
  type TariffSnapshot,
} from './index';

/** Tarifa do seed: R$ 2,20/kWh + R$ 3,00 de conexão, mínimo R$ 5,00. */
const tarifa = (parcial: Partial<TariffSnapshot> = {}): TariffSnapshot => ({
  tariffId: 't1',
  name: 'Tarifa de teste',
  pricePerKwhCents: 220,
  connectionFeeCents: 300,
  pricePerMinuteCents: 0,
  minimumAmountCents: 500,
  maximumAmountCents: null,
  idleFeePerMinuteCents: 0,
  snapshotAt: '2026-07-29T00:00:00.000Z',
  ...parcial,
});

describe('calculateSessionAmount — casos da FASE 6', () => {
  it('somente kWh', () => {
    const r = calculateSessionAmount({
      snapshot: tarifa({ connectionFeeCents: 0, minimumAmountCents: 0 }),
      energyWh: 28_350,
      durationSeconds: 1800,
    });

    // 28,35 kWh × R$ 2,20 = R$ 62,37
    expect(r.energyCents).toBe(6237);
    expect(r.totalCents).toBe(6237);
    expect(r.timeCents).toBe(0);
  });

  it('kWh mais taxa fixa de conexão', () => {
    const r = calculateSessionAmount({
      snapshot: tarifa({ minimumAmountCents: 0 }),
      energyWh: 28_350,
      durationSeconds: 1800,
    });

    expect(r.connectionFeeCents).toBe(300);
    expect(r.energyCents).toBe(6237);
    expect(r.totalCents).toBe(6537); // R$ 65,37
  });

  it('somente tempo', () => {
    const r = calculateSessionAmount({
      snapshot: tarifa({
        pricePerKwhCents: 0,
        connectionFeeCents: 0,
        minimumAmountCents: 0,
        pricePerMinuteCents: 50,
      }),
      energyWh: 28_350,
      durationSeconds: 1800, // 30 min
    });

    expect(r.timeCents).toBe(1500); // R$ 15,00
    expect(r.energyCents).toBe(0);
    expect(r.totalCents).toBe(1500);
  });

  it('os três componentes juntos', () => {
    const r = calculateSessionAmount({
      snapshot: tarifa({ pricePerMinuteCents: 10, minimumAmountCents: 0 }),
      energyWh: 10_000,
      durationSeconds: 600, // 10 min
    });

    expect(r.connectionFeeCents).toBe(300);
    expect(r.energyCents).toBe(2200);
    expect(r.timeCents).toBe(100);
    expect(r.totalCents).toBe(2600);
  });

  it('aplica o valor mínimo numa recarga curtíssima', () => {
    const r = calculateSessionAmount({
      snapshot: tarifa(),
      energyWh: 100, // 0,1 kWh = 22 centavos
      durationSeconds: 30,
    });

    expect(r.subtotalCents).toBe(322); // 300 + 22
    expect(r.totalCents).toBe(500); // mínimo
    expect(r.minimumApplied).toBe(true);
  });

  it('aplica o teto comercial da tarifa', () => {
    const r = calculateSessionAmount({
      snapshot: tarifa({ maximumAmountCents: 5000 }),
      energyWh: 100_000, // R$ 220 de energia
      durationSeconds: 7200,
    });

    expect(r.totalCents).toBe(5000);
    expect(r.tariffMaximumApplied).toBe(true);
  });

  /**
   * Limite rígido: acima do valor pré-autorizado o adquirente recusa a captura,
   * e uma captura recusada significaria a recarga inteira sem cobrança.
   */
  it('nunca ultrapassa o teto financeiro da sessão (risco R-22)', () => {
    const r = calculateSessionAmount({
      snapshot: tarifa(),
      energyWh: 200_000, // R$ 440 de energia
      durationSeconds: 7200,
      ceilingAmountCents: 20_000, // R$ 200 pré-autorizados
    });

    expect(r.subtotalCents).toBeGreaterThan(20_000);
    expect(r.totalCents).toBe(20_000);
    expect(r.ceilingApplied).toBe(true);
  });

  /**
   * A ordem importa: se o mínimo fosse aplicado DEPOIS do teto, uma tarifa com
   * mínimo alto ultrapassaria o valor reservado e a captura falharia inteira.
   */
  it('o teto financeiro vence o valor mínimo da tarifa', () => {
    const r = calculateSessionAmount({
      snapshot: tarifa({ minimumAmountCents: 5000 }),
      energyWh: 0,
      durationSeconds: 10,
      ceilingAmountCents: 1000, // reservou só R$ 10
    });

    expect(r.totalCents).toBe(1000);
    expect(r.minimumApplied).toBe(true);
    expect(r.ceilingApplied).toBe(true);
  });

  it('sessão sem energia cobra a taxa de conexão e o mínimo', () => {
    const r = calculateSessionAmount({
      snapshot: tarifa(),
      energyWh: 0,
      durationSeconds: 0,
    });

    expect(r.energyCents).toBe(0);
    expect(r.totalCents).toBe(500);
  });

  it('sessão sem energia e sem mínimo nem taxa resulta em zero', () => {
    const r = calculateSessionAmount({
      snapshot: tarifa({ connectionFeeCents: 0, minimumAmountCents: 0 }),
      energyWh: 0,
      durationSeconds: 0,
    });

    // Zero é válido: vira cancelamento da reserva, não cobrança.
    expect(r.totalCents).toBe(0);
  });
});

describe('arredondamento', () => {
  it('arredonda para baixo, a favor do motorista', () => {
    const r = calculateSessionAmount({
      snapshot: tarifa({ connectionFeeCents: 0, minimumAmountCents: 0 }),
      energyWh: 1234, // 1,234 kWh × 220 = 271,48 centavos
      durationSeconds: 60,
    });

    expect(r.energyCents).toBe(271);
  });

  it('nunca produz valor fracionário', () => {
    for (const wh of [1, 7, 333, 9999, 123_456]) {
      const r = calculateSessionAmount({
        snapshot: tarifa({ pricePerMinuteCents: 7 }),
        energyWh: wh,
        durationSeconds: 137,
      });

      expect(Number.isInteger(r.totalCents)).toBe(true);
      expect(Number.isInteger(r.energyCents)).toBe(true);
      expect(Number.isInteger(r.timeCents)).toBe(true);
    }
  });

  it('não acumula erro de ponto flutuante em muitas somas', () => {
    // 0,1 + 0,2 !== 0,3 em float. Em centavos inteiros, sempre exato.
    let acumulado = 0;
    for (let i = 0; i < 1000; i += 1) {
      acumulado += calculateSessionAmount({
        snapshot: tarifa({ connectionFeeCents: 10, minimumAmountCents: 0 }),
        energyWh: 100,
        durationSeconds: 60,
      }).totalCents;
    }

    // 1000 × (10 + 22) = 32000, exato.
    expect(acumulado).toBe(32_000);
  });
});

describe('entradas inválidas', () => {
  it('recusa energia fracionária', () => {
    expect(() =>
      calculateSessionAmount({ snapshot: tarifa(), energyWh: 100.5, durationSeconds: 60 }),
    ).toThrow(PricingError);
  });

  it('recusa energia negativa', () => {
    expect(() =>
      calculateSessionAmount({ snapshot: tarifa(), energyWh: -100, durationSeconds: 60 }),
    ).toThrow(/energia inválida/);
  });

  it('recusa duração negativa', () => {
    expect(() =>
      calculateSessionAmount({ snapshot: tarifa(), energyWh: 100, durationSeconds: -1 }),
    ).toThrow(/duração inválida/);
  });

  it('recusa tarifa com preço fracionário em centavos', () => {
    expect(() =>
      calculateSessionAmount({
        snapshot: tarifa({ pricePerKwhCents: 220.5 }),
        energyWh: 1000,
        durationSeconds: 60,
      }),
    ).toThrow(/inteiro não negativo em centavos/);
  });

  /** Configuração contraditória: o teto tornaria o mínimo inatingível. */
  it('recusa tarifa com máximo menor que o mínimo', () => {
    expect(() =>
      calculateSessionAmount({
        snapshot: tarifa({ minimumAmountCents: 5000, maximumAmountCents: 1000 }),
        energyWh: 1000,
        durationSeconds: 60,
      }),
    ).toThrow(/máximo .* menor que o mínimo/);
  });
});

describe('parada automática (ADR-0008 §4 e ADR-0010 §3)', () => {
  it('calcula o limiar do cartão em 95% do teto', () => {
    expect(autoStopThresholdCents(20_000, 95)).toBe(19_000);
  });

  /** No Pix o incentivo se inverte: parar antes é prejuízo do motorista. */
  it('o limiar do Pix é mais alto que o do cartão', () => {
    const cartao = autoStopThresholdCents(20_000, 95);
    const pix = autoStopThresholdCents(20_000, 100);

    expect(pix).toBe(20_000);
    expect(pix).toBeGreaterThan(cartao);
  });

  it('dispara ao atingir o limiar, não antes', () => {
    expect(shouldAutoStop(18_999, 20_000, 95)).toBe(false);
    expect(shouldAutoStop(19_000, 20_000, 95)).toBe(true);
    expect(shouldAutoStop(19_001, 20_000, 95)).toBe(true);
  });

  it('recusa limiar fora de 1 a 100', () => {
    expect(() => autoStopThresholdCents(20_000, 0)).toThrow(PricingError);
    expect(() => autoStopThresholdCents(20_000, 101)).toThrow(PricingError);
  });

  it('recusa teto zero ou negativo', () => {
    expect(() => autoStopThresholdCents(0, 95)).toThrow(/teto inválido/);
  });

  /**
   * O valor corrente ignora o mínimo: durante a recarga, o mínimo inflaria o
   * número e dispararia a parada numa sessão que mal começou.
   */
  it('a estimativa corrente ignora o valor mínimo', () => {
    const entrada = {
      snapshot: tarifa({ minimumAmountCents: 15_000 }),
      energyWh: 1000,
      durationSeconds: 60,
      ceilingAmountCents: 20_000,
    };

    const corrente = estimateRunningAmount(entrada);
    const final = calculateSessionAmount(entrada).totalCents;

    expect(corrente).toBe(520); // 300 de conexão + 220 de energia
    expect(final).toBe(15_000); // mínimo aplicado
    expect(corrente).toBeLessThan(final);
  });

  it('sem o ajuste, o mínimo dispararia a parada numa recarga recém-iniciada', () => {
    const entrada = {
      snapshot: tarifa({ minimumAmountCents: 19_500 }),
      energyWh: 100,
      durationSeconds: 10,
      ceilingAmountCents: 20_000,
    };

    // Com mínimo, o valor "final" já passaria do limiar de 95%.
    expect(shouldAutoStop(calculateSessionAmount(entrada).totalCents, 20_000, 95)).toBe(true);
    // Com a estimativa correta, não para.
    expect(shouldAutoStop(estimateRunningAmount(entrada), 20_000, 95)).toBe(false);
  });
});

describe('cenário completo do ADR-0008', () => {
  it('reproduz o exemplo documentado', () => {
    // Reserva R$ 200, consome 28,35 kWh, paga R$ 65,37.
    const r = calculateSessionAmount({
      snapshot: tarifa({ minimumAmountCents: 0 }),
      energyWh: 28_350,
      durationSeconds: 1800,
      ceilingAmountCents: 20_000,
    });

    expect(r.totalCents).toBe(6537);
    expect(r.ceilingApplied).toBe(false);

    // O saldo liberado é a diferença.
    expect(20_000 - r.totalCents).toBe(13_463);
  });

  it('uma recarga longa é interrompida antes de estourar a reserva', () => {
    const teto = 20_000;
    const snapshot = tarifa({ minimumAmountCents: 0 });

    // Simula a energia subindo até a parada disparar.
    let wh = 0;
    let parou = false;
    while (wh < 200_000) {
      wh += 1000;
      const corrente = estimateRunningAmount({
        snapshot,
        energyWh: wh,
        durationSeconds: 60,
        ceilingAmountCents: teto,
      });

      if (shouldAutoStop(corrente, teto, 95)) {
        parou = true;
        break;
      }
    }

    expect(parou).toBe(true);

    // No momento da parada, o valor ainda cabe na reserva.
    const final = calculateSessionAmount({
      snapshot,
      energyWh: wh,
      durationSeconds: 60,
      ceilingAmountCents: teto,
    });

    expect(final.totalCents).toBeLessThanOrEqual(teto);
  });
});
