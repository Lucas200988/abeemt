#!/usr/bin/env bash
#
# Prepara o ambiente local a partir do zero.
#   pnpm setup
#
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Verificando pré-requisitos"
command -v node >/dev/null || { echo "Node.js não encontrado. Instale a versão 22."; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm não encontrado. Rode: corepack enable"; exit 1; }

node_major="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
[ "$node_major" -ge 22 ] || { echo "Node.js 22 ou superior é necessário (encontrado: $(node -v))."; exit 1; }

if [ ! -f .env ]; then
  echo "==> Criando .env a partir do .env.example"
  cp .env.example .env
  echo
  echo "    ATENÇÃO: edite o .env antes de continuar."
  echo "    Troque os valores CHANGE_ME e TROQUE_ESTA_SENHA."
  echo "    Gere segredos com: openssl rand -hex 32"
  echo
  exit 0
fi

if grep -q 'CHANGE_ME\|TROQUE_ESTA_SENHA' .env; then
  echo "ERRO: o .env ainda tem valores de exemplo. Troque-os antes de continuar."
  grep -n 'CHANGE_ME\|TROQUE_ESTA_SENHA' .env | sed 's/^/    /'
  exit 1
fi

echo "==> Instalando dependências"
pnpm install

echo "==> Gerando o cliente Prisma"
pnpm db:generate

echo "==> Aplicando migrations"
pnpm db:deploy

echo "==> Populando dados de desenvolvimento"
pnpm db:seed

echo "==> Construindo os pacotes"
pnpm build

echo
echo "Pronto. Para subir tudo:"
echo "    pnpm dev              (API + painel em modo desenvolvimento)"
echo "    docker compose up -d  (tudo em containers)"
echo
echo "    Painel:  http://localhost:3000"
echo "    API:     http://localhost:3001/api/v1"
echo "    Swagger: http://localhost:3001/api/docs"
