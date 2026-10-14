/**
 * Valores monetários — sempre centavos inteiros (ADR-0005, risco R-12).
 *
 * Por que este arquivo existe: descobrimos em 2026-07-29 que a coluna `Int` do
 * Postgres NÃO recusa fração — o Prisma trunca em silêncio. `1234.56` vira
 * `1234`. Isso transforma um bug de ponto flutuante em um valor errado mas
 * plausível, que é o pior desfecho possível para dinheiro.
 *
 * Portanto a garantia do ADR-0005 não vem do banco. Vem daqui. Todo valor
 * monetário que cruze uma fronteira do sistema (API, webhook, cálculo de
 * tarifa) precisa passar por `assertCents`.
 */

/** Marca nominal para não confundir centavos com qualquer outro número. */
export type Cents = number & { readonly __brand: 'Cents' };

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/**
 * Valida que um número é um valor monetário aceitável e o marca como `Cents`.
 * Lança em vez de arredondar: arredondar em silêncio é exatamente o
 * comportamento que estamos tentando evitar.
 */
export function assertCents(value: number, field = 'valor'): Cents {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new MoneyError(`${field}: não é um número`);
  }

  if (!Number.isFinite(value)) {
    throw new MoneyError(`${field}: não é finito`);
  }

  if (!Number.isInteger(value)) {
    throw new MoneyError(
      `${field}: valores monetários precisam ser centavos inteiros, recebido ${value}. ` +
        'Se veio de um cálculo, o arredondamento precisa ser explícito (ADR-0005).',
    );
  }

  if (value < 0) {
    throw new MoneyError(`${field}: não pode ser negativo, recebido ${value}`);
  }

  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${field}: valor fora do intervalo seguro de inteiros`);
  }

  return value as Cents;
}

/** Converte reais para centavos. Só aceita entradas com no máximo 2 casas. */
export function reaisToCents(reais: number): Cents {
  const cents = Math.round(reais * 100);

  // Tolerância mínima para o erro de representação de 19.99 * 100.
  if (Math.abs(reais * 100 - cents) > 1e-6) {
    throw new MoneyError(`valor em reais com mais de duas casas decimais: ${reais}`);
  }

  return assertCents(cents);
}

/** Formata centavos como moeda brasileira, para apresentação. */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

/**
 * Arredondamento explícito para centavos.
 *
 * O único lugar autorizado a converter um número fracionário em dinheiro.
 * Recebe o modo de arredondamento de forma consciente, porque a escolha entre
 * favorecer o cliente ou o estabelecimento é comercial, não técnica.
 */
export function roundToCents(value: number, mode: 'floor' | 'ceil' | 'nearest' = 'nearest'): Cents {
  if (!Number.isFinite(value)) {
    throw new MoneyError(`não é possível arredondar ${value}`);
  }

  const rounded =
    mode === 'floor' ? Math.floor(value) : mode === 'ceil' ? Math.ceil(value) : Math.round(value);

  return assertCents(rounded);
}
