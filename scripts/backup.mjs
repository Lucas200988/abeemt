#!/usr/bin/env node
/**
 * Backup do banco (FASE 9).
 *
 * Uso:
 *   pnpm backup              → gera backups/bora-AAAA-MM-DDTHH-mm-ss.dump
 *   pnpm backup -- --keep 14 → idem, mantendo os 14 mais recentes
 *
 * Duas decisões:
 *
 *  1. Formato `custom` (-Fc) do pg_dump: comprimido e restaurável por tabela
 *     com pg_restore — num incidente às 2h da manhã, restaurar só a tabela
 *     ferida é bem diferente de restaurar o banco inteiro.
 *  2. A senha vai por variável de ambiente (PGPASSWORD), nunca por argumento:
 *     argumento de processo aparece na lista de processos do sistema.
 *
 * ⚠ Backup que nunca foi RESTAURADO não é backup — é esperança. O roteiro de
 * restauração (e o ensaio obrigatório) está em docs/operations/backup-restore.md.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Configuração — do .env da raiz, igual ao resto do sistema
// ---------------------------------------------------------------------------

function lerEnv() {
  let texto;
  try {
    texto = readFileSync(join(raiz, '.env'), 'utf8');
  } catch {
    console.error('❌ Não achei o .env na raiz do projeto. O backup usa a mesma DATABASE_URL do sistema.');
    process.exit(1);
  }
  const valores = {};
  for (const linha of texto.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
    if (m && !linha.trim().startsWith('#')) valores[m[1]] = m[2];
  }
  return valores;
}

const env = lerEnv();
const url = env.DATABASE_URL;

if (!url) {
  console.error('❌ DATABASE_URL não está no .env.');
  process.exit(1);
}

let banco;
try {
  banco = new URL(url);
} catch {
  console.error('❌ DATABASE_URL inválida.');
  process.exit(1);
}

const manterArg = process.argv.indexOf('--keep');
const manter = manterArg >= 0 ? Number(process.argv[manterArg + 1]) || 7 : 7;

// ---------------------------------------------------------------------------
// O dump
// ---------------------------------------------------------------------------

const pasta = join(raiz, 'backups');
mkdirSync(pasta, { recursive: true });

const agora = new Date();
const carimbo = agora.toISOString().replace(/\.\d+Z$/, '').replace(/:/g, '-');
const arquivo = join(pasta, `bora-${carimbo}.dump`);

console.log(`Gerando backup de ${banco.pathname.slice(1).split('?')[0]} → ${arquivo}`);

const resultado = spawnSync(
  'pg_dump',
  [
    '--format=custom',
    '--no-owner',
    `--host=${banco.hostname}`,
    `--port=${banco.port || '5432'}`,
    `--username=${decodeURIComponent(banco.username)}`,
    `--dbname=${banco.pathname.slice(1).split('?')[0]}`,
    `--file=${arquivo}`,
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, PGPASSWORD: decodeURIComponent(banco.password) },
    // No Windows o pg_dump é resolvido pelo PATH do cmd.
    shell: process.platform === 'win32',
  },
);

if (resultado.error?.code === 'ENOENT') {
  console.error('');
  console.error('❌ pg_dump não encontrado. Ele vem junto com o PostgreSQL;');
  console.error('   no Windows, adicione a pasta bin do PostgreSQL ao PATH');
  console.error('   (ex.: C:\\Program Files\\PostgreSQL\\16\\bin).');
  process.exit(1);
}

if (resultado.status !== 0) {
  console.error(`❌ pg_dump terminou com erro (código ${resultado.status}).`);
  process.exit(resultado.status ?? 1);
}

const tamanho = statSync(arquivo).size;
if (tamanho < 1024) {
  // Um dump de um banco com migrations aplicadas nunca é tão pequeno. Arquivo
  // minúsculo é dump vazio — e backup vazio descoberto no incidente é o pior
  // dos mundos.
  console.error(`❌ O arquivo gerado tem só ${tamanho} bytes — algo deu errado. NÃO confie neste backup.`);
  process.exit(1);
}

console.log(`✅ Backup gerado: ${(tamanho / 1024).toFixed(0)} KB`);

// ---------------------------------------------------------------------------
// Retenção — os N mais recentes ficam, o resto sai
// ---------------------------------------------------------------------------

const antigos = readdirSync(pasta)
  .filter((f) => f.startsWith('bora-') && f.endsWith('.dump'))
  .sort()
  .reverse()
  .slice(manter);

for (const velho of antigos) {
  unlinkSync(join(pasta, velho));
  console.log(`  retenção: removido ${velho}`);
}

console.log('');
console.log(`Mantidos os ${manter} mais recentes em ${pasta}`);
console.log('Lembrete: backup só vale depois de ENSAIAR a restauração —');
console.log('roteiro em docs/operations/backup-restore.md');
