# Borá Carregar

Plataforma de monetização para carregadores veiculares que já falam **OCPP 1.6J**.

O objetivo é permitir que um carregador OCPP já instalado passe a aceitar
pagamento por cartão ou Pix — **sem aplicativo, sem cadastro e sem rede fechada**
para o motorista.

> Nome do produto provisório: **Borá Carregar**
> Nome técnico do sistema: `sonare-charge`
> Responsável: Sonare Engenharia

---

## Situação atual do projeto

**FASE 5 concluída.** O fluxo financeiro funciona de ponta a ponta contra o
simulador OCPP: reserva o valor, acompanha o consumo, **encerra a recarga
sozinha ao atingir o teto** e cobra apenas o que foi consumido. Pix é cobrado
integralmente no início e devolvido por inteiro quando nenhuma energia é
entregue.

**FASE 6 concluída.** O operador cadastra e edita tarifas pelo painel — preço
por kWh, taxa de conexão, preço por minuto, **ociosidade**, mínimo e máximo — e
confere quanto sai cada cenário antes de publicar. Alterar uma tarifa não muda o
valor de recargas já realizadas. 307 testes automatizados.

O provedor de pagamento é **simulado**. Não existe adquirente real ligado, e o
sistema **recusa subir em produção** com um provedor simulado como padrão — o
que evitaria justamente o pior defeito possível: recarga de graça com o painel
reportando "pagamento aprovado".

Nada foi conectado ao carregador WEG WEMOB real — isso é a FASE 4, e depende da
sua autorização explícita.

### O que já dá para ver funcionando

| Fluxo                                    | Onde                                            |
| ---------------------------------------- | ----------------------------------------------- |
| Reserva → consumo → cobrança do consumido | Painel → Pagamentos → "Simular cobrança"        |
| Parada automática no teto                 | mesma tela, com teto baixo (ex.: R$ 4,00)       |
| Pix com devolução por consumo zero        | mesma tela, meio de pagamento "Pix"             |
| Valor corrente durante a recarga          | Painel → Sessões → detalhe da sessão            |
| Devolução manual, com motivo auditado     | Painel → Pagamentos (perfil de administrador)   |
| Cadastro de tarifas e simulação de preço  | Painel → Tarifas                                |

---

## Como executar

### Pré-requisitos

- Node.js 22 (LTS)
- pnpm 10 — se `pnpm -v` falhar: `corepack enable` e
  `corepack prepare pnpm@10.33.0 --activate`, depois reabra o terminal
- PostgreSQL 16 — ou Docker, se preferir subir tudo em containers

### Primeira execução

```bash
git clone https://github.com/lucas200988/abeemt.git bora-carregar
cd bora-carregar

pnpm bootstrap   # cria o .env e para, pedindo que você o preencha
# edite o .env (veja a lista de valores que ele imprime)
pnpm bootstrap   # agora instala, migra, popula e constrói
pnpm dev         # sobe API e painel
```

No **Windows**, os mesmos comandos, no PowerShell aberto dentro da pasta do
projeto. O `bootstrap` é um script Node justamente para funcionar igual nos três
sistemas.

> **É `pnpm bootstrap`, não `pnpm setup`.** `setup` é um comando embutido do
> pnpm: um script com esse nome nunca chega a ser chamado, e quem digita acaba
> rodando a configuração do próprio pnpm. Descoberto na primeira instalação em
> máquina Windows, em 2026-07-30.

O banco precisa estar de pé antes das migrations. Com Docker, só o Postgres:

```bash
docker compose up -d postgres
```

Com Docker, tudo em containers (**este caminho ainda não foi testado** — não há
daemon Docker no ambiente onde o projeto foi desenvolvido):

```bash
docker compose up -d
```

As migrations rodam num serviço próprio antes da API subir — se uma migration
falhar, a API não sobe com o schema errado.

### Endereços

| O quê   | URL                              |
| ------- | -------------------------------- |
| Painel  | http://localhost:3000            |
| API     | http://localhost:3001/api/v1     |
| Swagger | http://localhost:3001/api/docs   |
| Saúde   | http://localhost:3001/api/health |
| Pronto  | http://localhost:3001/api/ready  |

### Usuários criados pelo seed

Todos usam a senha definida em `SEED_ADMIN_PASSWORD`. **Somente desenvolvimento** —
o seed se recusa a rodar com `NODE_ENV=production`.

| Perfil                           | E-mail                     | Enxerga            |
| -------------------------------- | -------------------------- | ------------------ |
| Administrador global             | admin@sonare.com.br        | tudo               |
| Administrador do estabelecimento | gestor@sonare.com.br       | sua organização    |
| Operador                         | operador@sonare.com.br     | opera carregadores |
| Visualizador                     | visualizador@sonare.com.br | somente leitura    |

### Comandos

| Comando                | O que faz                                     |
| ---------------------- | --------------------------------------------- |
| `pnpm bootstrap`       | Prepara o ambiente do zero                    |
| `pnpm dev`             | API e painel em modo desenvolvimento          |
| `pnpm build`           | Constrói todos os pacotes                     |
| `pnpm test`            | Roda toda a suíte                             |
| `pnpm typecheck`       | Verificação de tipos                          |
| `pnpm exec eslint .`   | Lint                                          |
| `pnpm format`          | Formata o código                              |
| `pnpm db:migrate`      | Cria uma migration nova a partir do schema    |
| `pnpm db:deploy`       | Aplica migrations pendentes                   |
| `pnpm db:seed`         | Popula dados de desenvolvimento (idempotente) |
| `pnpm db:studio`       | Abre o Prisma Studio                          |
| `docker compose up -d` | Sobe tudo em containers                       |

### Simulador OCPP

Permite exercitar o sistema sem equipamento físico:

```bash
# Sobe um carregador simulado já com "veículo" conectado
pnpm --filter @bora/ocpp-simulator start -- --identity SIM-001 --plug-in

# Simula firmware que reporta energia em kWh e recusa comandos
pnpm --filter @bora/ocpp-simulator start -- --energy-unit kWh --reject-start

pnpm --filter @bora/ocpp-simulator start -- --help
```

O carregador `SIM-001` já vem cadastrado pelo seed.

### Testes

Os testes de integração usam um banco **separado** (`DATABASE_URL_TEST`), porque
a suíte apaga dados. Crie-o antes da primeira execução:

```bash
createdb bora_carregar_test
DATABASE_URL="$DATABASE_URL_TEST" pnpm db:deploy
pnpm test
```

---

## Situação por fase

| Fase | Escopo                                                        | Situação                            |
| ---- | ------------------------------------------------------------- | ----------------------------------- |
| 0    | Descoberta, arquitetura, riscos, ADRs                         | ✅ concluída — aguardando validação |
| 1    | Fundação: monorepo, API, web, banco, auth, CI                 | ✅ **concluída**                    |
| 2    | Núcleo OCPP 1.6J + simulador                                  | ✅ **concluída**                    |
| 3    | Painel de carregadores e operação manual                      | ✅ **concluída**                    |
| 4a   | Teste com o WEMOB real em rede local (Ethernet)               | ⬜ bloqueada (requer autorização)   |
| 4b   | Teste com infraestrutura pública (`wss://ocpp.sonare.com.br`) | ⬜ bloqueada                        |
| 5    | Pagamento simulado                                            | ✅ **concluída**                    |
| 6    | Tarifação e regras comerciais                                 | ✅ **concluída**                    |
| 7    | Integração com pagamento real                                 | ⬜ não iniciada                     |
| 8    | SmartPOS / terminal de autoatendimento                        | ⬜ não iniciada                     |
| 9    | Endurecimento para piloto                                     | ⬜ não iniciada                     |

Cada fase só começa após validação explícita da anterior.

---

## Documentação

### Arquitetura

- [Plano do projeto](docs/architecture/project-plan.md) — arquitetura, estrutura de pastas, stack, fases
- [Premissas e perguntas em aberto](docs/architecture/assumptions.md) — o que estamos assumindo sem confirmação
- [Registro de riscos](docs/architecture/risks.md) — riscos, severidade e mitigações
- [Decisões arquiteturais (ADRs)](docs/architecture/adr/README.md)

### OCPP

- [Mensagens implementadas](docs/ocpp/supported-messages.md) — o que existe hoje, tolerância a divergências de firmware, simulador

### Pagamentos

- [Arquitetura de cobrança](docs/payments/arquitetura-de-cobranca.md) — como o motorista paga, os dois caminhos possíveis e o que muda no código
- [Matriz de adquirentes](docs/payments/matriz-adquirentes.md) — critérios eliminatórios e roteiro de consulta a fornecedores
- [Fluxo financeiro implementado](docs/payments/fluxo-implementado.md) — o que a FASE 5 entregou, com os caminhos de falha cobertos
- [Tarifação](docs/payments/tarifacao.md) — como o preço é decidido e por que ele não muda depois

### Operações

- [Levantamento de dados do WEMOB](docs/operations/wemob-data-collection.md) — formulário a preencher
- [Plano de retorno à Tupi](docs/operations/tupi-rollback-plan.md) — rollback obrigatório antes da FASE 4
- [Checklist de teste do WEMOB](docs/operations/wemob-test-checklist.md) — roteiro da FASE 4

Documentos previstos para fases seguintes: `docs/operations/incident-response.md`
(FASE 9), `docs/operations/payment-refund.md` (FASE 5), `docs/ocpp/wemob-quirks.md`
(FASE 4), `docs/architecture/data-model.md`, `docs/testing/strategy.md`.

---

## Arquitetura em uma imagem

```
Painel Admin (Next.js) ─┐
Webhook do adquirente ──┼──► API NestJS ──► Máquina de estados da sessão
Terminal/SmartPOS ──────┘         │                    │
                                  │                    ▼
                                  │            PostgreSQL (fonte da verdade)
                                  ▼                    ▲
                        Gateway OCPP (WebSocket)       │
                                  │             Worker (timeouts, outbox, retry)
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
          Simulador OCPP (dev/testes)    WEG WEMOB Station (FASE 4+)
```

Princípios que valem para todas as fases:

1. O **banco** é a fonte da verdade do estado comercial — nunca a conexão em memória.
2. Dinheiro em **centavos inteiros**; energia em **Wh inteiros**. Nada de ponto flutuante.
3. Idempotência garantida por **constraint no banco**, não por lógica em memória.
4. Uma sessão ativa por conector, garantida por **índice único parcial**.
5. Pagamento é uma **porta**; o domínio nunca conhece o adquirente.
6. Nada toca o equipamento real antes do simulador validar o fluxo.

Detalhes e justificativas nos [ADRs](docs/architecture/adr/README.md).

## Modelo de cobrança

**Pré-autorização + captura pelo consumo real** — o motorista paga exatamente o
que consumiu ([ADR-0008](docs/architecture/adr/0008-pre-autorizacao-e-captura.md)).

```
Reserva R$ 200 no cartão (teto padrão, não cobrado)
  → recarga inicia
  → sistema recalcula o valor a cada MeterValues
  → ao atingir 95% do teto: parada automática
  → captura R$ 62,40 (valor real) · R$ 137,60 liberados
```

O teto padrão de **R$ 200,00** é configurável por carregador → estabelecimento →
organização → variável de ambiente `BORA_PREAUTH_CEILING_CENTS`. Vence o primeiro
valor não-nulo.

Falha antes do início gera **cancelamento da reserva** (`void`), não estorno —
nenhuma cobrança acontece.

**Pix** segue modelo próprio, por não ter pré-autorização
([ADR-0010](docs/architecture/adr/0010-pix-valor-fixo.md)): crédito pré-pago de
valor fixo, sem devolução do saldo não consumido.

|                        | Cartão de crédito      | Pix                        |
| ---------------------- | ---------------------- | -------------------------- |
| Cobrança               | Depois, pelo consumido | Antes, valor escolhido     |
| Parada automática      | 95% do teto            | ~100% do valor pago        |
| Sobra não consumida    | Não existe             | Fica com o estabelecimento |
| Falha antes de iniciar | `void` — nada cobrado  | **Devolução automática**   |

> A devolução por **consumo zero** é obrigatória e não configurável: Pix pago sem
> energia entregue é dinheiro recebido sem contraprestação (risco R-27).
> Por isso `refundPayment` para Pix é requisito eliminatório do PSP na FASE 7.

## Endpoints previstos

| Subdomínio             | Uso                                             |
| ---------------------- | ----------------------------------------------- |
| `ocpp.sonare.com.br`   | Endpoint WebSocket dos carregadores (`wss://`)  |
| `api.sonare.com.br`    | API REST (painel e webhooks)                    |
| `painel.sonare.com.br` | Painel administrativo                           |
| `www.sonare.com.br`    | Site institucional existente — **não é tocado** |

Justificativa da separação em [ADR-0009](docs/architecture/adr/0009-topologia-de-dominios.md).

---

## Stack prevista

| Camada          | Tecnologia                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Monorepo        | pnpm workspaces + Turborepo                                                                                               |
| Backend         | Node.js 22 LTS, TypeScript, NestJS 11, `ws`, Swagger                                                                      |
| Frontend        | Next.js 15, React 19, TypeScript, Tailwind + shadcn/ui, TanStack Query                                                    |
| Banco           | PostgreSQL 16 + Prisma 6 (migrations versionadas)                                                                         |
| Assincronismo   | PostgreSQL com padrão outbox (**sem Redis no MVP** — [ADR-0003](docs/architecture/adr/0003-postgres-outbox-sem-redis.md)) |
| Infra local     | Docker + Docker Compose                                                                                                   |
| Testes          | Vitest, Supertest, Playwright                                                                                             |
| Observabilidade | pino (JSON estruturado), `/health`, `/ready`                                                                              |

---

## Como executar

**Ainda não aplicável.** A FASE 1 entrega o ambiente executável com um único
comando (`docker compose up`), migrations automáticas, seeds, Swagger em `/docs`
e o painel acessível localmente. Esta seção será preenchida ao final da FASE 1
com: requisitos, instalação, comandos, variáveis de ambiente, execução local,
testes, acesso ao Swagger e acesso ao painel.

---

## Segurança — compromissos desde o início

- Nenhum segredo real no repositório; `.env.example` sem valores sensíveis.
- Senhas e credenciais de carregador com hash (argon2).
- JWT + RBAC (admin global, admin do estabelecimento, operador, visualizador).
- Rate limiting, CORS restritivo, validação e sanitização de entrada.
- Assinatura de webhooks verificada antes de qualquer efeito.
- Logs com mascaramento de dados sensíveis e trilha de auditoria.
- TLS e WSS obrigatórios em produção.

**Nunca armazenamos:** número completo do cartão, CVV, trilha magnética ou senha
do cartão.

---

## Aviso sobre o equipamento real

O carregador WEG WEMOB Station de referência **está em operação e conectado à
plataforma Tupi**. Nenhuma alteração foi feita nele até aqui.

Qualquer interação com o equipamento real depende da FASE 4, que por sua vez
exige autorização explícita, janela agendada, presença física no local e o
[plano de rollback](docs/operations/tupi-rollback-plan.md) preenchido.

---

## Nota sobre o arquivo `index.html` na raiz

O repositório continha, antes deste trabalho, um único arquivo: `index.html` —
um media kit estático do "Fórum Mato-grossense de Engenharia Elétrica e Energias
Sustentáveis (BESS 2026)" da AMEE. Não tem relação com este projeto e **não foi
alterado nem removido**. Proposta pendente de decisão: movê-lo para `legacy/` na
FASE 1.
