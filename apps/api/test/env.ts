/**
 * Ambiente dos testes. Carregado antes de qualquer módulo da aplicação.
 *
 * Aponta para o banco de TESTE — a suíte apaga dados, e apontar para o banco
 * de desenvolvimento por engano custaria o trabalho de um dia.
 */
import { loadRootEnv } from '@bora/config';
import { resolve } from 'node:path';

loadRootEnv(resolve(__dirname, '../../..'));

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
  throw new Error(
    'DATABASE_URL_TEST não definida. Os testes não rodam contra o banco de desenvolvimento.',
  );
}

process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';
// Rate limit alto: senão um teste de login derruba os seguintes.
process.env.RATE_LIMIT_MAX = '10000';
process.env.RATE_LIMIT_AUTH_MAX = '10000';
