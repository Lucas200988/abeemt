# ADR-0001 — Monorepo com pnpm workspaces e Turborepo

- **Status:** Aceito
- **Data:** 2026-07-29
- **Fase:** 0

## Contexto

O MVP tem quatro aplicações (API, painel web, worker, simulador OCPP) que
compartilham tipos, contratos de API, enums de domínio e a definição das
mensagens OCPP. Se essas peças viverem em repositórios separados, qualquer
mudança de contrato exige publicar pacote, versionar e sincronizar — atrito
desproporcional para uma equipe pequena num MVP.

Ao mesmo tempo, um repositório único sem ferramenta de orquestração vira um
`package.json` gigante com dependências misturadas entre backend e frontend.

## Decisão

Adotar **monorepo com pnpm workspaces** como base, e **Turborepo** apenas como
orquestrador de tasks com cache.

- `pnpm` pela instalação eficiente (store por conteúdo, links simbólicos) e por
  ser rigoroso com dependências não declaradas — o que evita o "funciona na minha
  máquina" causado por hoisting acidental.
- `turbo` para `build`, `lint`, `typecheck` e `test` com grafo de dependência e
  cache local. Sem `turbo`, rodar a suíte inteira a cada alteração fica lento
  rápido demais.

O briefing pedia para usar Turborepo "caso realmente agregue valor". A avaliação:
com 4 apps + 7 packages, o cache incremental paga o custo de configuração já na
FASE 2. Se ao final da FASE 1 a percepção for de complexidade sem retorno,
`turbo` pode ser removido sem tocar em nenhuma linha de código de aplicação —
os scripts continuam funcionando via `pnpm -r`.

## Alternativas consideradas

| Alternativa | Por que não |
| --- | --- |
| Repositórios separados | Atrito de versionamento de contratos; inviável no ritmo do MVP |
| Monorepo só com `pnpm -r` | Funciona, mas sem cache nem grafo; adotável como fallback |
| Nx | Mais poderoso, mais opinativo, curva de aprendizado maior que o necessário |
| npm/yarn workspaces | Funcionam; pnpm ganha em disciplina de dependências e velocidade |

## Consequências

**Positivas**
- Contratos compartilhados sem publicação de pacote.
- Refatoração atômica: mudar um enum e todos os consumidores no mesmo commit.
- CI única, com cache por task.

**Negativas**
- Exige disciplina de fronteiras: um package não pode importar de um app.
  Será garantido por regra de ESLint (`no-restricted-imports`).
- Desenvolvedores não familiarizados com pnpm precisam de um passo a mais no
  onboarding (documentado no README).

**Neutras**
- Deploy continua independente por app (Dockerfile por aplicação).
