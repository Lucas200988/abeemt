import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

export * from './env';

/**
 * Carrega o .env da raiz do monorepo.
 *
 * Um único .env na raiz, não um por app: no MVP são poucos serviços e vários
 * valores são compartilhados (DATABASE_URL, marca, limiares). Espalhar isso em
 * três arquivos é convite para divergirem.
 */
export function loadRootEnv(rootDir = process.cwd()): void {
  loadDotenv({ path: resolve(rootDir, '.env'), quiet: true });
}
