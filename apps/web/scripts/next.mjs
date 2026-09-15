#!/usr/bin/env node
/**
 * Sobe o Next na porta configurada em `WEB_PORT`.
 *
 * Existe porque os scripts eram `next dev -p ${WEB_PORT:-3000}`, e essa é
 * **sintaxe de bash**. No Windows, os scripts do package.json rodam pelo
 * `cmd.exe`, que não expande `${VAR:-padrão}` — a expressão chegava literal ao
 * Next e o painel não subia. Descoberto na primeira instalação em máquina
 * Windows, em 2026-07-30.
 *
 * Uso:  node scripts/next.mjs dev
 *       node scripts/next.mjs start
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRootEnv } from '@bora/config';

const aqui = dirname(fileURLToPath(import.meta.url));

// O .env fica na raiz do monorepo, três níveis acima de apps/web/scripts.
loadRootEnv(resolve(aqui, '../../..'));

const comando = process.argv[2];
if (comando !== 'dev' && comando !== 'start') {
  console.error(`uso: node scripts/next.mjs <dev|start> (recebido: ${comando ?? 'nada'})`);
  process.exit(1);
}

const porta = process.env.WEB_PORT ?? '3000';

const filho = spawn('next', [comando, '-p', porta], {
  stdio: 'inherit',
  // No Windows o `next` é um `.cmd` e o Node recusa executá-lo diretamente.
  shell: process.platform === 'win32',
});

filho.on('exit', (codigo, sinal) => {
  // Repassa o desfecho: sem isto, um Next que morre por sinal sairia como
  // sucesso e o turbo acharia que está tudo bem.
  if (sinal) process.kill(process.pid, sinal);
  else process.exit(codigo ?? 0);
});
