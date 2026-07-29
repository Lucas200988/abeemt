# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Este projeto ainda não versiona releases — as entradas são organizadas por fase.

## [Não lançado]

### FASE 0 — Descoberta, planejamento e proteção do equipamento — 2026-07-29

#### Adicionado
- `README.md` — visão do projeto, situação por fase, stack prevista e compromissos de segurança.
- `CHANGELOG.md` — este arquivo.
- `docs/architecture/project-plan.md` — análise do repositório, arquitetura proposta, estrutura de pastas, dependências, plano de 10 fases e estratégia de testes.
- `docs/architecture/assumptions.md` — 30 premissas classificadas por criticidade e 12 perguntas bloqueantes.
- `docs/architecture/risks.md` — 21 riscos com probabilidade, impacto, severidade e mitigação; análise dedicada ao risco de retirar o equipamento da Tupi.
- `docs/architecture/adr/README.md` — índice de decisões arquiteturais.
- `docs/architecture/adr/0001-monorepo-pnpm-turborepo.md`
- `docs/architecture/adr/0002-nestjs-ocpp-in-process.md`
- `docs/architecture/adr/0003-postgres-outbox-sem-redis.md`
- `docs/architecture/adr/0004-payment-provider-port.md`
- `docs/architecture/adr/0005-dinheiro-centavos-energia-wh.md`
- `docs/architecture/adr/0006-estado-de-sessao-no-banco.md`
- `docs/architecture/adr/0007-nome-do-produto-configuravel.md`
- `docs/operations/wemob-data-collection.md` — formulário de levantamento de 42 dados do equipamento.
- `docs/operations/tupi-rollback-plan.md` — procedimento de retorno à Tupi, pré-requisito da FASE 4.
- `docs/operations/wemob-test-checklist.md` — roteiro de teste controlado com o WEMOB real.

#### Não alterado (deliberadamente)
- `index.html` — media kit do Fórum BESS 2026 (AMEE), preexistente no repositório e sem relação com este projeto. Preservado sem modificação.

#### Notas
- Nenhuma alteração, conexão ou comando foi executado contra o carregador WEG WEMOB real.
- Nenhum código de aplicação foi escrito nesta fase, conforme escopo da FASE 0.
