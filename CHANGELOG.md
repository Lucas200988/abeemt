# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Este projeto ainda não versiona releases — as entradas são organizadas por fase.

## [Não lançado]

### FASE 0 — Revisão após respostas do cliente — 2026-07-29

Três definições recebidas: domínio `sonare.com.br`, o WEMOB tem **Ethernet**, e
o modelo de cobrança é **pré-autorização + captura pelo consumo real**.

#### Adicionado
- `docs/architecture/adr/0008-pre-autorizacao-e-captura.md` — modelo financeiro, regra de parada automática no teto, tratamento de `void` vs `refund`, e a lacuna de Pix/débito.
- `docs/architecture/adr/0009-topologia-de-dominios.md` — subdomínios dedicados, FASE 4 dividida em local (4a) e pública (4b).
- Riscos R-22 (consumo ultrapassa o pré-autorizado, severidade 16), R-23 (pré-autorização expira antes da captura), R-24 (Pix e débito sem caminho de pagamento), R-25 (valor reservado indisponível), R-26 (firmware pode recusar `ws://`).
- Premissas E11–E14 (rede do equipamento), A8–A9 (DNS), P8–P10 (pagamento).
- Perguntas 14 a 19, decorrentes das novas decisões.
- Checklist: Bloco A.0 (escolha do caminho de rede) e teste B.5.1 (parada automática no teto).

#### Alterado
- **`PaymentProvider`**: `capturePayment` deixa de ser opcional e `voidPayment` é adicionado — suporte a pré-autorização com captura parcial vira critério eliminatório na FASE 7. Altera o ADR-0004.
- **FASE 4 dividida** em 4a (rede local via Ethernet, sem DNS/TLS/VPS) e 4b (infraestrutura pública). A primeira conexão com o equipamento real deixa de depender de cinco camadas de infraestrutura.
- Risco **R-07** (cobrar e não entregar) rebaixado de severidade 15 para 5 — a pré-autorização torna a cobrança indevida estruturalmente improvável. Permanece em 15 para o caminho Pix.
- Risco **R-18** (infraestrutura pública) rebaixado de severidade 16 para 6.
- Plano de rollback: passa a exigir registro da **interface de rede** original e da configuração de IP.
- Premissas P1, P2, A3 e E-rede marcadas como confirmadas.

---

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
