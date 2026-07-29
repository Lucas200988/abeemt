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

**FASE 0 concluída (aguardando validação).** Ainda não há código de aplicação.
Esta entrega contém apenas a documentação de arquitetura, riscos, premissas e os
procedimentos operacionais de proteção do equipamento real.

| Fase | Escopo | Situação |
| --- | --- | --- |
| 0 | Descoberta, arquitetura, riscos, ADRs | ✅ concluída — aguardando validação |
| 1 | Fundação: monorepo, API, web, banco, auth, CI | ⬜ não iniciada |
| 2 | Núcleo OCPP 1.6J + simulador | ⬜ não iniciada |
| 3 | Painel de carregadores e operação manual | ⬜ não iniciada |
| 4 | Teste controlado com o WEMOB real | ⬜ bloqueada (requer autorização) |
| 5 | Pagamento simulado | ⬜ não iniciada |
| 6 | Tarifação e regras comerciais | ⬜ não iniciada |
| 7 | Integração com pagamento real | ⬜ não iniciada |
| 8 | SmartPOS / terminal de autoatendimento | ⬜ não iniciada |
| 9 | Endurecimento para piloto | ⬜ não iniciada |

Cada fase só começa após validação explícita da anterior.

---

## Documentação

### Arquitetura
- [Plano do projeto](docs/architecture/project-plan.md) — arquitetura, estrutura de pastas, stack, fases
- [Premissas e perguntas em aberto](docs/architecture/assumptions.md) — o que estamos assumindo sem confirmação
- [Registro de riscos](docs/architecture/risks.md) — riscos, severidade e mitigações
- [Decisões arquiteturais (ADRs)](docs/architecture/adr/README.md)

### Operações
- [Levantamento de dados do WEMOB](docs/operations/wemob-data-collection.md) — formulário a preencher
- [Plano de retorno à Tupi](docs/operations/tupi-rollback-plan.md) — rollback obrigatório antes da FASE 4
- [Checklist de teste do WEMOB](docs/operations/wemob-test-checklist.md) — roteiro da FASE 4

Documentos previstos para fases seguintes: `docs/operations/incident-response.md`
(FASE 9), `docs/operations/payment-refund.md` (FASE 5), `docs/ocpp/wemob-quirks.md`
(FASE 4), `docs/architecture/data-model.md` (FASE 1), `docs/testing/strategy.md`
(FASE 1).

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

---

## Stack prevista

| Camada | Tecnologia |
| --- | --- |
| Monorepo | pnpm workspaces + Turborepo |
| Backend | Node.js 22 LTS, TypeScript, NestJS 11, `ws`, Swagger |
| Frontend | Next.js 15, React 19, TypeScript, Tailwind + shadcn/ui, TanStack Query |
| Banco | PostgreSQL 16 + Prisma 6 (migrations versionadas) |
| Assincronismo | PostgreSQL com padrão outbox (**sem Redis no MVP** — [ADR-0003](docs/architecture/adr/0003-postgres-outbox-sem-redis.md)) |
| Infra local | Docker + Docker Compose |
| Testes | Vitest, Supertest, Playwright |
| Observabilidade | pino (JSON estruturado), `/health`, `/ready` |

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
