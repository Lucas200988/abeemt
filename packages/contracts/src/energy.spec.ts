import { describe, expect, it } from 'vitest';
import { assertWattHours, energyFromMeterReadings, EnergyError, formatWh, whToKwh } from './energy';

describe('assertWattHours', () => {
  it('aceita Wh inteiros não negativos', () => {
    expect(assertWattHours(0)).toBe(0);
    expect(assertWattHours(28350)).toBe(28350);
  });

  it('recusa fração e negativo', () => {
    expect(() => assertWattHours(1500.5)).toThrow(EnergyError);
    expect(() => assertWattHours(-1)).toThrow(/negativa/);
  });
});

describe('energyFromMeterReadings — regra 11.6', () => {
  it('calcula final menos inicial', () => {
    expect(energyFromMeterReadings(1_000_000, 1_028_350)).toBe(28350);
  });

  it('devolve zero quando não houve consumo', () => {
    expect(energyFromMeterReadings(1_000_000, 1_000_000)).toBe(0);
  });

  /**
   * Caso real, não hipotético: medidor reiniciado, troca de firmware ou
   * leitura corrompida produzem final < inicial. Devolver null obriga o
   * chamador a decidir o que fazer, em vez de gerar energia negativa — que
   * viraria valor negativo a cobrar.
   */
  it('devolve null quando a leitura final é menor que a inicial', () => {
    expect(energyFromMeterReadings(1_028_350, 1_000_000)).toBeNull();
  });

  it('recusa leituras fracionárias', () => {
    expect(() => energyFromMeterReadings(1000.5, 2000)).toThrow(/leitura inicial/);
    expect(() => energyFromMeterReadings(1000, 2000.5)).toThrow(/leitura final/);
  });
});

describe('conversão para apresentação', () => {
  it('converte Wh para kWh', () => {
    expect(whToKwh(28350)).toBe(28.35);
    expect(whToKwh(1000)).toBe(1);
  });

  it('formata em kWh no padrão brasileiro', () => {
    expect(formatWh(28350)).toBe('28,35 kWh');
    expect(formatWh(1000)).toBe('1,00 kWh');
  });
});

describe('cenário completo — sessão do ADR-0008', () => {
  it('energia e valor batem com a tarifa do seed', () => {
    const energia = energyFromMeterReadings(1_000_000, 1_028_350);
    expect(energia).toBe(28350);

    // Tarifa do seed: R$ 2,20/kWh (220 centavos) + R$ 3,00 de conexão.
    const kwh = whToKwh(energia!);
    const valor = Math.round(kwh * 220) + 300;

    expect(valor).toBe(6537); // R$ 65,37
    // Bem abaixo do teto de R$ 200,00 — a parada automática não dispararia.
    expect(valor).toBeLessThan(20000);
  });
});
