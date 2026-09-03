import type { SampledValueType } from './schemas';

/**
 * Normalização de leituras de medidor.
 *
 * Este arquivo existe por causa do risco R-11: carregadores não implementam
 * OCPP da mesma forma. As divergências que já sabemos existir:
 *
 *  * Unidade de energia pode vir em `Wh` ou `kWh`. O padrão do OCPP 1.6 quando
 *    o campo é omitido é `Wh`, mas há firmware que omite e manda kWh.
 *  * O campo `measurand` é opcional; omitido, o padrão é
 *    `Energy.Active.Import.Register`.
 *  * O valor vem como STRING, e pode ter casa decimal mesmo em Wh.
 *
 * Armazenamos sempre Wh inteiro (ADR-0005). Converter na leitura, e não no
 * cálculo, evita que a mesma dúvida reapareça em cada consulta.
 */

/** Medida acumulada de energia importada — a que interessa para faturar. */
export const ENERGY_REGISTER = 'Energy.Active.Import.Register';

/** Valor padrão quando o carregador omite `measurand` (OCPP 1.6, seção 7.20). */
export function measurandOf(sample: SampledValueType): string {
  return sample.measurand ?? ENERGY_REGISTER;
}

export class MeasurandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeasurandError';
  }
}

/**
 * Converte uma leitura de energia para Wh inteiro.
 *
 * Devolve `null` quando a amostra não é de energia acumulada — o chamador
 * decide se ignora ou registra. Lança apenas quando a amostra *é* de energia mas
 * está inutilizável, porque aí há um problema real a investigar.
 */
export function energySampleToWh(sample: SampledValueType): number | null {
  if (measurandOf(sample) !== ENERGY_REGISTER) return null;

  const numeric = Number(sample.value);

  if (!Number.isFinite(numeric)) {
    throw new MeasurandError(`leitura de energia não numérica: ${JSON.stringify(sample.value)}`);
  }

  if (numeric < 0) {
    throw new MeasurandError(`leitura de energia negativa: ${numeric}`);
  }

  const unit = (sample.unit ?? 'Wh').trim();

  switch (unit.toLowerCase()) {
    case 'wh':
      // Arredondamos: Wh fracionário existe em alguns firmwares, e o banco
      // guarda inteiro. Arredondar aqui é explícito; deixar o Prisma truncar
      // em silêncio não seria (ver ADR-0005 e o achado da FASE 1).
      return Math.round(numeric);

    case 'kwh':
      return Math.round(numeric * 1000);

    default:
      throw new MeasurandError(`unidade de energia não suportada: ${unit}`);
  }
}

/**
 * Extrai a leitura acumulada de energia de um conjunto de amostras.
 *
 * Se houver mais de uma amostra de energia no mesmo MeterValue (acontece quando
 * o firmware manda por fase e o total), usamos a **maior** — o total acumulado
 * nunca é menor que uma parcela.
 */
export function extractEnergyWh(samples: SampledValueType[]): number | null {
  let maior: number | null = null;

  for (const sample of samples) {
    // Amostras por fase são parciais; o registro acumulado vem sem `phase`.
    if (sample.phase) continue;

    const wh = energySampleToWh(sample);
    if (wh === null) continue;

    if (maior === null || wh > maior) maior = wh;
  }

  return maior;
}

/**
 * Reconcilia a leitura acumulada de uma sessão contra uma nova amostra.
 *
 * MeterValues podem chegar **fora de ordem** (exigência de teste da seção 16 do
 * briefing). Se aceitássemos a última leitura recebida, uma mensagem atrasada
 * faria a energia da sessão diminuir — e, com ela, o valor a cobrar.
 *
 * A leitura acumulada é monotônica por natureza: nunca diminui. Então mantemos
 * o maior valor já visto.
 */
export function reconcileMeterReading(
  atual: number | null,
  novaLeitura: number,
): { valor: number; foraDeOrdem: boolean } {
  if (atual === null || novaLeitura > atual) {
    return { valor: novaLeitura, foraDeOrdem: false };
  }

  // Leitura igual ou menor que a já conhecida: mensagem atrasada ou repetida.
  return { valor: atual, foraDeOrdem: true };
}
