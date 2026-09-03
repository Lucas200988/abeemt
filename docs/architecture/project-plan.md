# Borá Carregar — Plano de Projeto (MVP)

> Nome provisório do produto: **Borá Carregar**
> Nome técnico do repositório/monorepo: `sonare-charge`
> Documento vivo — atualizado ao final de cada fase.

---

## 1. Resumo executivo

O **Borá Carregar** é uma camada independente de monetização para carregadores
veiculares que já falam OCPP. O objetivo não é competir em funcionalidades com
plataformas de gestão de rede (como a Tupi atualmente utilizada), e sim resolver
um problema específico:

> Permitir que um carregador OCPP já instalado passe a aceitar pagamento por
> cartão ou Pix, **sem aplicativo** e **sem cadastro prévio do motorista**.

O MVP prova, ponta a ponta, o fluxo:

```
Pagamento aprovado
  → backend identifica carregador/conector
  → RemoteStartTransaction via OCPP 1.6J
  → StartTransaction + MeterValues recebidos
  → sessão monitorada
  → RemoteStopTransaction / StopTransaction
  → energia e valor calculados
  → sessão encerrada e registrada
  → dados visíveis no painel administrativo
```

Equipamento de referência do MVP: **WEG WEMOB Station, ~30 kW, 4G, OCPP 1.6 JSON**,
hoje conectado ao servidor OCPP da Tupi.

---

## 2. Análise do repositório atual (estado em 2026-07-29)

| Item                     | Situação                                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch de trabalho       | `claude/sonare-charge-ocpp-mvp-ptri6r`                                                                                                                           |
| Histórico                | 1 commit (`Add files via upload`)                                                                                                                                |
| Arquivos versionados     | `index.html` (1.316 linhas)                                                                                                                                      |
| Conteúdo do `index.html` | Media kit estático do "Fórum Mato-grossense de Engenharia Elétrica e Energias Sustentáveis (BESS 2026)" da AMEE — HTML + CSS inline, sem build, sem dependências |
| Relação com este projeto | **Nenhuma.** É material institucional/comercial de outro assunto                                                                                                 |
| Ação tomada              | **Nenhum arquivo apagado.** O `index.html` permanece intocado na raiz                                                                                            |

**Conclusão:** o repositório é, para efeitos práticos, um greenfield. Não há
código de backend, frontend, banco, CI, testes ou infraestrutura a reaproveitar.

### Decisão sobre o `index.html`

Manter na raiz até que você decida o destino. Três opções, sem urgência:

1. Mover para `legacy/forum-bess-2026/index.html` (preserva histórico, tira da raiz).
2. Mover para outro repositório (é material de marketing de outro projeto).
3. Manter onde está (o monorepo não conflita — nada será servido a partir da raiz).

**Recomendação:** opção 1, na FASE 1, com commit dedicado. Não faremos isso sem
sua autorização, conforme a regra "não apagar/alterar código existente sem justificar".

---

## 3. Arquitetura final proposta do MVP

### 3.1 Visão em camadas

```
┌──────────────────────────────────────────────────────────────────────┐
│  CANAIS DE ENTRADA                                                   │
│  • Painel Admin (Next.js)   • Terminal/SmartPOS (fase 8)             │
│  • Webhook do adquirente    • Página de pagamento simulado (fase 5)   │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ HTTPS / REST + JWT
┌───────────────────────────▼──────────────────────────────────────────┐
│  apps/api  (NestJS)                                                  │
│                                                                      │
│  ┌────────────────┐ ┌────────────────┐ ┌─────────────────────────┐   │
│  │ Módulo Auth    │ │ Módulo Admin   │ │ Módulo Payments         │   │
│  │ JWT + RBAC     │ │ CRUD + queries │ │ PaymentProvider (port)  │   │
│  └────────────────┘ └────────────────┘ └───────────┬─────────────┘   │
│                                                     │                 │
│  ┌──────────────────────────────────────────────────▼─────────────┐   │
│  │ Módulo Sessions — MÁQUINA DE ESTADOS (núcleo do domínio)       │   │
│  │ • orquestra pagamento ⇄ OCPP  • idempotência  • timeouts       │   │
│  │ • tarifação (snapshot)        • cálculo de energia e valor     │   │
│  └──────────────────────────────────────────────────┬─────────────┘   │
│                                                     │                 │
│  ┌──────────────────────────────────────────────────▼─────────────┐   │
│  │ Módulo OCPP — Gateway WebSocket (subprotocolo ocpp1.6)         │   │
│  │ • ConnectionRegistry  • CallDispatcher (+timeout/retry)        │   │
│  │ • Handlers inbound    • Log de todas as mensagens              │   │
│  └──────────────────────────────────────────────────┬─────────────┘   │
└─────────────────────────────────────────────────────┼─────────────────┘
                                                      │ ws:// / wss://
                            ┌─────────────────────────┴──────────────┐
                            │                                        │
                  ┌─────────▼─────────┐                  ┌───────────▼──────────┐
                  │ apps/ocpp-simulator│                  │ WEG WEMOB Station    │
                  │ (dev + testes)     │                  │ (somente FASE 4+)    │
                  └────────────────────┘                  └──────────────────────┘

                     ┌────────────────────────────────────┐
                     │ PostgreSQL (fonte da verdade)      │
                     │ + outbox/jobs table                │
                     └────────────────────────────────────┘
                     ┌────────────────────────────────────┐
                     │ apps/worker (mesmo código, outro   │
                     │ processo): timeouts, outbox, retry │
                     └────────────────────────────────────┘
```

### 3.2 Princípios arquiteturais que guiam todas as fases

1. **O banco é a fonte da verdade do estado comercial.** A conexão WebSocket em
   memória diz apenas se o carregador está _alcançável agora_. Se a API reiniciar
   no meio de uma recarga, a sessão continua existindo, com estado consistente, e
   é reconciliada quando o carregador reconecta.
2. **Dinheiro é sempre inteiro em centavos.** Nenhum `float`/`double` toca valor
   monetário. Energia é sempre inteiro em **Wh** no banco; kWh só na apresentação.
3. **Idempotência por construção.** Toda entrada externa (webhook de pagamento,
   `StartTransaction`, comando administrativo) carrega uma chave de idempotência e
   é protegida por constraint única no banco — não por lógica em memória.
4. **Uma sessão ativa por conector**, garantida por índice único parcial no
   PostgreSQL, não apenas por validação de aplicação.
5. **Pagamento é uma porta (port/adapter).** O domínio nunca conhece adquirente.
6. **Simulador antes do equipamento real.** Nenhuma linha de integração é
   considerada pronta sem passar no simulador primeiro.
7. **Nada de terminologia OCPP crua na UI.** Mensagem humana para o operador;
   detalhe técnico numa aba de diagnóstico.
8. **Simplicidade > completude.** Fora do escopo do MVP não entra "de brinde".

### 3.3 Decisões técnicas principais (detalhadas nos ADRs)

| #                                                    | Decisão                                          | Resumo                                                                              |
| ---------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [ADR-0001](adr/0001-monorepo-pnpm-turborepo.md)      | Monorepo pnpm + Turborepo                        | Workspaces pnpm; Turborepo só pelo cache/orquestração de tasks                      |
| [ADR-0002](adr/0002-nestjs-ocpp-in-process.md)       | Servidor OCPP dentro do processo da API          | Um único processo Node no MVP; caminho de extração documentado                      |
| [ADR-0003](adr/0003-postgres-outbox-sem-redis.md)    | PostgreSQL + outbox, **sem Redis/BullMQ** no MVP | `FOR UPDATE SKIP LOCKED` cobre as necessidades; Redis fica como gatilho documentado |
| [ADR-0004](adr/0004-payment-provider-port.md)        | `PaymentProvider` como porta                     | Mock + Manual no MVP; adapter real só na FASE 7                                     |
| [ADR-0005](adr/0005-dinheiro-centavos-energia-wh.md) | Centavos inteiros e Wh inteiros                  | Proíbe ponto flutuante em dinheiro e energia                                        |
| [ADR-0006](adr/0006-estado-de-sessao-no-banco.md)    | Estado da sessão persistido                      | Máquina de estados no banco, recuperável após restart                               |
| [ADR-0007](adr/0007-nome-do-produto-configuravel.md) | Marca configurável                               | "Borá Carregar" vive em config, não espalhado no código                             |
| [ADR-0008](adr/0008-pre-autorizacao-e-captura.md)    | **Pré-autorização + captura pelo consumo real**  | Reserva → entrega → captura parcial; exige parada automática no teto                |
| [ADR-0009](adr/0009-topologia-de-dominios.md)        | Subdomínios dedicados em `sonare.com.br`         | `ocpp.` / `api.` / `painel.`; `www` intocado; FASE 4 dividida em local + pública    |
| [ADR-0010](adr/0010-pix-valor-fixo.md)               | **Pix como crédito de valor fixo**               | Sem devolução automática, exceto consumo zero; parada automática ao esgotar o valor |

### 3.4 Fluxo financeiro (decidido em 2026-07-29)

O modelo é **pré-autorização + captura pelo consumo real** — o motorista paga
exatamente o que consumiu.

```
Reserva de R$ 100 no cartão (não cobrado)
   → recarga inicia
   → sistema recalcula o valor a cada MeterValues
   → ao atingir 95% do teto: RemoteStopTransaction automático
   → StopTransaction: energia final conhecida
   → CAPTURA de R$ 37,40 (valor real)
   → R$ 62,60 liberados pelo emissor
```

Consequências que atravessam várias fases:

1. `capturePayment` **deixa de ser opcional** na porta `PaymentProvider`, e
   `voidPayment` é adicionado. Suporte a pré-autorização com captura parcial
   vira **critério eliminatório** na matriz de adquirentes da FASE 7.
2. O valor pré-autorizado é um **teto rígido** da sessão. Nasce daí uma regra de
   negócio nova: parada automática da recarga antes de ultrapassá-lo (risco R-22,
   severidade 16 — o mais alto do projeto junto com R-08 e R-13).
   O teto padrão é **R$ 200,00**, configurável por carregador → estabelecimento →
   organização → global ([ADR-0008 §9](adr/0008-pre-autorizacao-e-captura.md)).
   É um valor generoso: reduz paradas automáticas, mas bloqueia mais limite do
   cartão (R-25) e faz a parada automática ser raramente exercitada em produção
   (R-29). Deve ser calibrado após o piloto.
3. Falha antes do início gera `void` (cancelamento da reserva), **não** estorno.
   Nenhuma cobrança acontece. Isso derruba o risco R-07 de severidade 15 para 5.
4. A captura precisa acontecer logo após a sessão, não em lote — pré-autorizações
   expiram (risco R-23).
5. **Pix não tem pré-autorização** e por isso segue um modelo próprio — ver abaixo.

### 3.5 Fluxo do Pix (decidido em 2026-07-29)

Pix funciona como **crédito pré-pago de valor fixo**
([ADR-0010](adr/0010-pix-valor-fixo.md)) — o motorista escolhe R$ 30, paga, e
recebe energia até esgotar o valor. Sem devolução automática do saldo.

Isso cria **dois modelos de cobrança no mesmo produto**, e a diferença precisa
estar visível na interface antes do pagamento:

|                             | Cartão de crédito                      | Pix                                             |
| --------------------------- | -------------------------------------- | ----------------------------------------------- |
| Cobrança                    | Depois, pelo consumido                 | Antes, valor escolhido                          |
| Teto da sessão              | Valor pré-autorizado                   | Valor pago                                      |
| Limiar de parada automática | **95%** — ultrapassar é prejuízo nosso | **~100%** — parar antes é prejuízo do motorista |
| Sobra não consumida         | Não existe                             | Fica com o estabelecimento                      |
| Falha antes de iniciar      | `void`, nada cobrado                   | **Devolução automática obrigatória**            |

Dois pontos que atravessam o projeto:

1. A máquina de parada automática é **a mesma** dos dois lados — muda só o
   limiar. É isso que torna o Pix barato de implementar.
2. `refundPayment` **funcionando de verdade para Pix** é requisito eliminatório
   do PSP na FASE 7. A simplificação é de fluxo, não de infraestrutura: o caso de
   consumo zero exige devolver (risco R-27, severidade 15).

---

## 4. Estrutura de pastas proposta

Segue a estrutura sugerida no briefing, com dois ajustes justificados adiante.

```text
/  (raiz do repositório)
├── index.html                     # material legado — preservado (ver §2)
├── apps/
│   ├── api/                       # NestJS: REST + OCPP WebSocket + Swagger
│   ├── web/                       # Next.js: painel administrativo (pt-BR)
│   ├── worker/                    # processo de jobs: timeouts, outbox, retries
│   └── ocpp-simulator/            # simulador OCPP 1.6J (CLI + lib p/ testes)
├── packages/
│   ├── contracts/                 # tipos/DTOs/enums compartilhados API ⇄ web
│   ├── ocpp-core/                 # tipos, parser e validação OCPP 1.6J (sem I/O)
│   ├── payment-core/              # interface PaymentProvider + providers Mock/Manual
│   ├── database/                  # schema Prisma, migrations, seeds, PrismaClient
│   ├── config/                    # carregamento/validação de env (zod)
│   ├── logger/                    # logger estruturado JSON (pino) + contexto
│   └── ui/                        # componentes React compartilhados (se necessário)
├── infra/
│   ├── docker/                    # Dockerfiles (api, web, worker, simulator)
│   └── nginx/                     # reverse proxy + TLS/WSS (usado na FASE 4)
├── docs/
│   ├── architecture/              # plano, premissas, riscos, ADRs, modelo de dados
│   ├── ocpp/                      # mensagens suportadas, comportamento, quirks WEMOB
│   ├── payments/                  # abstração, matriz de adquirentes, webhooks
│   ├── testing/                   # estratégia e matriz de testes
│   └── operations/                # runbooks, checklists, rollback, incidentes
├── scripts/                       # utilitários de dev (bootstrap, reset db, etc.)
├── .github/workflows/             # CI (lint, typecheck, test, build)
├── docker-compose.yml
├── .env.example
├── README.md
└── CHANGELOG.md
```

### Ajustes em relação à sugestão original (e por quê)

1. **`packages/ocpp-core` é puro, sem I/O.** Contém apenas tipos, parser,
   validadores e a máquina de mensagens (CALL/CALLRESULT/CALLERROR). O servidor
   WebSocket propriamente dito fica em `apps/api/src/ocpp/`. Motivo: assim o
   `ocpp-core` é testável em milissegundos, sem rede, e é reaproveitado
   integralmente pelo simulador — que precisa da mesma serialização, mas do lado
   cliente. Isso força que o simulador seja um teste real do parser, não uma
   implementação paralela que "concorda consigo mesma".
2. **`apps/worker` compartilha o código de `apps/api`.** Não é uma base separada:
   é o mesmo `AppModule` iniciado sem o listener HTTP, apenas com os
   schedulers. Motivo: evita divergência de regra de negócio entre os dois
   processos. Se no futuro justificar separação, o corte já está claro.
3. **`packages/ui` só será criado se houver reuso real.** No MVP existe um único
   frontend. Criar um pacote de UI para um consumidor só é abstração prematura.
   Fica reservado na estrutura, criado quando (e se) surgir o terminal da FASE 8.

---

## 5. Stack e principais dependências

### Backend — `apps/api`, `apps/worker`

| Dependência                             | Papel                                      | Observação                                                                |
| --------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| Node.js 22 LTS                          | runtime                                    | LTS ativa; fixada via `.nvmrc` e `engines`                                |
| TypeScript 5.x                          | linguagem                                  | `strict: true` em todos os pacotes                                        |
| NestJS 11                               | framework                                  | módulos, DI, guards, interceptors, validation pipe                        |
| `@nestjs/swagger`                       | OpenAPI                                    | Swagger UI em `/docs`                                                     |
| `ws`                                    | WebSocket                                  | servidor OCPP; escolhido por controle fino do handshake e do subprotocolo |
| Prisma 6                                | ORM + migrations                           | migrations versionadas em `packages/database`                             |
| `zod`                                   | validação de env e payloads OCPP           | DTOs REST usam `class-validator` (idiomático NestJS)                      |
| `class-validator` / `class-transformer` | DTOs REST                                  | validação declarativa + `whitelist: true`                                 |
| `pino` + `nestjs-pino`                  | logs estruturados JSON                     | `requestId`, `correlationId`, `sessionId`, `chargerId`                    |
| `argon2`                                | hash de senhas e credenciais de carregador | preferido a bcrypt para novos projetos                                    |
| `@nestjs/jwt` + `passport-jwt`          | autenticação                               | access token curto + refresh                                              |
| `@nestjs/throttler`                     | rate limiting                              | login e webhooks                                                          |
| `@nestjs/schedule`                      | agendadores do worker                      | varredura de timeouts e outbox                                            |
| `@nestjs/terminus`                      | health/readiness                           | `/health` e `/ready` com check de banco                                   |
| `helmet`                                | headers de segurança                       |                                                                           |

### Frontend — `apps/web`

| Dependência                      | Papel                                                   |
| -------------------------------- | ------------------------------------------------------- |
| Next.js 15 (App Router)          | framework React                                         |
| React 19 + TypeScript            | UI                                                      |
| Tailwind CSS + shadcn/ui (Radix) | design system acessível, responsivo, sob nosso controle |
| TanStack Query                   | cache/estado de servidor, polling do painel ao vivo     |
| `react-hook-form` + `zod`        | formulários validados                                   |
| `date-fns` (locale `pt-BR`)      | datas em formato brasileiro                             |
| `Intl.NumberFormat('pt-BR')`     | moeda em BRL, sem biblioteca extra                      |

### Banco / Infra

| Dependência             | Papel                             |
| ----------------------- | --------------------------------- |
| PostgreSQL 16           | banco relacional                  |
| Docker + Docker Compose | ambiente local reproduzível       |
| Nginx                   | reverse proxy, TLS e WSS (FASE 4) |

### Testes / Qualidade

| Dependência                             | Papel                                           |
| --------------------------------------- | ----------------------------------------------- |
| Vitest                                  | unitários e de integração (rápido, ESM-first)   |
| Supertest                               | testes de API HTTP                              |
| Testcontainers (ou Postgres do compose) | banco real nos testes de integração             |
| Playwright                              | E2E do painel nos fluxos críticos (fases 3 e 5) |
| ESLint + Prettier                       | lint e formatação                               |
| `lint-staged` + `husky`                 | checagem no pre-commit                          |
| GitHub Actions                          | CI: lint → typecheck → test → build             |

**Deliberadamente ausentes no MVP:** Redis, BullMQ, Kafka, microserviços,
GraphQL, Kubernetes. Cada um entra apenas quando um gatilho documentado no
[ADR-0003](adr/0003-postgres-outbox-sem-redis.md) for atingido.

---

## 6. Modelo de dados — visão de alto nível

Entidades conforme o briefing: `Organization`, `Site`, `Charger`, `Connector`,
`ChargingSession`, `MeterValue`, `Tariff`, `Payment`, `OcppMessage`, `AuditLog`,
mais `User` (autenticação/RBAC, exigido pela FASE 1) e `OutboxCommand`
(comandos OCPP pendentes com retry — ver ADR-0003).

Invariantes que serão garantidas **no banco**, não só no código:

| Invariante                                 | Mecanismo                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| Uma sessão ativa por conector              | índice único parcial em `connector_id WHERE status IN (estados ativos)` |
| Um pagamento inicia no máximo uma sessão   | `UNIQUE(payment_id)` em `charging_sessions`                             |
| Webhook duplicado não reprocessa           | `UNIQUE(provider, provider_event_id)` na tabela de eventos              |
| Comando duplicado não é enviado duas vezes | `UNIQUE(idempotency_key)` em `outbox_commands`                          |
| `chargePointIdentity` único                | `UNIQUE` em `chargers`                                                  |
| Transação OCPP única por carregador        | `UNIQUE(charger_id, ocpp_transaction_id)`                               |

O detalhamento campo a campo (tipos, nulabilidade, índices) será entregue na
FASE 1 em `docs/architecture/data-model.md`, junto com o schema Prisma real.

---

## 7. Plano de fases

Regra transversal: **nenhuma fase começa sem sua validação explícita da anterior.**
Antes de cada fase apresento objetivo, decisões, arquivos, riscos e critérios de
aceite; depois, o que foi feito, testes executados e resultado real.

| Fase   | Escopo                                                                                                                                 | Entrega verificável                                                                                                                                                              | Depende de                                      |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **0**  | Descoberta, arquitetura, riscos, ADRs, dados pendentes do WEMOB                                                                        | Documentos desta entrega                                                                                                                                                         | —                                               |
| **1**  | Fundação: monorepo, API, web, Postgres, Docker, migrations, auth+RBAC, health, Swagger, logger, lint, CI                               | `docker compose up` sobe tudo; login funciona; testes básicos passam                                                                                                             | 0                                               |
| **2**  | Núcleo OCPP 1.6J + simulador; fluxo completo Boot→Start→Meter→Stop                                                                     | Teste automatizado E2E com simulador, verde                                                                                                                                      | 1                                               |
| **3**  | Painel de carregadores e operação manual (start/stop, sessão ao vivo, mensagens OCPP)                                                  | Operador inicia/encerra carga pelo painel contra o simulador                                                                                                                     | 2                                               |
| **4a** | Teste com o WEMOB real em **rede local** (Ethernet, `ws://`, sem DNS/TLS/VPS)                                                          | WEMOB conecta ao notebook na LAN; Boot/Heartbeat/Status recebidos; sessão remota inicia e encerra                                                                                | 3 + **sua autorização explícita**               |
| **4b** | Teste com **infraestrutura pública** (`wss://ocpp.sonare.com.br`, VPS, TLS)                                                            | Mesmo fluxo pela internet, com o equipamento em condição de produção                                                                                                             | 4a                                              |
| **5**  | Pagamento simulado: `PaymentProvider` com autorizar/capturar/cancelar, Mock, webhook, idempotência, parada no teto                     | Falha antes do início gera `void`; sessão para sozinha no teto; webhook duplicado não duplica                                                                                    | 2 (real: 4)                                     |
| **6**  | Tarifação: kWh, taxa fixa, tempo, mínimo, máximo, arredondamento, snapshot na sessão                                                   | Casos-limite cobertos por testes determinísticos                                                                                                                                 | 5                                               |
| **7**  | Matriz comparativa de adquirentes → **Rede escolhida (2026-07-31)** → adapter real em sandbox                                          | **Feito**: sandbox real aprovou 8/8 — reserva, captura parcial, devolução, cancelamento, recusa. Webhook: a Rede não assina; desenho equivalente (token + consulta) implementado | 6 + sua escolha                                 |
| **8**  | SmartPOS — **caminho A escolhido em 2026-07-31**. Lado do servidor concluído; o aplicativo do equipamento depende do SDK do fabricante | Terminal identificado inicia sessão no carregador correto — **feito** (`maquininha.e2e-spec.ts`)                                                                                 | 7 (parcial: o servidor não dependeu do sandbox) |
| **9**  | Endurecimento para piloto: backup, alertas, testes de caos, runbooks                                                                   | Checklist de piloto assinado; nenhuma sessão sem estado definido                                                                                                                 | 8                                               |

### Por que a FASE 4 foi dividida (revisão de 2026-07-29)

Com a confirmação de que **o WEMOB tem porta Ethernet**, a primeira conexão com
o equipamento real não precisa mais depender de VPS, DNS, certificado TLS e
qualidade do sinal 4G ao mesmo tempo:

```
FASE 4a:  WEMOB ──cabo──► roteador local ──► notebook rodando a API
          ws://192.168.x.x:3001/ocpp/{identity}
          Se falhar, o problema está no OCPP — e em nada mais.

FASE 4b:  WEMOB ──4G/Ethernet──► internet ──► ocpp.sonare.com.br ──► API
          wss://, TLS válido, VPS, firewall
```

Isso rebaixa o risco R-18 de severidade 16 para 6 e encurta a janela de
indisponibilidade do equipamento na primeira tentativa.

**Confirmado em 2026-07-29:** existe cabo de rede até o carregador e temos
controle do DNS de `sonare.com.br`. A 4a está viável e a 4b pode ser
provisionada. Faltam duas confirmações técnicas do equipamento — se o firmware
aceita `ws://` sem TLS em rede privada (pergunta 23 / risco R-26) e se a troca de
interface é reversível (pergunta 16) — e a decisão de onde hospedar (pergunta 13).

### Ordem sugerida e desvio consciente

O briefing coloca a FASE 4 (WEMOB real) antes da FASE 5 (pagamento simulado).
Mantemos essa numeração, mas registro uma observação para sua decisão:

> As fases 5 e 6 **não dependem tecnicamente** do equipamento real — elas
> dependem do simulador (fase 2). Se a janela de testes com o WEMOB demorar a
> abrir (feriado, indisponibilidade da equipe, risco operacional), podemos
> avançar 5 e 6 em paralelo e executar a 4 quando a janela existir, sem
> retrabalho. **Não farei isso sem sua autorização** — é apenas uma alavanca
> disponível para não travar o cronograma.

---

## 8. Estratégia de testes (resumo)

Detalhamento completo virá em `docs/testing/strategy.md` na FASE 1.

| Nível      | O quê                                                                                                                                                         | Onde                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Unitário   | parser OCPP, cálculo de energia, cálculo tarifário, máquina de estados, arredondamento                                                                        | `packages/*`, sem banco, sem rede     |
| Integração | repositórios, constraints do banco, idempotência sob concorrência real                                                                                        | Postgres real (Docker/Testcontainers) |
| API        | rotas REST, auth, RBAC, validação, rate limit                                                                                                                 | Supertest sobre app Nest              |
| OCPP       | simulador ↔ servidor: handshake, boot, heartbeat, status, remote start/stop, meter values, reconexão, timeout, CALLERROR, JSON inválido, action não suportada | `apps/api` + `apps/ocpp-simulator`    |
| E2E        | fluxos críticos do painel: cadastrar carregador → iniciar → acompanhar → encerrar                                                                             | Playwright                            |

**Compromisso:** nenhuma afirmação de "funciona" sem a saída real do teste
correspondente colada na entrega da fase.

---

## 9. Critérios de aceite da FASE 0

| Critério                              | Status                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| Arquitetura documentada               | ✅ este documento + 7 ADRs                                                            |
| Riscos documentados                   | ✅ [`risks.md`](risks.md)                                                             |
| Premissas documentadas                | ✅ [`assumptions.md`](assumptions.md)                                                 |
| Lista de dados pendentes do WEMOB     | ✅ [`../operations/wemob-data-collection.md`](../operations/wemob-data-collection.md) |
| Plano de retorno à Tupi               | ✅ [`../operations/tupi-rollback-plan.md`](../operations/tupi-rollback-plan.md)       |
| Checklist de teste do WEMOB           | ✅ [`../operations/wemob-test-checklist.md`](../operations/wemob-test-checklist.md)   |
| Nenhuma alteração no equipamento real | ✅ nenhum comando, conexão ou configuração foi executada contra o WEMOB               |
| Nenhum arquivo existente apagado      | ✅ `index.html` preservado sem modificação                                            |

---

## 10. Próximo passo

Aguardo sua validação da FASE 0 e, principalmente, as respostas às perguntas
bloqueantes listadas em [`assumptions.md`](assumptions.md) §5 e os dados de
[`../operations/wemob-data-collection.md`](../operations/wemob-data-collection.md).

Com o "ok", inicio a **FASE 1 — Fundação do projeto**, apresentando antes o
plano detalhado da fase no formato acordado.
