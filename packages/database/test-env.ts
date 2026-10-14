/**
 * Ambiente dos testes de constraint.
 *
 * Antes, o arquivo lia `process.env` direto e só passava se o shell já tivesse a
 * configuração carregada — `pnpm -r test` num terminal limpo falhava com um erro
 * do Prisma que não dizia nada sobre a causa real.
 */
import { loadRootEnv } from '@bora/config';
import { resolve } from 'node:path';

loadRootEnv(resolve(__dirname, '../..'));

if (!process.env.DATABASE_URL_TEST) {
  throw new Error(
    'DATABASE_URL_TEST não definida. Estes testes apagam dados e não rodam contra o banco de desenvolvimento.',
  );
}
