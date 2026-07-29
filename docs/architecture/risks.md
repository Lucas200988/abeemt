# Registro de Riscos — Borá Carregar

Escala de probabilidade e impacto: **1 (baixo) a 5 (alto)**. Severidade = P × I.
Riscos com severidade ≥ 12 exigem mitigação implementada antes da fase afetada.

Status: 🔵 aberto · 🟠 mitigado parcialmente · 🟢 fechado

---

## 1. Riscos do equipamento real (WEMOB / operação)

### R-01 — Perder o carregador de produção durante o teste 🔵
**P 3 · I 5 · Severidade 15 — CRÍTICO**

O WEMOB está **em operação hoje**. Apontá-lo para o nosso servidor significa
tirá-lo da Tupi. Se algo der errado (URL inválida, firmware travado, credencial
recusada), o equipamento pode ficar sem plataforma até alguém intervir
fisicamente.

**Mitigação:**
- Documentar 100% da configuração atual **antes** de tocar em qualquer campo
  (capturas de tela, valores literais) — ver `operations/tupi-rollback-plan.md`.
- Teste só em janela de baixa demanda, com pessoa fisicamente presente.
- Procedimento de rollback ensaiado no papel e com tempo estimado conhecido.
- Nenhum comando destrutivo: `Reset`, `UnlockConnector`, `ChangeConfiguration`
  de parâmetros internos e atualização de firmware ficam **proibidos** sem sua
  aprovação explícita, item a item.
- Critério de abortar: se em 15 min o equipamento não conectar ao nosso servidor,
  reverte-se para a Tupi e analisa-se os logs offline.

### R-02 — Alteração da URL OCPP não é possível ou depende da Tupi 🔵
**P 3 · I 5 · Severidade 15 — CRÍTICO**

Alguns fabricantes/plataformas travam a configuração OCPP, ou a URL só é
alterável por quem provisionou o equipamento.

**Mitigação:**
- Validar a premissa E1 (`assumptions.md`) **antes** de planejar a FASE 4.
- Plano B: adquirir um carregador OCPP barato/simulador de bancada para
  homologação, mantendo o WEMOB de produção intocado até haver confiança total.
- Plano C: negociar com a WEG acesso ao menu de instalador.

### R-03 — Divergência de implementação OCPP do fabricante 🔵
**P 4 · I 3 · Severidade 12 — ALTO**

OCPP 1.6 é notoriamente interpretado de forma diferente por cada fabricante:
campos opcionais ausentes, `measurand` diferente do esperado, `transactionId`
com tipos inesperados, `StatusNotification` com transições não canônicas,
timestamps sem timezone.

**Mitigação:**
- Parser **tolerante na entrada, rígido na saída**: aceitar campos extras,
  nunca derrubar a conexão por payload desconhecido; responder com CALLERROR
  apenas quando o protocolo exigir.
- **Registrar toda mensagem crua** (`OcppMessage.payload`) desde o primeiro byte —
  a captura da FASE 4 é o insumo mais valioso do projeto.
- Documento vivo `docs/ocpp/wemob-quirks.md` criado na FASE 4.
- Nunca assumir que uma biblioteca OCPP de prateleira está correta: por isso o
  parser é nosso e coberto por testes (regra 19 do briefing).

### R-04 — MeterValues insuficientes para faturar 🔵
**P 3 · I 4 · Severidade 12 — ALTO**

Se o carregador não enviar `Energy.Active.Import.Register`, ou enviar em unidade
inesperada (kWh em vez de Wh), o cálculo de energia fica errado — e errar
energia é errar dinheiro.

**Mitigação:**
- Fonte primária de energia: `meterStop − meterStart` do `StopTransaction`
  (campos obrigatórios no OCPP 1.6).
- `MeterValues` são usados para acompanhamento ao vivo e como fallback.
- Normalização explícita de unidade na ingestão, com teste para kWh→Wh.
- Detecção de inconsistência (leitura final < inicial, saltos absurdos) marca a
  sessão para revisão manual em vez de faturar valor errado.

### R-05 — Perda de comunicação durante a recarga 🔵
**P 4 · I 3 · Severidade 12 — ALTO**

4G cai. O carregador continua carregando, mas nós paramos de ver.

**Mitigação:**
- Estado comercial vive no banco, nunca na conexão (ADR-0006).
- Ao reconectar, reconciliar: se o carregador reporta transação ativa que
  desconhecemos, adotá-la; se reporta ociosidade e temos sessão "carregando",
  encerrar por reconciliação com motivo específico.
- Sessão nunca fica em estado indefinido — há sempre um timeout que a resolve.

### R-06 — Veículo não inicia a recarga após pagamento 🔵
**P 4 · I 3 · Severidade 12 — ALTO**

Motorista paga, mas o carro não está plugado, ou recusa a carga.

**Mitigação:**
- Timeouts em dois níveis (regra 11.5): 120 s para o carregador aceitar o
  comando, 5 min para o `StartTransaction` chegar.
- Ao expirar: sessão vai para `EXPIRED`/`FAILED`, o pagamento **não é capturado**
  (quando houver pré-autorização) e o fluxo de cancelamento/estorno é acionado.
- Alerta operacional gerado; mensagem clara no painel.

---

## 2. Riscos de pagamento

### R-07 — Cobrar e não entregar energia 🔵
**P 3 · I 5 · Severidade 15 — CRÍTICO (risco de reputação e jurídico)**

O pior cenário do produto: motorista paga e não carrega.

**Mitigação:**
- Preferir **pré-autorização + captura** ao pagamento capturado na hora (depende
  da resposta à pergunta 8 de `assumptions.md`).
- Só capturar após confirmação de `StartTransaction`.
- Estorno automático em falha de início, com registro auditável.
- Runbook `operations/payment-refund.md` para o operador agir em minutos.

### R-08 — Webhook duplicado inicia duas recargas 🔵
**P 4 · I 4 · Severidade 16 — CRÍTICO**

Adquirentes reenviam webhooks. Reentrega é normal, não excepcional.

**Mitigação:**
- Idempotência garantida por **constraint única no banco**, não por `if` em
  memória: `UNIQUE(provider, provider_event_id)` e `UNIQUE(payment_id)` em
  `charging_sessions`.
- Toda ingestão de webhook é transacional: grava evento + efeito no mesmo commit.
- Teste obrigatório: webhook duplicado, webhook fora de ordem, webhook
  concorrente (duas requisições simultâneas).

### R-09 — Webhook forjado 🔵
**P 2 · I 5 · Severidade 10 — MÉDIO-ALTO**

Endpoint público que inicia carregamento é alvo óbvio.

**Mitigação:**
- Verificação de assinatura obrigatória (`verifyWebhook` na porta `PaymentProvider`).
- Rejeitar sem assinatura válida, mesmo em dev, salvo flag explícita de ambiente local.
- Rate limiting no endpoint.
- Nunca confiar em valor vindo do payload sem conferir contra o `Payment` local.

### R-10 — Acoplamento precoce a uma adquirente 🟠
**P 3 · I 4 · Severidade 12 → mitigado por design**

**Mitigação:** a porta `PaymentProvider` (ADR-0004) existe desde a FASE 5, com
dois adapters, garantindo que o domínio nunca conheça o provedor. A FASE 7 só
começa depois da matriz comparativa e da sua escolha.

---

## 3. Riscos de software e dados

### R-11 — Duas sessões simultâneas no mesmo conector 🔵
**P 3 · I 4 · Severidade 12 — ALTO**

**Mitigação:** índice único parcial no PostgreSQL sobre `connector_id` filtrando
os estados ativos. É o banco que recusa, não a aplicação — imune a corrida entre
processos e a reinício da API.

### R-12 — Erro monetário por ponto flutuante 🟠
**P 3 · I 5 · Severidade 15 → mitigado por design**

**Mitigação:** ADR-0005 — dinheiro sempre em centavos (`Int`), energia sempre em
Wh (`Int`). Regra de lint proibindo `Float`/`number` decimal em campos monetários
e revisão de schema. Testes de arredondamento com casos-limite.

### R-13 — Perda de estado ao reiniciar a API durante recarga 🟠
**P 4 · I 4 · Severidade 16 → mitigado por design**

**Mitigação:** ADR-0006. Nenhum estado comercial em memória. Ao subir, a API
reconstrói o quadro a partir do banco e aguarda a reconexão dos carregadores. O
worker varre sessões pendentes e aplica timeouts perdidos durante o downtime.

### R-14 — Comandos OCPP duplicados por retry 🔵
**P 3 · I 4 · Severidade 12 — ALTO**

Retry cego pode enviar dois `RemoteStartTransaction`.

**Mitigação:** tabela `outbox_commands` com `UNIQUE(idempotency_key)`; um comando
por sessão por tipo; retry só recoloca o **mesmo** registro em execução, nunca
cria outro. `messageId` OCPP registrado e correlacionado.

### R-15 — Vazamento de dados sensíveis em log 🔵
**P 3 · I 4 · Severidade 12 — ALTO**

**Mitigação:** logger com redaction list (`authorization`, `password`, `token`,
`cardNumber`, `cvv`, `credentialsHash`). Nunca logar payload de pagamento cru sem
mascaramento. Revisão específica na FASE 5.

### R-16 — Escopo PCI ampliado sem necessidade 🔵
**P 2 · I 5 · Severidade 10 — MÉDIO-ALTO**

**Mitigação:** proibido armazenar PAN completo, CVV, trilha ou senha. Guardamos
apenas identificador da transação, valor, status, bandeira, últimos 4 dígitos,
NSU, código de autorização, terminal e timestamps. O adquirente é quem toca no
cartão — não nós.

---

## 4. Riscos de projeto e cronograma

### R-17 — Escopo inflar além do MVP 🔵
**P 4 · I 3 · Severidade 12 — ALTO**

A lista de "fora do MVP" é longa e tentadora (mapa, app, roaming, fidelidade…).

**Mitigação:** entrega por fases com critério de aceite explícito e validação
sua entre fases. Qualquer item fora do MVP entra em backlog documentado, não no
código.

### R-18 — Dependência de infraestrutura pública para a FASE 4 🔵
**P 4 · I 4 · Severidade 16 — CRÍTICO para o cronograma**

Sem domínio, TLS e host público, o WEMOB em 4G não nos alcança.

**Mitigação:** tratar provisionamento (domínio + VPS + certificado) como
pré-requisito da FASE 4, iniciado durante a FASE 2. Alternativa de baixo custo
para teste inicial: túnel reverso autenticado, **apenas** se o equipamento
aceitar e com o entendimento de que não é solução de produção.

### R-19 — Simulador que "concorda consigo mesmo" 🟠
**P 3 · I 4 · Severidade 12 → mitigado por design**

Um simulador escrito pela mesma cabeça que escreveu o servidor tende a esconder
os mesmos erros de interpretação.

**Mitigação:** simulador e servidor compartilham apenas o `ocpp-core`
(serialização), não a lógica de handlers. Além disso, os testes incluem casos
**adversariais** produzidos a partir da especificação OCPP 1.6, não a partir do
nosso código: JSON malformado, action desconhecida, CALLRESULT sem CALL
correspondente, campos faltando, tipos trocados.

### R-20 — Sobre-engenharia da infraestrutura 🟠
**P 3 · I 2 · Severidade 6 — MÉDIO**

**Mitigação:** ADR-0003 documenta explicitamente por que **não** há Redis, fila
distribuída nem microserviços no MVP, com gatilhos objetivos para reavaliar.

### R-21 — Repositório contém artefato não relacionado 🟢
**P 1 · I 1 · Severidade 1 — BAIXO**

O `index.html` do Fórum BESS 2026 está na raiz. Não conflita com nada, mas
confunde quem chega ao projeto.

**Mitigação:** proposta de mover para `legacy/` na FASE 1, mediante sua
autorização. Nada foi apagado.

---

## 5. Matriz de riscos críticos por fase

| Fase | Riscos que precisam estar mitigados antes de começar |
| --- | --- |
| 1 | R-12, R-20 |
| 2 | R-03, R-11, R-13, R-14, R-19 |
| 3 | R-13 |
| 4 | **R-01, R-02, R-18** (bloqueantes) + R-04, R-05 |
| 5 | **R-07, R-08, R-09** (bloqueantes) + R-15, R-16 |
| 6 | R-04, R-12 |
| 7 | R-09, R-10, R-16 |
| 8 | R-16 |
| 9 | todos revisados |

---

## 6. Riscos de retirar o equipamento da Tupi — análise dedicada

Conforme item 10 da FASE 0, este é o ponto de maior exposição do projeto.

| Dimensão | Risco concreto | Nível | Contramedida |
| --- | --- | --- | --- |
| **Operacional** | Carregador indisponível para clientes durante a janela de teste | Alto | Janela fora de pico, aviso prévio no local, duração máxima definida |
| **Técnico** | Configuração original não é restaurável | Crítico | Registro literal + capturas de tela **antes** de qualquer edição |
| **Técnico** | Firmware trava em estado inconsistente | Médio | Nenhum comando destrutivo; suporte WEG acessível durante a janela |
| **Comercial** | Contrato com a Tupi prevê penalidade ou bloqueio | Médio | Verificar contrato antes (pergunta 7 de `assumptions.md`) |
| **Dados** | Perda de histórico de sessões na Tupi | Baixo | Exportar/registrar histórico antes, se o painel permitir |
| **Financeiro** | Sessões pagas via Tupi durante nossa janela não são registradas | Médio | Janela curta; sinalização física no equipamento |
| **Reputacional** | Usuário chega, não consegue carregar e reclama | Médio | Presença física de alguém da equipe durante todo o teste |

**Regra inegociável:** o equipamento real só é tocado na FASE 4, após validação
manual sua, com o `tupi-rollback-plan.md` revisado e o
`wemob-test-checklist.md` preenchido até o item de pré-requisitos.
