import { assertCents, roundToCents, whToKwh, type Cents } from '@bora/contracts';

/**
 * Cálculo do valor de uma sessão de recarga.
 *
 * Regra 11.7 do briefing:
 *
 *     valor = taxa de conexão
 *           + energia em kWh × tarifa por kWh
 *           + duração em minutos × tarifa por minuto
 *
 * Tudo em centavos inteiros (ADR-0005). O único ponto do sistema autorizado a
 * converter fração em dinheiro é `roundToCents`, e ele exige o modo de
 * arredondamento explícito — porque favorecer o motorista ou o estabelecimento
 * é decisão comercial, não detalhe técnico.
 *
 * Este módulo é **puro**: sem banco, sem I/O, sem data atual implícita. É o que
 * torna barato cobrir os casos extremos que a seção 16 do briefing exige.
 */

/**
 * Condições comerciais aplicadas a uma sessão.
 *
 * É uma CÓPIA da tarifa, não uma referência: a sessão guarda isto congelado
 * para que alterar a tarifa amanhã não mude o valor de uma recarga de ontem
 * (exigência da FASE 6).
 */
export interface TariffSnapshot {
  tariffId: string | null;
  name: string;
  pricePerKwhCents: number;
  connectionFeeCents: number;
  pricePerMinuteCents: number;
  minimumAmountCents: number;
  /** Teto comercial. `null` = sem teto próprio da tarifa. */
  maximumAmountCents: number | null;
  idleFeePerMinuteCents: number;
  /** Registrado para auditoria: qual versão da tarifa foi aplicada. */
  snapshotAt: string;
}

export interface PricingInput {
  snapshot: TariffSnapshot;
  /** Energia entregue, em Wh inteiros. */
  energyWh: number;
  durationSeconds: number;
  /**
   * Teto financeiro da sessão, em centavos — o valor pré-autorizado.
   * O valor final NUNCA ultrapassa isto (ADR-0008 §4).
   */
  ceilingAmountCents?: number | null;
}

export interface PricingBreakdown {
  connectionFeeCents: number;
  energyCents: number;
  timeCents: number;
  /** Soma antes de aplicar mínimo e tetos. */
  subtotalCents: number;
  /** Valor final a cobrar. */
  totalCents: Cents;

  /** Ajustes aplicados, para o painel explicar o número ao operador. */
  minimumApplied: boolean;
  tariffMaximumApplied: boolean;
  ceilingApplied: boolean;

  energyKwh: number;
  durationMinutes: number;
}

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingError';
  }
}

/**
 * Calcula o valor de uma sessão.
 *
 * A ordem dos ajustes importa e é deliberada:
 *
 *  1. Soma os componentes.
 *  2. Aplica o **mínimo** — uma recarga de 30 segundos ainda ocupou o
 *     equipamento e tem custo.
 *  3. Aplica o **teto da tarifa**, se houver.
 *  4. Aplica o **teto financeiro** (valor pré-autorizado) por último, porque é
 *     um limite rígido: capturar acima é recusado pelo adquirente.
 *
 * Se o mínimo fosse aplicado depois do teto, uma tarifa com mínimo alto
 * ultrapassaria o valor reservado — e a captura falharia inteira.
 */
export function calculateSessionAmount(input: PricingInput): PricingBreakdown {
  const { snapshot, energyWh, durationSeconds } = input;

  if (!Number.isInteger(energyWh) || energyWh < 0) {
    throw new PricingError(`energia inválida: ${energyWh} Wh (precisa ser inteiro não negativo)`);
  }
  if (!Number.isInteger(durationSeconds) || durationSeconds < 0) {
    throw new PricingError(`duração inválida: ${durationSeconds} s`);
  }

  validarSnapshot(snapshot);

  const energyKwh = whToKwh(energyWh);
  const durationMinutes = durationSeconds / 60;

  const connectionFeeCents = snapshot.connectionFeeCents;

  // Arredondamento para baixo em ambos: na dúvida, a favor do motorista.
  // É uma escolha comercial, registrada aqui de propósito.
  const energyCents =
    snapshot.pricePerKwhCents > 0 ? roundToCents(energyKwh * snapshot.pricePerKwhCents, 'floor') : 0;

  const timeCents =
    snapshot.pricePerMinuteCents > 0
      ? roundToCents(durationMinutes * snapshot.pricePerMinuteCents, 'floor')
      : 0;

  const subtotalCents = connectionFeeCents + energyCents + timeCents;

  let total = subtotalCents;
  let minimumApplied = false;
  let tariffMaximumApplied = false;
  let ceilingApplied = false;

  if (snapshot.minimumAmountCents > 0 && total < snapshot.minimumAmountCents) {
    total = snapshot.minimumAmountCents;
    minimumApplied = true;
  }

  if (snapshot.maximumAmountCents !== null && total > snapshot.maximumAmountCents) {
    total = snapshot.maximumAmountCents;
    tariffMaximumApplied = true;
  }

  const teto = input.ceilingAmountCents;
  if (teto !== null && teto !== undefined && total > teto) {
    // Limite rígido: acima disto o adquirente recusa a captura (risco R-22).
    total = teto;
    ceilingApplied = true;
  }

  return {
    connectionFeeCents,
    energyCents,
    timeCents,
    subtotalCents,
    totalCents: assertCents(total),
    minimumApplied,
    tariffMaximumApplied,
    ceilingApplied,
    energyKwh,
    durationMinutes,
  };
}

/**
 * Valor estimado durante a recarga, para decidir a parada automática.
 *
 * Igual ao cálculo final, mas **sem aplicar o mínimo**: durante a sessão o
 * mínimo inflaria o valor corrente e dispararia a parada cedo demais numa
 * recarga que mal começou.
 */
export function estimateRunningAmount(input: PricingInput): Cents {
  const semMinimo: PricingInput = {
    ...input,
    snapshot: { ...input.snapshot, minimumAmountCents: 0 },
  };

  return calculateSessionAmount(semMinimo).totalCents;
}

/**
 * Limiar de parada automática, em centavos (ADR-0008 §4, ADR-0010 §3).
 *
 * O percentual difere por meio de pagamento e o motivo é o incentivo se
 * inverter: no cartão, ultrapassar o teto é prejuízo nosso (não é cobrável);
 * no Pix, parar antes é prejuízo do motorista (pagou e não recebeu).
 */
export function autoStopThresholdCents(
  ceilingAmountCents: number,
  thresholdPercent: number,
): Cents {
  if (!Number.isInteger(ceilingAmountCents) || ceilingAmountCents <= 0) {
    throw new PricingError(`teto inválido: ${ceilingAmountCents}`);
  }
  if (!Number.isInteger(thresholdPercent) || thresholdPercent < 1 || thresholdPercent > 100) {
    throw new PricingError(`limiar inválido: ${thresholdPercent}%`);
  }

  // Divisão inteira, sem passar por ponto flutuante intermediário.
  return assertCents(Math.floor((ceilingAmountCents * thresholdPercent) / 100));
}

/** Verdadeiro quando a recarga já deve ser interrompida. */
export function shouldAutoStop(
  runningAmountCents: number,
  ceilingAmountCents: number,
  thresholdPercent: number,
): boolean {
  return runningAmountCents >= autoStopThresholdCents(ceilingAmountCents, thresholdPercent);
}

function validarSnapshot(s: TariffSnapshot): void {
  const inteiros: [string, number][] = [
    ['pricePerKwhCents', s.pricePerKwhCents],
    ['connectionFeeCents', s.connectionFeeCents],
    ['pricePerMinuteCents', s.pricePerMinuteCents],
    ['minimumAmountCents', s.minimumAmountCents],
    ['idleFeePerMinuteCents', s.idleFeePerMinuteCents],
  ];

  for (const [campo, valor] of inteiros) {
    if (!Number.isInteger(valor) || valor < 0) {
      throw new PricingError(`${campo} precisa ser um inteiro não negativo em centavos (ADR-0005)`);
    }
  }

  if (s.maximumAmountCents !== null) {
    if (!Number.isInteger(s.maximumAmountCents) || s.maximumAmountCents < 0) {
      throw new PricingError('maximumAmountCents precisa ser inteiro não negativo ou nulo');
    }
    if (s.maximumAmountCents < s.minimumAmountCents) {
      // Configuração contraditória: o teto tornaria o mínimo inatingível.
      throw new PricingError(
        `tarifa inconsistente: máximo (${s.maximumAmountCents}) menor que o mínimo (${s.minimumAmountCents})`,
      );
    }
  }
}
