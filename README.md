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
valor de recargas já realizadas.

**FASE 7 concluída (2026-07-31).** O adquirente é a **Rede**, e o adapter foi
**verificado contra o sandbox real: 8 de 8 passos** — reservar R$ 200,00,
cobrar apenas R$ 8,00, devolver, cancelar reserva e mapear recusa. Número de
cartão nunca passa pelo nosso servidor. Evidência e as duas ressalvas honestas
(webhook da Rede não tem assinatura; recarga ponta a ponta com cartão depende
da fonte do token, pergunta na Rede Store) em
[o contrato da Rede](docs/payments/rede-e-rede-contrato.md).

**FASE 8 concluída no lado do servidor.** A maquininha do poste tem identidade
própria, pareia por código de uso único e inicia a recarga passando o cartão —
sem aplicativo e sem cadastro para o motorista. O que ainda depende de você é o
aplicativo que roda **dentro** do equipamento, porque ele exige o SDK do
fabricante; ver [FASE 8: a maquininha](docs/payments/fase-8-maquininha.md).

**FASE 9 em conclusão.** O sistema agora se defende sozinho: **alertas
operacionais na primeira tela** do painel (sessão sem medição, cobrança
pendente, carregador offline, maquininha muda — cada um apontando seu roteiro),
**testes de caos** provando que a queda de 4G no meio da recarga não perde um
Wh e que o adquirente fora do ar atrasa a cobrança sem perdê-la, **backup com
restauração ensaiada** (`pnpm backup`), [roteiros de
incidente](docs/operations/incident-response.md) e o [checklist do
piloto](docs/operations/pilot-checklist.md). Os itens restantes do checklist
dependem da FASE 4 (equipamento real) e do credenciamento de produção.

**440 testes automatizados**, incluindo o ciclo completo contra o simulador
OCPP, o caos e as tentativas de burlar os limites do terminal.

O provedor de pagamento é **simulado**. Não existe adquirente real ligado, e o
sistema **recusa subir em produção** com um provedor simulado como padrão — o
que evitaria justamente o pior defeito possível: recarga de graça com o painel
reportando "pagamento aprovado".

Nada foi conectado ao carregador WEG WEMOB real — isso é a FASE 4, e depende da
sua autorização explícita.

### O que já dá para ver funcionando

| Fluxo                                     | Onde                                               |
| ----------------------------------------- | -------------------------------------------------- |
| Reserva → consumo → cobrança do consumido | Painel → Pagamentos → "Simular cobrança"           |
| Parada automática no teto                 | mesma tela, com teto baixo (ex.: R$ 4,00)          |
| Pix com devolução por consumo zero        | mesma tela, meio de pagamento "Pix"                |
| Valor corrente durante a recarga          | Painel → Sessões → detalhe da sessão               |
| Devolução manual, com motivo auditado     | Painel → Pagamentos (perfil de administrador)      |
| Cadastro de tarifas e simulação de preço  | Painel → Tarifas                                   |
| Cadastro e pareamento de maquininhas      | Painel → Maquininhas                               |
| Recarga iniciada pela maquininha          | `POST /api/v1/terminal/authorization` (ver FASE 8) |

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

pnpm bootstrap                  # 1. cria o .env e para, pedindo que você o preencha
# edite o .env — a lista de valores é impressa na tela
docker compose up -d postgres   # 2. sobe o banco (lê a senha do .env)
pnpm bootstrap                  # 3. instala, migra, popula e constrói
pnpm dev                        # 4. sobe API e painel
```

`pnpm dev` sobe **apenas a API e o painel** — dois processos. Para mexer nos
pacotes internos e vê-los recompilar ao salvar, use `pnpm dev:watch`, que abre
um observador por pacote. Ele é bem mais pesado: dez processos de `tsc --watch`
simultâneos derrubaram o Node por falta de memória numa máquina Windows real
(2026-07-30), e é por isso que ele não é o padrão.

**A ordem importa.** O `docker compose` lê `POSTGRES_PASSWORD` do `.env`, então
ele só funciona depois que o arquivo existe e está preenchido — e o `.env` é
criado pelo primeiro `pnpm bootstrap`. Subir o banco antes falha com
`required variable POSTGRES_PASSWORD is missing a value`.

No **Windows**, os mesmos comandos, no PowerShell aberto dentro da pasta do
projeto (`notepad .env` para editar). O `bootstrap` é um script Node justamente
para funcionar igual nos três sistemas.

> **É `pnpm bootstrap`, não `pnpm setup`.** `setup` é um comando embutido do
> pnpm: um script com esse nome nunca chega a ser chamado, e quem digita acaba
> rodando a configuração do próprio pnpm. Descoberto na primeira instalação em
> máquina Windows, em 2026-07-30.

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

**Portas ocupadas?** As duas são configuráveis no `.env`, e valem para
`pnpm dev`, `pnpm start` e o Docker:

```
WEB_PORT=3005    # painel
API_PORT=3006    # API
NEXT_PUBLIC_API_URL=http://localhost:3006/api/v1   # precisa acompanhar a API
```

Fora de produção, a API libera automaticamente o CORS para o painel local na
porta configurada em `WEB_PORT` — sem isso, trocar a porta do painel quebrava o
login de um jeito que não parecia CORS. Em produção vale exatamente o que
estiver em `CORS_ORIGINS`.

> **Ao mudar `NEXT_PUBLIC_API_URL`, reinicie o painel.** O Next congela as
> variáveis `NEXT_PUBLIC_*` no momento em que o servidor inicia — editar o
> `.env` com o painel já rodando não tem efeito. No navegador, recarregue com
> Ctrl+Shift+R: o JavaScript antigo fica em cache.
>
> O sintoma é o painel dizer "Não foi possível conectar ao servidor" enquanto
> `http://localhost:<API_PORT>/api/health` responde normalmente.

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

| Comando                | O que faz                                                    |
| ---------------------- | ------------------------------------------------------------ |
| `pnpm bootstrap`       | Prepara o ambiente do zero                                   |
| `pnpm dev:watch`       | Recompila os pacotes ao salvar (desenvolvimento dos pacotes) |
| `pnpm sim`             | Sobe um carregador OCPP simulado                             |
| `pnpm dev`             | API e painel em modo desenvolvimento                         |
| `pnpm build`           | Constrói todos os pacotes                                    |
| `pnpm test`            | Roda toda a suíte                                            |
| `pnpm typecheck`       | Verificação de tipos                                         |
| `pnpm exec eslint .`   | Lint                                                         |
| `pnpm format`          | Formata o código                                             |
| `pnpm db:migrate`      | Cria uma migration nova a partir do schema                   |
| `pnpm db:deploy`       | Aplica migrations pendentes                                  |
| `pnpm db:seed`         | Popula dados de desenvolvimento (idempotente)                |
| `pnpm db:studio`       | Abre o Prisma Studio                                         |
| `docker compose up -d` | Sobe tudo em containers                                      |

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

| Fase | Escopo                                                        | Situação                                                                  |
| ---- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 0    | Descoberta, arquitetura, riscos, ADRs                         | ✅ concluída — aguardando validação                                       |
| 1    | Fundação: monorepo, API, web, banco, auth, CI                 | ✅ **concluída**                                                          |
| 2    | Núcleo OCPP 1.6J + simulador                                  | ✅ **concluída**                                                          |
| 3    | Painel de carregadores e operação manual                      | ✅ **concluída**                                                          |
| 4a   | Teste com o WEMOB real em rede local (Ethernet)               | ⬜ bloqueada (requer autorização)                                         |
| 4b   | Teste com infraestrutura pública (`wss://ocpp.sonare.com.br`) | ⬜ bloqueada                                                              |
| 5    | Pagamento simulado                                            | ✅ **concluída**                                                          |
| 6    | Tarifação e regras comerciais                                 | ✅ **concluída**                                                          |
| 7    | Integração com pagamento real                                 | ✅ PagBank verificado 8/8 em produção                                     |
| 8    | SmartPOS / terminal de autoatendimento                        | 🟡 backend pronto; app Android em `apps/maquininha` (aguarda equipamento) |
| 9    | Endurecimento para piloto                                     | ⬜ não iniciada                                                           |

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
- [FASE 7: o que falta](docs/payments/fase-7-o-que-falta.md) — o que já está pronto e testado, e o que só as credenciais de sandbox destravam
- [FASE 8: a maquininha](docs/payments/fase-8-maquininha.md) — identidade do terminal, pareamento, contrato HTTP do aplicativo e o que depende do SDK do fabricante

### Operações

- [Roteiros de incidente](docs/operations/incident-response.md) — o que fazer quando cada alerta aparecer, passo a passo
- [Backup e restauração](docs/operations/backup-restore.md) — gerar é metade; a outra metade é provar que volta
- [Checklist do piloto](docs/operations/pilot-checklist.md) — o piloto só começa com ele assinado
- [Levantamento de dados do WEMOB](docs/operations/wemob-data-collection.md) — formulário a preencher
- [Plano de retorno à Tupi](docs/operations/tupi-rollback-plan.md) — rollback obrigatório antes da FASE 4
- [Checklist de teste do WEMOB](docs/operations/wemob-test-checklist.md) — roteiro da FASE 4

Documentos previstos para fases seguintes: `docs/ocpp/wemob-quirks.md`
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
