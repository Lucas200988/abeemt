/**
 * Carrega o .env da raiz do monorepo.
 *
 * Precisa ser o PRIMEIRO import do processo: `app.module.ts` valida a
 * configuração no topo do arquivo, e essa validação roda no momento do require.
 * Se o .env não estiver carregado até lá, a aplicação morre por configuração
 * ausente mesmo com o arquivo no lugar certo.
 */
import { loadRootEnv } from '@bora/config';
import { resolve } from 'node:path';

loadRootEnv(resolve(__dirname, '../../..'));
