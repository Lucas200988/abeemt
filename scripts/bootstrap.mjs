#!/usr/bin/env node
/**
 * Prepara o ambiente local a partir do zero.
 *
 *     pnpm bootstrap
 *
 * Em Node, e não em bash, porque o primeiro teste em máquina Windows
 * (2026-07-30) esbarrou em três coisas ao mesmo tempo:
 *
 *  1. `scripts/setup.sh` precisa de bash, que o PowerShell não tem;
 *  2. o comando era `pnpm setup` — e `setup` é um **comando embutido do pnpm**,
 *     então o script do projeto nunca era chamado. Quem digitava acabava
 *     rodando a configuração do próprio pnpm;
 *  3. as migrations não achavam o `.env` da raiz, porque o Prisma procura no
 *     diretório do pacote.
 *
 * O nome `bootstrap` não colide com nenhum comando do pnpm.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(raiz, '.env');
const exemploPath = resolve(raiz, '.env.example');

/** Sinaliza um passo em andamento. */
function passo(texto) {
  console.log(`\n==> ${texto}`);
}

function erro(texto) {
  console.error(`\nERRO: ${texto}\n`);
  process.exit(1);
}

/**
 * Roda um comando mostrando a saída.
 *
 * `shell: true` no Windows porque `pnpm` lá é um `.cmd`, e o Node recusa
 * executá-lo diretamente.
 */
function rodar(comando, argumentos) {
  execFileSync(comando, argumentos, {
    cwd: raiz,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

// ---------------------------------------------------------------------------

passo('Verificando pré-requisitos');

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  erro(`Node.js 22 ou superior é necessário (encontrado: v${process.versions.node}).`);
}
console.log(`    Node.js v${process.versions.node}`);

try {
  const versao = execFileSync('pnpm', ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  }).trim();
  console.log(`    pnpm ${versao}`);
} catch {
  erro(
    'pnpm não encontrado.\n' +
      '  Rode:  corepack enable\n' +
      '         corepack prepare pnpm@10.33.0 --activate\n' +
      '  Depois feche e reabra o terminal.',
  );
}

// ---------------------------------------------------------------------------

if (!existsSync(envPath)) {
  passo('Criando .env a partir do .env.example');
  copyFileSync(exemploPath, envPath);

  console.log(`
    O arquivo .env foi criado. EDITE-O ANTES DE CONTINUAR.

    Troque os valores CHANGE_ME e TROQUE_ESTA_SENHA:

      POSTGRES_PASSWORD    senha do banco (ex.: bora_dev)
      DATABASE_URL         a mesma senha, dentro da URL
      DATABASE_URL_TEST    idem, no banco de teste
      JWT_SECRET           gere com: openssl rand -hex 32
      JWT_REFRESH_SECRET   gere outro, diferente do de cima
      SEED_ADMIN_PASSWORD  a senha com que você vai entrar no painel

    No Windows:   notepad .env
    No Linux/Mac: nano .env

    Depois, com o .env preenchido, suba o banco e rode isto de novo:

      docker compose up -d postgres
      pnpm bootstrap

    (A ordem importa: o docker compose lê a senha do .env, então ele só
     funciona depois que o arquivo existe e está preenchido.)
`);
  process.exit(0);
}

const conteudo = readFileSync(envPath, 'utf8');
const pendentes = conteudo
  .split('\n')
  .map((linha, i) => [i + 1, linha])
  .filter(([, linha]) => /CHANGE_ME|TROQUE_ESTA_SENHA/.test(linha));

if (pendentes.length > 0) {
  console.error('\nERRO: o .env ainda tem valores de exemplo. Troque-os antes de continuar.\n');
  for (const [numero, linha] of pendentes) console.error(`    ${numero}: ${linha}`);
  console.error('');
  process.exit(1);
}

// ---------------------------------------------------------------------------

passo('Instalando dependências');
rodar('pnpm', ['install']);

passo('Gerando o cliente Prisma');
rodar('pnpm', ['db:generate']);

passo('Aplicando migrations');
try {
  rodar('pnpm', ['db:deploy']);
} catch {
  erro(
    'não foi possível aplicar as migrations.\n' +
      '  O banco está rodando? Com Docker:  docker compose up -d postgres\n' +
      '  A senha do .env confere com a do banco?',
  );
}

passo('Populando dados de desenvolvimento');
rodar('pnpm', ['db:seed']);

passo('Construindo os pacotes');
rodar('pnpm', ['build']);

console.log(`
Pronto. Para subir tudo:

    pnpm dev              API + painel em modo desenvolvimento

    Painel:  http://localhost:3000
    API:     http://localhost:3001/api/v1
    Swagger: http://localhost:3001/api/docs

Para ligar um carregador simulado, em outro terminal:

    pnpm --filter @bora/ocpp-simulator exec bora-sim --identity SIM-001 --plug-in --meter-interval 3
`);
