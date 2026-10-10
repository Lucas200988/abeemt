/**
 * Energia — sempre Wh inteiros no banco (ADR-0005).
 * kWh existe apenas para apresentação e cálculo tarifário.
 */

export type WattHours = number & { readonly __brand: 'WattHours' };

export class EnergyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnergyError';
  }
}

export function assertWattHours(value: number, field = 'energia'): WattHours {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new EnergyError(`${field}: não é um número finito`);
  }
  if (!Number.isInteger(value)) {
    throw new EnergyError(`${field}: energia é armazenada em Wh inteiros, recebido ${value}`);
  }
  if (value < 0) {
    throw new EnergyError(`${field}: não pode ser negativa, recebido ${value}`);
  }
  return value as WattHours;
}

/**
 * Energia consumida a partir das leituras do medidor (regra 11.6).
 *
 * Leitura final menor que a inicial é um caso REAL: medidor reiniciado, troca
 * de firmware, ou leitura corrompida. Não pode virar energia negativa nem valor
 * cobrado. Devolvemos null para que o chamador trate explicitamente.
 */
export function energyFromMeterReadings(startWh: number, stopWh: number): WattHours | null {
  assertWattHours(startWh, 'leitura inicial');
  assertWattHours(stopWh, 'leitura final');

  if (stopWh < startWh) return null;

  return (stopWh - startWh) as WattHours;
}

/** Converte Wh para kWh. Só para apresentação e cálculo — nunca para armazenar. */
export function whToKwh(wh: number): number {
  return wh / 1000;
}

/** Formata energia em kWh no padrão brasileiro. */
export function formatWh(wh: number, fractionDigits = 2): string {
  return `${new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(whToKwh(wh))} kWh`;
}
