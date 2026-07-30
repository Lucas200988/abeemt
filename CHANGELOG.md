# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Este projeto ainda não versiona releases — as entradas são organizadas por fase.

## [Não lançado]

### Instalação em Windows — 2026-07-30

Primeira instalação do projeto numa máquina Windows expôs três defeitos no
caminho de primeira execução. Nenhum deles aparecia no ambiente de
desenvolvimento, onde os comandos eram executados um a um com o `.env` já
carregado no shell.

#### Corrigido

- **`pnpm setup` nunca chamava o script do projeto.** `setup` é um comando
  embutido do pnpm e tem precedência sobre scripts do `package.json` — quem
  digitava acabava rodando a configuração do próprio pnpm. O script foi
  renomeado para **`pnpm bootstrap`**, que não colide com nenhum comando.
- **As migrations não achavam o `.env`.** O Prisma procura o arquivo no
  diretório do pacote, não na raiz do monorepo, e `pnpm db:deploy` falhava com
  `Environment variable not found: DATABASE_URL`. Os scripts do
  `@bora/database` passaram a usar `dotenv -e ../../.env --`, que funciona igual
  nos três sistemas.
- **O script de instalação era bash.** `scripts/setup.sh` não roda no
  PowerShell. Reescrito como `scripts/bootstrap.mjs`, em Node, com `shell: true`
  no Windows (lá o `pnpm` é um `.cmd` e o Node recusa executá-lo direto).

#### Adicionado

- `scripts/bootstrap.mjs` — verifica Node e pnpm, cria o `.env` na primeira
  execução e para pedindo que seja preenchido, recusa `.env` com placeholders,
  e explica o que fazer quando o banco não está de pé.

#### Removido

- `scripts/setup.sh`, substituído pelo equivalente multiplataforma.

### Documentação de pagamentos — 2026-07-29

#### Adicionado

- `docs/payments/arquitetura-de-cobranca.md` — como o motorista paga, os dois caminhos possíveis (SmartPOS com app próprio, e QR Code no navegador do motorista) desenhados passo a passo, e o que já funciona em cada etapa. Deixa explícito que tudo até a FASE 6 é independente da escolha de fornecedor: o que depende é um adapter na FASE 7.
- `docs/payments/matriz-adquirentes.md` — cinco critérios eliminatórios, matriz para preencher e roteiro de e-mail para consulta a fornecedores.

#### Prova de mercado

Registrada publicação da **Go Electric E-Mobility** mostrando o modelo do ADR-0008 **rodando em produção no Brasil**: terminal montado no carregador, autoatendimento, pré-autorização e cobrança do valor exato consumido.

Isso resolve na prática três critérios que estavam sem resposta — pré-autorização, captura parcial e operação não assistida. O terminal aparente nas imagens parece ser uma Moderninha Smart 2 (PagBank), com leitura não nítida — registrado como indício, não como certeza.

Dois detalhes de projeto extraídos: eles exigem **senha no cartão físico** (o que confirma a preocupação com limite de valor por aproximação) e oferecem **NFC por celular ou smartwatch** como alternativa, já que carteira digital tem biometria. E mantêm os **dois canais** — o QR do aplicativo e a maquininha convivem.

#### Alterado

- **Recomendação revisada.** A primeira versão favorecia o caminho QR pesando que o SmartPOS tinha viabilidade não confirmada. Com a prova de mercado, esse risco caiu: a escolha deixou de ser técnica e passou a ser econômica. A revisão está marcada no documento, com o que passou a favorecer cada lado.

---

### FASE 3 — Painel de carregadores e operação manual — 2026-07-29

O painel passa a operar o sistema. **Nada foi conectado ao WEMOB real** — é a FASE 4.

#### Adicionado

**API**

- `sites` — cadastro e edição de estabelecimento, com fuso horário e teto próprio.
- `chargers` — cadastro com conectores, edição, bloqueio/liberação, geração e rotação de credencial individual, e listagem das mensagens OCPP para diagnóstico. A resposta traz o teto efetivo **e de onde ele veio** na hierarquia do ADR-0008 §9.
- `sessions` — listagem, detalhe com linha do tempo, leituras de energia relativas ao início, início manual, parada e cancelamento.
- `dashboard/overview` — indicadores do dia, sessões ativas, recentes e falhas. O recorte de "hoje" usa o fuso do estabelecimento, não UTC: em Mato Grosso a diferença é de 4 horas.
- `AuditService` — toda operação manual registra quem, o quê, quando, de onde, e o valor antes e depois. Falha de auditoria nunca interrompe a operação.
- `tenant-scope` — escopo por organização aplicado no **serviço**, não no controller: um endpoint novo que esqueça de filtrar não passa a vazar dados.

**Painel**

- Navegação lateral com visão geral, carregadores, sessões, estabelecimentos e diagnóstico.
- Detalhe do carregador com operação: iniciar, parar, bloquear, liberar, gerar credencial.
- Sessão ao vivo com linha do tempo, gráfico de energia em SVG puro e área de diagnóstico técnico.
- Diagnóstico OCPP com filtros por ação, direção e erro, e botão de pausar para conseguir ler uma mensagem.
- Ações de operação aparecem conforme o papel: visualizador não vê botão que não pode usar.

**Decisão**

- [ADR-0011](docs/architecture/adr/0011-painel-por-polling.md) — atualização por polling, não WebSocket, com intervalo por tela e redução automática em sessão encerrada.

#### Corrigido durante a fase

- **Início manual com carregador offline travava o conector para sempre.** As pré-condições do `remoteStart` retornavam sem alterar o status, e a sessão ficava em `PAYMENT_APPROVED` — ocupando o conector pelo índice da regra 11.1 e impedindo qualquer tentativa nova. Descoberto testando com o simulador desconectado.
- **Listagens quebravam com 400.** Dois `@Query()` no mesmo endpoint fazem cada DTO validar a query inteira, e `forbidNonWhitelisted` rejeitava o que o outro declarava: `?pageSize=50` derrubava a tela. Um DTO por endpoint, herdando a paginação.
- **Sessão saudável aparecia com alerta vermelho.** O início manual gravava uma nota em `failureReason`, campo que significa falha. A informação já está no `AuditLog`; a ausência de `paymentId` é o que identifica sessão sem pagamento.
- **Erros de tipo que o SWC dos testes não acusava.** Os `include` do Prisma vinham de métodos, o que faz a inferência cair no modelo base sem as relações. Passaram a ser consts com `satisfies`. Também um `TS2742` na listagem de mensagens, resolvido com um tipo de visão próprio em vez do modelo do Prisma.
- Supressão de lint removida do hook de polling: a assinatura passou a receber uma chave em vez de um array de dependências.

#### Testes

207 testes no total (37 novos), todos passando. Os novos cobrem principalmente o que não dá para verificar clicando: isolamento entre duas organizações independentes (listagens, detalhe, mensagens, sessões, indicadores do dia), controle por papel, hierarquia do teto, auditoria, e a regressão dos dois defeitos acima.

O critério de aceite da fase foi verificado em navegador com o simulador real: administrador cadastra carregador e recebe a credencial uma única vez; operador vê o simulador online, inicia a recarga, acompanha a energia subir (0,02 → 0,07 kWh), encerra e vê o resultado final com motivo e `transactionId`; bloqueia e libera; abre o diagnóstico com os payloads crus; e o visualizador não tem nenhum botão de operação.

#### Notas

- Nenhuma alteração, conexão ou comando foi executado contra o carregador WEG WEMOB real.
- `ChangeAvailability` continua não implementado: o bloqueio é registrado do nosso lado e impede novas sessões, sem enviar comando ao equipamento.

---

### FASE 2 — Núcleo OCPP 1.6J e simulador — 2026-07-29

O fluxo completo de recarga funciona de ponta a ponta contra o simulador.
**Nada foi conectado ao WEMOB real** — isso é a FASE 4.

#### Adicionado

**`packages/ocpp-core`** — protocolo puro, sem I/O e sem regra de negócio.

- Envelope OCPP 1.6J: parsing e serialização de CALL, CALLRESULT e CALLERROR, com o código de erro correto para cada violação.
- Esquemas Zod das sete ações recebidas e das duas enviadas.
- Normalização de energia para Wh inteiro: trata `unit` ausente, `kWh`, valor fracionário e amostras por fase.
- Reconciliação monotônica de leitura de medidor, para MeterValues fora de ordem.
- Tradução de estados e rótulos em português, para o painel não mostrar `SuspendedEVSE` cru.

**`apps/api/src/modules/ocpp`** — gateway WebSocket sobre a porta HTTP existente.

- Handshake com negociação do subprotocolo `ocpp1.6`, identity no caminho e Basic Auth por carregador (`timingSafeEqual` no usuário, Argon2 na senha).
- Registro de conexões que substitui a anterior na reconexão e ignora o `close` atrasado do socket antigo.
- Processamento **serializado por conexão**: ordem importa, e handlers assíncronos intercalariam.
- Despacho de comandos com correlação por `messageId`, timeout, cancelamento na desconexão e tradução de falhas para linguagem de operador.
- Persistência de todas as mensagens, incluindo as malformadas, com payload bruto para diagnóstico.
- Handlers das sete ações recebidas.
- `GET /api/ocpp/status` — carregadores conectados e comandos pendentes.

**`apps/ocpp-simulator`** — carregador simulado com CLI.

Simula os comportamentos que quebram sistemas: recusa de comandos, CALLERROR, silêncio (para exercitar timeout), queda abrupta de conexão, leitura fora de ordem, energia em kWh, falha reportada e JSON inválido.

**Migration** — sequência `ocpp_transaction_id_seq` (o `transactionId` do OCPP é inteiro, nosso id de sessão é UUID) e índice único parcial `ocpp_messages_inbound_unique` para deduplicação.

#### Achado — uma verificação em aplicação era código inalcançável

O `remoteStart` tinha uma verificação de "conector ocupado" que **nunca executa**.
O índice parcial `charging_sessions_one_active_per_connector` cobre todos os
estados ativos, incluindo `PAYMENT_APPROVED` — o banco recusa a **criação** da
segunda sessão ativa, muito antes de alguém chamar o comando.

A verificação foi removida. O caminho real é a camada de pagamento (FASE 5)
receber P2002 ao aprovar, e o filtro global traduzir para "Este conector já possui
uma recarga em andamento." O teste passou a provar a garantia do banco, que é mais
forte do que a que eu havia escrito.

#### Testes

170 testes no total (87 novos de OCPP), todos passando:

- 42 no protocolo puro — envelope, todos os casos de erro da seção 16, normalização de unidades, reconciliação de leituras.
- 45 de ponta a ponta com servidor, banco e simulador reais — inclui o fluxo dos 12 passos do critério de aceite, os casos de recusa, timeout, reconexão, substituição de conexão, deduplicação de retransmissão, kWh, leitura fora de ordem, medição inconsistente e recarga sem pagamento.

#### Notas

- Nenhuma alteração, conexão ou comando foi executado contra o carregador WEG WEMOB real.
- Endpoints HTTP de operação manual (iniciar/parar pelo painel) **não** entraram: são escopo da FASE 3.

---

### FASE 1 — Fundação do projeto — 2026-07-29

Primeiro código de aplicação. O projeto sobe com um comando, com banco migrado,
login funcionando e testes passando. **Nenhuma comunicação OCPP ainda** — é a FASE 2.

#### Adicionado

**Monorepo e ferramental**

- `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json` — monorepo conforme ADR-0001.
- `eslint.config.mjs`, `.prettierrc.json` — lint e formatação, com `no-explicit-any` como erro.
- `.github/workflows/ci.yml` — lint, tipos, testes com Postgres real, e um job que falha se houver segredo real no repositório (risco R-20).
- `scripts/setup.sh` — prepara o ambiente do zero e recusa `.env` com placeholders. _(substituído por `scripts/bootstrap.mjs` em 2026-07-30.)_
- `docker-compose.yml`, `infra/docker/*.Dockerfile` — Postgres, API e painel. As migrations rodam num serviço próprio antes da API, para que uma migration falha não deixe a API subir com schema errado. Portas publicadas apenas em `127.0.0.1`. Sem Redis, conforme ADR-0003.

**`packages/config`** — validação de ambiente com Zod, falhando no boot com todos os erros de uma vez. Em produção, recusa placeholders do `.env.example`, `CORS_ORIGINS=*` e Swagger habilitado.

**`packages/logger`** — Pino com mascaramento de senha, token, hash e dados de cartão; `withContext` para `requestId`/`correlationId`/`sessionId`/`chargerId`/`paymentId` (briefing seção 13).

**`packages/contracts`** — `assertCents`, `reaisToCents`, `roundToCents` e os equivalentes de energia. Ver a nota sobre o ADR-0005 abaixo.

**`packages/database`** — schema Prisma completo com as 13 entidades do briefing, duas migrations versionadas e seed idempotente com os quatro perfis.

**`apps/api` (NestJS)** — autenticação JWT com Argon2id e refresh rotativo, RBAC hierárquico, `/health` e `/ready`, Swagger, filtro global de erros em português, rate limiting e Helmet.

**`apps/web` (Next.js)** — login e visão geral do painel, em pt-BR.

#### Corrigido durante a fase

- **Rate limit do login estava cravado no código** (`limit: 10`) em vez de vir da configuração — descoberto porque o `.env` de teste era ignorado. Os limites agora vêm de `RATE_LIMIT_AUTH_MAX`.
- **Guard JWT sobrescrevia o motivo específico da recusa**, transformando "conta desativada" em "não autenticado" genérico.
- **Erros de validação não eram identificados** como `VALIDATION_ERROR` no filtro global.
- **Health checks estavam versionados** (`/api/v1/health`), o que quebra orquestradores. Agora são `VERSION_NEUTRAL`.
- Mensagens de rate limit e de token ausente estavam em inglês.

#### Achado importante — o ADR-0005 não estava garantido pelo banco

Verificamos que uma coluna `Int` do Postgres **não recusa** valor fracionário via
Prisma: `1234.56` é **truncado em silêncio** para `1234`. Ou seja, um cálculo em
ponto flutuante que vazasse da aplicação viraria um valor errado mas plausível —
o pior desfecho possível para dinheiro.

A garantia do ADR-0005 depende, portanto, da camada de domínio, não do schema.
Por isso `assertCents` e `assertWattHours` foram criados nesta fase, antes de
existir qualquer cálculo financeiro. O comportamento real está documentado num
teste, não escondido.

#### Testes

77 testes automatizados, todos passando: 10 de configuração, 9 de logger,
21 de dinheiro e energia, 18 de constraints do banco (contra Postgres real) e
25 de API ponta a ponta. O fluxo de login foi verificado também em navegador.

#### Notas

- Nenhuma alteração, conexão ou comando foi executado contra o carregador WEG WEMOB real.
- `index.html` (media kit da AMEE) permanece intocado, conforme combinado.

---

### FASE 0 — Teto de pré-autorização e confirmações de infraestrutura — 2026-07-29

#### Adicionado

- `ADR-0008 §9` — teto padrão de pré-autorização em **R$ 200,00**, com hierarquia de configuração (carregador → estabelecimento → organização → `BORA_PREAUTH_CEILING_CENTS`). Distingue `preAuthCeilingCents` (limite financeiro) de `Tariff.maximumAmountCents` (teto comercial); o teto efetivo é o menor dos dois.
- Risco **R-29** — a parada automática será raramente exercitada em produção com teto de R$ 200, o que deixa o caminho de maior severidade do projeto (R-22) pouco testado.
- Premissa P13 — R$ 200 é ponto de partida, a calibrar após o piloto para ~1,5× o percentil 95 do valor final observado.
- Pergunta 23 — o firmware aceita `ws://` sem TLS em rede privada? (vale perguntar ao suporte WEG antes da janela).

#### Alterado

- Premissas **E12 (cabo de rede até o carregador)** e **A8 (controle do DNS)** confirmadas. Os dois pré-requisitos pendentes de R-18 foram atendidos: a FASE 4a está viável e a 4b pode ser provisionada. Resta decidir onde hospedar (pergunta 13).
- Risco R-25 elevado de severidade 6 para 8 — teto generoso bloqueia mais limite do cartão. Trade-off registrado, com calibração pós-piloto como mitigação.
- Checklist da FASE 4: item B.5.1 (parada automática com teto baixo) reforçado como mais importante, já que produção não vai exercitar esse caminho.
- Checklist: sem cabo deixa de ser cenário; troca de interface não reversível passa a ser critério de parada.

---

### FASE 0 — Decisão sobre Pix — 2026-07-29

#### Adicionado

- `docs/architecture/adr/0010-pix-valor-fixo.md` — Pix como crédito pré-pago de valor fixo, sem devolução automática do saldo. Registra que devolução parcial de Pix é tecnicamente possível (`PUT /pix/{e2eid}/devolucao`, valor parcial, janela de D+90) e que a escolha é de escopo, não de limitação técnica.
- Risco **R-27** (Pix pago sem entrega de energia, severidade 15) e **R-28** (retenção de saldo questionada sob o CDC).
- Premissas P11 (PSP precisa oferecer devolução parcial via API) e P12 (faixas fixas de valor).
- Perguntas 20 a 22.

#### Alterado

- **Exceção obrigatória:** consumo zero em Pix gera **devolução automática integral**. É a única devolução automática do MVP e não é configurável — Pix pago sem energia entregue seria cobrança sem contraprestação.
- `refundPayment` para Pix passa a ser **requisito eliminatório** do PSP na FASE 7, não diferencial. A simplificação adotada é de fluxo, não de infraestrutura.
- Limiar de parada automática passa a ser **diferente por meio de pagamento**: 95% no cartão (ultrapassar é prejuízo nosso) e ~100% no Pix (parar antes é prejuízo do motorista). A máquina é a mesma; muda só o parâmetro.
- Risco R-24 rebaixado de severidade 12 para 6 — resta apenas o cartão de débito, com Pix como alternativa no terminal.
- ADR-0008 §7 marcado como resolvido, apontando para o ADR-0010.

---

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
