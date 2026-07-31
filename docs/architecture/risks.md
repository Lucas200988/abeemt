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

### R-07 — Cobrar e não entregar energia 🟠

**P 3 · I 5 · Severidade 15 → P 1 · I 5 · Severidade 5 (2026-07-29)**

O pior cenário do produto: motorista paga e não carrega.

**Rebaixado** com a decisão de pré-autorização + captura ([ADR-0008](adr/0008-pre-autorizacao-e-captura.md)):
como o dinheiro é apenas **reservado** e só é capturado depois da energia
entregue, uma falha antes do início resulta em `voidPayment` — nenhuma cobrança
acontece. O risco deixa de ser estrutural e passa a ser residual (falha de
software na hora de decidir entre capturar e cancelar).

**Mitigação remanescente:**

- Captura **somente** após `StopTransaction` com energia conhecida.
- Distinção rigorosa entre `void` (pré-autorização) e `refund` (valor capturado).
- Runbook `operations/payment-refund.md` para o operador agir em minutos.
- Teste obrigatório: falha em cada ponto do fluxo resulta em `void`, nunca em captura.

> Ressalva: a mitigação **não cobre Pix**, que não tem pré-autorização. Enquanto
> a pergunta 17 de `assumptions.md` estiver aberta, R-07 permanece em severidade
> 15 para o caminho Pix.

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

### R-22 — Consumo ultrapassa o valor pré-autorizado 🔵 _(novo — 2026-07-29)_

**P 4 · I 4 · Severidade 16 — CRÍTICO**

Não se pode capturar mais do que foi pré-autorizado. Se a recarga consumir R$ 120
sobre uma reserva de R$ 100, os R$ 20 excedentes simplesmente **não são
cobráveis** — energia entregue e perdida.

Pior: uma tentativa de capturar acima do autorizado é recusada pelo adquirente,
e uma implementação ingênua pode acabar não capturando **nada**.

**Mitigação:**

- Recálculo do valor corrente a cada `MeterValues`.
- `RemoteStopTransaction` automático ao atingir 95% do teto (margem para o tempo
  entre leituras e o tempo de resposta do carregador) — ver ADR-0008 §4.
- Se mesmo assim exceder: capturar **exatamente o valor pré-autorizado** e
  registrar a diferença como perda operacional, com alerta. Nunca tentar
  capturar acima.
- O limiar de 95% será calibrado na FASE 4 com a periodicidade real de
  `MeterValues` do WEMOB. Um carregador de 30 kW entrega ~0,5 kWh por minuto —
  com leituras a cada 60 s, a margem precisa cobrir pelo menos duas leituras.
- Teste obrigatório: sessão que atinge o teto para sozinha antes de ultrapassá-lo.

### R-23 — Pré-autorização expira antes da captura 🔵 _(novo — 2026-07-29)_

**P 3 · I 4 · Severidade 12 — ALTO**

Pré-autorizações têm validade. Se a captura falhar (adquirente fora, bug, sessão
presa em estado intermediário) e ninguém perceber, a reserva expira e a energia
entregue nunca é faturada.

**Mitigação:**

- Captura disparada no encerramento da sessão, não em fechamento em lote.
- Falha de captura entra em retry pelo outbox (ADR-0003) com backoff.
- **Alerta de alta prioridade** para qualquer pagamento em `AUTHORIZED` há mais
  do que a janela configurada — este é o alerta financeiro mais importante do
  sistema.
- Painel com visão dedicada: "pré-autorizações pendentes de captura".
- O prazo real de validade entra na matriz da FASE 7 (varia por adquirente).

### R-24 — Cartão de débito fica sem caminho de pagamento 🟠

**P 4 · I 3 · Severidade 12 → P 3 · I 2 · Severidade 6 (2026-07-29)**

O modelo de pré-autorização não é suportado por **Pix** nem, frequentemente, por
cartão de **débito** no Brasil.

**Rebaixado:** o caminho Pix foi resolvido pelo
[ADR-0010](adr/0010-pix-valor-fixo.md) — Pix entra no MVP como crédito pré-pago
de valor fixo. Resta o débito.

**Mitigação remanescente:**

- Quem usa débito passa a ter o Pix como alternativa imediata no terminal — o
  público não fica descoberto.
- Suporte a pré-autorização em débito vira item da matriz da FASE 7; se algum
  adquirente oferecer, é ganho, não requisito.

### R-27 — Pix pago sem entrega de energia 🔵 _(novo — 2026-07-29)_

**P 3 · I 5 · Severidade 15 — CRÍTICO**

No cartão, uma falha antes do início gera `void` e nada é cobrado. **No Pix o
dinheiro já saiu da conta do motorista.** Se o carregador estiver offline, o
comando for recusado ou o veículo não iniciar, temos pagamento recebido e zero
contraprestação.

Este é o pior cenário do produto ressurgindo por uma porta diferente — o mesmo
risco R-07 que a pré-autorização tinha eliminado.

**Mitigação:**

- **Devolução automática integral** quando `energyWh = 0` — regra obrigatória do
  [ADR-0010](adr/0010-pix-valor-fixo.md) §4, não configurável.
- `refundPayment` funcionando de verdade para Pix é **requisito eliminatório** do
  PSP na FASE 7 (premissa P11), não diferencial.
- Devolução emitida pelo outbox com retry — falha de devolução é alerta de alta
  prioridade, no mesmo nível de R-23.
- Painel com visão "Pix pagos sem energia entregue", que precisa estar sempre vazia.
- Teste obrigatório na FASE 5: pagar Pix com carregador offline resulta em
  devolução automática, não em sessão presa.

### R-28 — Retenção de saldo Pix não consumido questionada 🟠 _(novo — 2026-07-29)_

**P 2 · I 3 · Severidade 6 — MÉDIO**

Reter valor pago e não consumido pode ser questionado sob o CDC como cobrança por
serviço não prestado, mesmo com aviso na tela. É a exposição aceita
conscientemente pelo [ADR-0010](adr/0010-pix-valor-fixo.md).

**Mitigação:**

- Parada automática em ~100% do valor pago faz o caminho feliz ter **sobra zero** —
  não há o que reter na maioria das sessões.
- Devolução obrigatória em consumo zero elimina o caso grave (R-27).
- Aviso explícito **antes** do pagamento, não em letra miúda depois.
- Faixas de valor modestas (R$ 20 / R$ 30 / R$ 50) limitam a sobra típica.
- Devolução manual disponível ao operador para casos de bom senso comercial.
- O caso residual — motorista desconecta por vontade própria antes de esgotar o
  crédito — é pequeno em valor e defensável.

### R-25 — Valor reservado indisponível no limite do motorista 🔵

**P 3 · I 2 · Severidade 6 → P 4 · I 2 · Severidade 8 (2026-07-29)**

Reservamos R$ 200, capturamos R$ 60, mas o emissor pode levar dias para liberar
os R$ 140 no limite do cartão. O motorista vê "R$ 200 bloqueados" e reclama.

**Elevado** com a definição do teto padrão em R$ 200
([ADR-0008 §9](adr/0008-pre-autorizacao-e-captura.md)). É o custo consciente de um
teto generoso: quanto maior o teto, menos a parada automática atrapalha a recarga,
e mais limite do cartão fica bloqueado. Para um motorista com limite de R$ 1.000,
reservar R$ 200 por uma carga de R$ 60 é perceptível.

**Mitigação:**

- Comunicação explícita na interface **antes** da autorização: valor reservado,
  e que a cobrança será só do consumido.
- Comprovante final mostrando os três números: reservado, cobrado, liberado.
- **Calibração após o piloto:** coletar o valor final das sessões reais e ajustar
  o teto para ~1,5× o percentil 95 observado. R$ 200 é ponto de partida, não
  destino (premissa P13).
- O teto é configurável por carregador, estabelecimento e organização — dá para
  baixar num local específico sem mexer no resto.
- Roteiro de atendimento para essa reclamação no manual de suporte (FASE 9).

### R-29 — Parada automática mal exercitada em produção 🟠 _(novo — 2026-07-29)_

**P 3 · I 3 · Severidade 9 — MÉDIO**

Com teto de R$ 200, quase nenhuma sessão real vai atingi-lo — o carro enche
antes. A parada automática vira um caminho **raramente executado**, guardando o
risco de maior severidade do projeto (R-22, severidade 16).

Código que não roda é código que não se sabe se funciona. Quando finalmente
disparar, será numa sessão real, com um motorista esperando.

**Mitigação:**

- Testes automatizados cobrindo o disparo em vários pontos (FASE 5/6).
- Teste com teto artificialmente baixo (R$ 3) contra equipamento real — item
  B.5.1 do checklist da FASE 4. **Ficou mais importante, não menos.**
- Métrica no painel: quantas vezes a parada automática disparou. Se o número for
  zero por meses, é sinal de que a regra nunca foi validada em campo.
- Considerar, no piloto, um carregador com teto deliberadamente baixo para
  exercitar o caminho com sessões reais.

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

### R-18 — Dependência de infraestrutura pública para a FASE 4 🟠

**P 4 · I 4 · Severidade 16 → P 2 · I 3 · Severidade 6 (2026-07-29)**

Originalmente: sem domínio, TLS e host público, o WEMOB em 4G não nos alcança.

**Rebaixado** por duas confirmações suas:

1. O domínio existe (`sonare.com.br`) — ver [ADR-0009](adr/0009-topologia-de-dominios.md).
2. **O WEMOB tem Ethernet** — a primeira conexão com o equipamento real pode ser
   feita em **rede local**, sem DNS, sem TLS público e sem VPS (FASE 4a).

Isso é a maior redução de risco obtida até aqui: a primeira conversa OCPP com o
equipamento real deixa de depender de cinco camadas de infraestrutura
simultaneamente. Se falhar, o problema está no OCPP.

**Atualização 2026-07-29:** confirmado que **existe cabo de rede até o carregador**
(E12) e que **temos controle do DNS** (A8). Os dois pré-requisitos que restavam
foram atendidos: a FASE 4a está viável e a 4b pode ser provisionada.

**Mitigação remanescente:**

- Decidir onde hospedar (premissa A4, pergunta 13) — único item de infraestrutura
  ainda aberto.
- Confirmar que o firmware aceita `ws://` em rede privada (E14, risco R-26).
- Provisionar VPS + TLS durante a FASE 2, para a FASE 4b.
- Validar que a renovação do certificado não derruba WebSocket (ADR-0009 §2).

### R-26 — Firmware recusa `ws://` sem TLS na rede local 🔵 _(novo — 2026-07-29)_

**P 3 · I 2 · Severidade 6 — MÉDIO**

Alguns firmwares de carregador exigem `wss://` e recusam conexão sem TLS, mesmo
em rede privada. Se for o caso do WEMOB, a FASE 4a perde a simplicidade.

**Mitigação:**

- Confirmar com o suporte WEG antes da janela (premissa E14).
- Plano B: TLS local com certificado auto-assinado e CA instalada no equipamento
  (nem sempre possível em firmware embarcado).
- Plano C: pular a 4a e ir direto para a 4b com o endpoint público — mais risco,
  mas o caminho original já estava previsto.

### R-30 — Ociosidade medida na resolução do carregador 🟢 _(novo — 2026-07-30)_

**P 4 · I 2 · Severidade 8 — MÉDIO**

A taxa de ociosidade (FASE 6) é calculada a partir dos `MeterValues`: quando duas
leituras consecutivas não mostram energia nova, o intervalo entre elas conta como
ocioso. A precisão é, portanto, a do intervalo de medição do equipamento — um
carregador que reporta a cada 5 minutos produz ociosidade em blocos de 5 minutos,
e a cobrança pode divergir do tempo real em até um intervalo.

Não é um defeito corrigível em software: o protocolo não oferece nada mais fino
do que o carregador informa. Inventar precisão seria pior do que assumir a
grossura.

**Mitigação:**

- Intervalo menor que um segundo não é creditado **e não avança o marcador** — o
  resto sobrevive para a leitura seguinte, em vez de ser truncado a zero. Sem
  isso, um carregador que reporta com frequência alta nunca acumularia
  ociosidade nenhuma (encontrado em teste, 2026-07-30).
- O tempo ocioso é limitado à duração total da sessão: relógio adiantado ou
  leitura fora de ordem não podem cobrar tempo que não existiu.
- Incremento atômico no banco (`increment`), não ler-somar-escrever: duas
  medições concorrentes não perdem cobrança.
- `MeterValues` do WEMOB precisa ser configurado com intervalo curto na FASE 4
  se a ociosidade for cobrada — item a acrescentar ao checklist do equipamento.
- Enquanto a periodicidade real do WEMOB não for conhecida, a recomendação é
  **não cobrar ociosidade** (deixar o campo em zero, que é o padrão).

### R-31 — Adapter de adquirente escrito sem contrato verificado 🟠 _(novo — 2026-07-31)_

**P 4 · I 4 · Severidade 16 — CRÍTICO enquanto não verificado**

O portal de documentação do PagBank recusa acesso automatizado (HTTP 403,
verificado em 2026-07-31). O adapter foi escrito com a estrutura completa, mas
caminhos, nomes de campos e estados são **suposição** — podem divergir do real.

Um adapter assim, se entrasse em operação, falharia de formas caras: capturar o
valor errado, interpretar recusa como aprovação, ou recusar todo webhook.

**Mitigação:**

- Tudo que **não** depende do fornecedor está em `HttpPaymentProvider` e é
  testado de verdade: prazo, retentativa, idempotência, HMAC, redação de
  credencial.
- Tudo que depende está em um único objeto `CONTRATO`, com a procedência de cada
  item marcada como `confirmado` ou `a confirmar`.
- **Trava:** o adapter recusa toda operação enquanto `BORA_PAGBANK_VERIFIED` for
  falso, e a API não sobe se ele for o provedor padrão sem verificação.
- Mapeamento conservador: estado desconhecido vira `FAILED`, nunca sucesso.
- Suíte de conformidade pronta para rodar contra o sandbox — é ela o critério de
  "funciona", não a impressão de que funcionou.

**Fecha quando:** houver credenciais de sandbox e a suíte de conformidade passar
contra elas. Ver `docs/payments/fase-7-o-que-falta.md`.

### R-32 — Token de maquininha furtado 🟠 _(novo — 2026-07-31)_

**P 3 · I 4 · Severidade 12 — ALTO**

A maquininha fica pendurada num poste, ligada o dia inteiro, fisicamente
acessível a qualquer pessoa. É o componente mais exposto do sistema. Quem
conseguir extrair a credencial dela — abrindo o equipamento, lendo o
armazenamento do aplicativo, ou simplesmente levando a maquininha — passa a
poder falar com a nossa API se passando por ela.

**O que estava em jogo.** Se o terminal fosse um usuário do painel, essa
credencial abriria o painel inteiro: sessões, receita e cadastro de todos os
estabelecimentos. Se o terminal escolhesse o conector, iniciaria recarga em
qualquer ponto da plataforma. Se escolhesse o provedor de pagamento, escolheria
um simulado e teria recarga de graça — com o sistema registrando "pagamento
aprovado" em cada uma.

**Mitigação (implementada na FASE 8):**

- **Identidade própria, não usuário.** O token de terminal só abre os endpoints
  `/terminal/*`. Não existe caminho dele para o painel.
- **O conector vem do cadastro, nunca do corpo da requisição.** O campo sequer é
  aceito — `forbidNonWhitelisted` recusa a requisição inteira.
- **O provedor vem da configuração do servidor** (`BORA_TERMINAL_PAYMENT_PROVIDER`),
  nunca do terminal.
- **O valor reservado é limitado ao teto configurado.** Reserva acima do teto do
  ADR-0008 §9 é recusada.
- **Consulta e parada de sessão exigem que a sessão seja do conector daquele
  terminal** — senão um token furtado encerraria a recarga de qualquer motorista.
- **Revogação imediata.** O token é opaco e conferido no banco a cada
  requisição, não um JWT que continuaria válido até expirar. O botão "Revogar"
  no painel corta o acesso na hora.
- **Pareamento por código curto, de uso único e com prazo.** Ninguém digita
  segredo na tela do equipamento; o token só existe em claro no instante da
  troca, e guardamos apenas o hash.

Cada um destes pontos tem teste em `apps/api/test/maquininha.e2e-spec.ts`,
inclusive as tentativas de burlar.

**Resíduo aceito:** um token furtado ainda consegue **registrar uma
pré-autorização falsa** naquele conector — declarar que houve cobrança quando
não houve — e obter uma recarga. Isso não se resolve na nossa borda: só a
consulta ao adquirente prova que a cobrança existe. **Fecha quando** houver
sandbox real e a autorização declarada pelo terminal for conferida contra o
adquirente antes de o carregador ligar (item para a FASE 7/9).

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

| Fase | Riscos que precisam estar mitigados antes de começar              |
| ---- | ----------------------------------------------------------------- |
| 1    | R-12, R-20                                                        |
| 2    | R-03, R-11, R-13, R-14, R-19                                      |
| 3    | R-13                                                              |
| 4a   | **R-01, R-02** (bloqueantes) + R-26, R-04, R-05                   |
| 4b   | **R-01, R-02, R-18** (bloqueantes) + R-04, R-05                   |
| 5    | **R-08, R-09, R-22, R-27** (bloqueantes) + R-07, R-15, R-16, R-23 |
| 6    | R-04, R-12, **R-22** + R-29                                       |
| 7    | R-09, R-10, R-16, **R-23, R-27** + R-24                           |
| 8    | **R-32** (bloqueante) + R-16, R-25, R-28                          |
| 9    | todos revisados                                                   |

### Riscos com maior severidade atual (após revisão de 2026-07-29)

| Risco                                        | Severidade               | Fase    |
| -------------------------------------------- | ------------------------ | ------- |
| R-08 webhook duplicado inicia duas recargas  | 16                       | 5       |
| R-13 perda de estado em restart              | 16 (mitigado por design) | 2       |
| **R-22 consumo ultrapassa o pré-autorizado** | **16**                   | **5/6** |
| R-01 perder o carregador de produção         | 15                       | 4       |
| R-02 URL OCPP não alterável                  | 15                       | 4       |
| R-12 erro monetário por float                | 15 (mitigado por design) | 1       |
| **R-27 Pix pago sem entrega de energia**     | **15**                   | **5/7** |

---

## 6. Riscos de retirar o equipamento da Tupi — análise dedicada

Conforme item 10 da FASE 0, este é o ponto de maior exposição do projeto.

| Dimensão         | Risco concreto                                                  | Nível   | Contramedida                                                        |
| ---------------- | --------------------------------------------------------------- | ------- | ------------------------------------------------------------------- |
| **Operacional**  | Carregador indisponível para clientes durante a janela de teste | Alto    | Janela fora de pico, aviso prévio no local, duração máxima definida |
| **Técnico**      | Configuração original não é restaurável                         | Crítico | Registro literal + capturas de tela **antes** de qualquer edição    |
| **Técnico**      | Firmware trava em estado inconsistente                          | Médio   | Nenhum comando destrutivo; suporte WEG acessível durante a janela   |
| **Comercial**    | Contrato com a Tupi prevê penalidade ou bloqueio                | Médio   | Verificar contrato antes (pergunta 7 de `assumptions.md`)           |
| **Dados**        | Perda de histórico de sessões na Tupi                           | Baixo   | Exportar/registrar histórico antes, se o painel permitir            |
| **Financeiro**   | Sessões pagas via Tupi durante nossa janela não são registradas | Médio   | Janela curta; sinalização física no equipamento                     |
| **Reputacional** | Usuário chega, não consegue carregar e reclama                  | Médio   | Presença física de alguém da equipe durante todo o teste            |

**Regra inegociável:** o equipamento real só é tocado na FASE 4, após validação
manual sua, com o `tupi-rollback-plan.md` revisado e o
`wemob-test-checklist.md` preenchido até o item de pré-requisitos.
