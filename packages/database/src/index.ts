import { PrismaClient, Prisma } from '@prisma/client';

export * from '@prisma/client';
export { PrismaClient, Prisma };

/**
 * Estados em que uma sessão é considerada ATIVA e ocupa o conector.
 *
 * Precisa espelhar exatamente a lista do índice parcial
 * `charging_sessions_one_active_per_connector` criado na migration inicial.
 * Se divergirem, a regra 11.1 do briefing (uma sessão ativa por conector)
 * deixa de ser garantida pelo banco — que é onde ela precisa ser garantida.
 */
export const ACTIVE_SESSION_STATUSES = [
  'PAYMENT_APPROVED',
  'AWAITING_CHARGER',
  'COMMAND_SENT',
  'STARTING',
  'CHARGING',
  'FINISHING',
] as const;

export function createPrismaClient(options?: Prisma.PrismaClientOptions): PrismaClient {
  return new PrismaClient(options);
}
