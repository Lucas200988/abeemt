# FASE 8 — a maquininha (caminho A)

O motorista chega, passa o cartão numa maquininha montada no poste, e carrega.
Sem aplicativo, sem cadastro, sem conta.

Este documento descreve **o que já funciona**, **o contrato que o aplicativo da
maquininha precisa cumprir**, e **o que ainda depende do fabricante**.

---

## 1. Por que caminho A

Você escolheu desenvolver um aplicativo que roda **dentro** da maquininha
(SmartPOS), em vez de a maquininha ser um periférico controlado por outro
computador. A consequência prática é boa: o poste precisa de um equipamento só,
com 4G próprio, e a pré-autorização acontece no chip da maquininha, pelo SDK do
fabricante — nós nunca tocamos em número de cartão.

A consequência estrutural é que o sistema ganha um **terceiro tipo de cliente**,
ao lado do painel e do carregador OCPP. Ele precisa de identidade, credencial e
limites próprios.

---

## 2. As quatro decisões, e o motivo de cada uma

### 2.1 O terminal é uma identidade própria, não um usuário

Um operador tem acesso ao painel: sessões, receita, cadastro. A maquininha fica
pendurada num poste, ligada o dia inteiro, ao alcance de qualquer pessoa. Pôr
uma credencial de operador nela seria deixar a chave do painel inteiro na rua.

O token de terminal só abre `/terminal/*`, e só do próprio conector.

### 2.2 Pareamento por código curto, gerado no painel

O caminho oposto — digitar um segredo longo no teclado da maquininha — falha de
duas formas: erra-se ao digitar, e o segredo passa a existir escrito em algum
lugar. Aqui o painel gera um código de 8 caracteres, válido por 15 minutos e de
**uso único**; o equipamento troca esse código pelo token de verdade, que só
existe em claro naquele instante.

O alfabeto do código não tem `0/O` nem `1/I/L`: ele é lido de uma tela e digitado
num teclado pequeno, muitas vezes ao ar livre.

### 2.3 O terminal já sabe qual é o seu conector

Ele está parafusado naquele carregador. Perguntar a ele qual conector usar seria
aceitar como verdade um dado que o atacante controla — e a resposta certa está no
nosso cadastro.

### 2.4 O terminal informa o que aconteceu no cartão, e nada além disso

Conector, provedor de pagamento, tarifa e teto são resolvidos no servidor. É o
que impede que um erro no aplicativo — ou um token furtado — inicie recarga no
carregador do vizinho, escolha um provedor simulado, ou reserve um valor que
ninguém autorizou.

---

## 3. O contrato HTTP

Base: `/api/v1`. Autenticação: `Authorization: Bearer <token do terminal>`.

### 3.1 Parear (sem token)

```
POST /terminal/pair
{ "pairingCode": "K7M2QP4X", "serialNumber": "...", "model": "...", "appVersion": "1.0.0" }

→ 201 { "token": "bora_pos_…", "terminal": { … } }
```

O token é devolvido **uma única vez**. Guardamos apenas o hash. Perdido, o
caminho é gerar outro código no painel — não recuperar.

### 3.2 Contexto da tela

```
GET /terminal/me

→ 200 {
  "terminal":  { "id": "…", "name": "Maquininha do poste 1" },
  "connector": { "label": "Carregador 1 — conector 1", "status": "AVAILABLE", "available": true },
  "tariff":    { "name": "…", "pricePerKwhCents": 250, "connectionFeeCents": 300, … },
  "preAuthAmountCents": 20000,
  "ceilingAmountCents": 20000,
  "methods": ["CREDIT_CARD", "DEBIT_CARD"],
  "activeSessionId": null
}
```

**O aplicativo não decide o valor da reserva.** Ele lê `preAuthAmountCents` daqui.
Se o valor morasse no aplicativo, mudar o teto exigiria atualizar a maquininha de
cada poste.

### 3.3 Registrar a pré-autorização e iniciar a recarga

```
POST /terminal/authorization
{
  "providerPaymentId": "<identificador devolvido pelo SDK>",
  "method": "CREDIT_CARD",
  "amountAuthorizedCents": 20000,
  "idempotencyKey": "<gerada pelo terminal, estável entre retentativas>",
  "cardBrand": "VISA", "cardLastFour": "4321",
  "nsu": "…", "authorizationCode": "…"
}

→ 201 { "sessionId": "…", "paymentId": "…", "approved": true, "message": "…", "command": { … } }
```

Nenhuma chamada a adquirente parte daqui: o valor já foi reservado no
equipamento. Guardamos o resultado e mandamos o carregador ligar.

**O que o corpo não aceita, de propósito:** `connectorId`, `provider`, e qualquer
dado de cartão além dos quatro últimos dígitos. Mandar um deles faz a requisição
inteira ser recusada com 400.

**Idempotência:** repetir a mesma `idempotencyKey` devolve o mesmo pagamento. A
maquininha reenvia quando a resposta se perde na rede, e recusar a repetição
transformaria uma retentativa em cobrança dupla ou em recarga não iniciada.

### 3.4 Acompanhar e encerrar

```
GET  /terminal/sessions/:id
POST /terminal/sessions/:id/stop     { "reason": "motorista encerrou" }
POST /terminal/heartbeat             { "appVersion": "1.0.0" }   → 204
```

A resposta traz `message` já pronto em português para a tela pequena do
equipamento, além de energia, duração e valor corrente.

**A cobrança não acontece no `stop`.** Quem captura é a conciliação, depois que o
carregador confirmar a parada e a leitura final do medidor chegar — cobrar antes
faturaria um consumo que ainda pode subir.

---

## 4. O que a maquininha nunca faz

| Nunca                                            | Por quê                                                 |
| ------------------------------------------------ | ------------------------------------------------------- |
| Guarda ou transmite número completo, CVV, trilha | Briefing seção 12. A API recusa o campo                 |
| Escolhe o conector                               | Um token furtado ligaria o carregador do vizinho (R-32) |
| Escolhe o provedor de pagamento                  | Escolheria um simulado e teria recarga de graça (R-32)  |
| Decide o valor do teto                           | O teto é comercial e mora no servidor (ADR-0008 §9)     |
| Consulta ou encerra sessão de outro conector     | Encerraria a recarga de outro motorista (R-32)          |

---

## 5. O provedor `terminal-mock`

O único provedor `initiatedBy: 'terminal'` que existia era o `manual`, e ele só
aceita o método `MANUAL` — a aprovação de uma pessoa no painel. Com ele não dá
para exercitar o fluxo do cartão.

`terminal-mock` preenche essa lacuna: crédito e débito, autorização nascida no
terminal, estado em memória. **Não é adquirente e nenhum dinheiro se move.** O
registro de provedores recusa subir com ele em produção, pela mesma regra que
vale para o `mock`, e o painel avisa na tela que o pagamento é simulado.

Ele existe para que o aplicativo da maquininha seja desenvolvido e testado
**antes** de haver SDK e credencial de homologação.

---

## 6. Um defeito encontrado ao ligar isto ponta a ponta

O fechamento de uma sessão iniciada na maquininha **falhava**.

O identificador da cobrança nasce no equipamento. Horas depois, a conciliação
chamava `capture(identificador)` — e o provedor nunca tinha visto aquele
identificador, porque não foi ele quem criou a cobrança. Nos provedores
simulados isso dava `NOT_FOUND`.

O sintoma seria o pior possível: **recarga entregue, nada cobrado, e nenhum erro
visível** até a conciliação manual.

Valia também para o `manual`, que é o caminho previsto para o teste com o
equipamento real (FASE 4).

**Correção:** a porta de pagamento ganhou `adoptTerminalAuthorization`, chamado
antes de a autorização ser marcada no banco. Num adquirente real ele é
dispensável — a cobrança já existe do lado deles. Nos simulados, é o que faz o
`capture` posterior funcionar.

Coberto por `packages/payment-core/src/terminal-mock.spec.ts` e pelo teste
ponta a ponta em `apps/api/test/maquininha.e2e-spec.ts`.

---

## 7. O que já está provado

Tudo abaixo tem teste automatizado, e o fluxo foi exercitado contra a API no ar.

| Garantia                                                                              | Onde                     |
| ------------------------------------------------------------------------------------- | ------------------------ |
| Código vira token; código não serve duas vezes                                        | `maquininha.e2e-spec.ts` |
| Código expirado é recusado                                                            | idem                     |
| Token em claro nunca fica no banco                                                    | idem                     |
| Sem token, ou com token inventado, não passa                                          | idem                     |
| Revogar corta o acesso na hora                                                        | idem                     |
| Gerar código novo invalida o token anterior                                           | idem                     |
| Contexto traz tarifa, teto e estado do conector                                       | idem                     |
| Autoriza → carrega → encerra → cobra só o consumido (R$ 8,00 de R$ 200,00 reservados) | idem                     |
| Reenvio da mesma chave não cria segunda cobrança                                      | idem                     |
| Valor acima do teto é recusado                                                        | idem                     |
| Número completo de cartão é recusado                                                  | idem                     |
| Não inicia recarga em outro conector                                                  | idem                     |
| Não escolhe provedor simulado                                                         | idem                     |
| Não consulta nem encerra sessão de outro ponto                                        | idem                     |

---

## 8. O que falta, e quem destrava

### 8.1 O aplicativo da maquininha

Esta fase entregou **o lado do servidor**. O aplicativo que roda dentro do
equipamento depende do SDK do fabricante, e é aí que você precisa entrar.

> **Atualização de 2026-07-31.** O Portal do Desenvolvedor Rede foi consultado e
> **não distribui o SDK do SmartPOS** — ele entrega as APIs de servidor
> (e.Rede, gateway, chargeback). O aplicativo que roda dentro do equipamento é
> outro canal: a **Rede Store**, contato `DevSmartRede@userede.com.br`. Detalhes
> em [matriz-adquirentes.md](matriz-adquirentes.md#rede--o-que-o-portal-do-desenvolvedor-confirmou-2026-07-31).
>
> Confirmado também: o sandbox da Rede é **gratuito e não exige contrato**, e a
> autenticação é **OAuth 2.0** (`clientId` + `clientSecret`), não um token
> estático como o do PagBank.

Para escrevê-lo, preciso das seguintes informações do fabricante. **O ambiente
onde eu rodo bloqueia o acesso a esses portais** — a política de saída do
contêiner recusa a conexão (`connect_rejected`), não os sites. Você consegue
abri-los normalmente no seu navegador; cole aqui o conteúdo das páginas:

| Preciso saber                                                           | Por quê                                                  |
| ----------------------------------------------------------------------- | -------------------------------------------------------- |
| Qual é o SDK e em que linguagem (Android nativo? há camada web?)        | Define como o aplicativo é escrito                       |
| O SDK expõe **pré-autorização** e **captura parcial** no terminal?      | É o modelo inteiro do ADR-0008. Sem isso, muda o desenho |
| Se não expõe: a captura é feita pela API do adquirente, com o servidor? | Muda quem chama o quê                                    |
| Existe modo quiosque (o aplicativo abre sozinho e não sai)?             | O poste não tem ninguém para destravar a tela            |
| Qual é o processo de homologação, e quanto tempo leva?                  | Entra no cronograma do piloto                            |
| Credenciais de homologação: como obter?                                 | Regra 18.20 — sem sandbox, não há chamada real           |

### 8.1-B PagBank: as respostas que a Rede Store ainda não deu — LIDAS NO SDK (2026-08-01)

Sem esperar e-mail de ninguém: o SDK oficial da Moderninha Smart
(**PlugPagServiceWrapper**) é público no GitHub, e a documentação gerada dele
responde as perguntas com nome de método:

| Pergunta                          | Resposta no SDK                                                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reservar no cartão?               | `doPreAutoCreate(PlugPagPreAutoData)` — **valor em CENTAVOS** ("R$ 10,00 → 1000", literal na doc — a MESMA convenção do ADR-0005)                              |
| Cobrar depois, com valor próprio? | `doEffectuatePreAuto(PlugPagEffectuatePreAutoData)` — a efetivação recebe **um `amount` próprio**, separado do valor reservado. É o formato da captura parcial |
| Cancelar a reserva?               | `doPreAutoCancel(transactionId, transactionCode)`                                                                                                              |
| Consultar?                        | `getPreAutoData` / `getPreAutoList` / `PlugPagPreAutoQueryResult`                                                                                              |
| Linguagem do aplicativo           | **Android nativo, Java/Kotlin** — WebView/Ionic/Cordova NÃO são permitidos                                                                                     |
| Publicação                        | "Loja de Aplicativos" própria do PagBank (gestão de terminais e apps)                                                                                          |
| Processo                          | 1º contato comercial (formulário de parceria) → **equipamento de desenvolvimento** enviado → testes → homologação                                              |
| Extras úteis                      | impressão (`doPrintAction`), NFC, beep, deeplink de launcher, app demo oficial                                                                                 |

Fontes: repositório `pagseguro/pagseguro-sdk-plugpagservicewrapper` (GitHub,
lido na íntegra em 2026-08-01) e páginas SmartPOS do portal
`developer.pagbank.com.br` (via busca).

**Ressalvas honestas:**

1. O `amount` próprio na efetivação é o formato da captura parcial, mas a doc
   não escreve a frase "pode ser menor que o reservado" — a prova final é o
   equipamento de desenvolvimento (mesma disciplina do R-31: formato lido ≠
   comportamento exercitado).
2. Modo quiosque não aparece nomeado no SDK (há integração com launcher via
   deeplink); pergunta para o contato comercial.
3. O caminho começa num **formulário de parceria comercial** — não é
   autosserviço completo; o equipamento de dev vem deles.

**Consequência:** o caminho A tem agora DOIS fornecedores viáveis — Rede
(aguardando e-mail da Rede Store) e PagBank (SDK público, processo documentado).
O servidor construído na FASE 8 atende os dois sem mudança.

### 8.1-C Rede Store: documentação LIDA NA ÍNTEGRA (2026-08-04) — e a resposta que muda a decisão

O acesso ao portal do desenvolvedor da Rede ("Laranjinha Store",
`redestore.service-now.com/portal_dev`) foi concedido para
lucas@sonareengenharia.com.br, e a documentação de integração do
`smartrede-sdk` foi lida inteira.

**A resposta da pergunta nº 2 que enviamos à Rede Store está lá, em letra de
forma:**

> "No entanto, **não são suportadas operações de crediário, PRÉ-AUTORIZAÇÃO e
> corban**, mesmo se tratando de operações de crédito e débito."

O SDK da maquininha da Rede **não faz pré-autorização**. Ele suporta:
crédito à vista/parcelado, débito, voucher, **Pix**, estorno (por AUTE, via
intent) e reimpressão. O modelo do ADR-0008 — reservar o teto e capturar o
consumo real — **não roda no terminal da Rede**.

| Item                | O que a documentação diz                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Terminais           | Positivo **L400** e Newland **N960k** (biblioteca específica por modelo)                                  |
| Arquitetura         | App parceiro → intents → **App Vender** da Rede (quem transaciona é o Vender)                             |
| Tipos de pagamento  | `CREDITO_A_VISTA/PARCELADO(_EMISSOR)`, `DEBITO`, `VOUCHER`, `PIX`                                         |
| **Pré-autorização** | ❌ **explicitamente não suportada**                                                                       |
| Estorno             | Por código AUTE, via intent (sem menção a estorno PARCIAL)                                                |
| Valores             | `Long amount` = valor × 100 (centavos, como o nosso padrão)                                               |
| Status de retorno   | `AUTHORIZED` / `FAILED` / `DECLINED`                                                                      |
| Desenvolvimento     | Terminal DEV com depuração USB, instalação via **ADB**, injetor de chaves de teste, sem assinatura (L400) |
| Certificação        | SLA de **5 dias úteis** por versão; 1 release/mês + 1 correção; SDK ≥ 4.3.23                              |
| Dados do lojista    | §9.3 devolve PV, número lógico, CNPJ — útil para vincular terminal ao backend automaticamente             |
| Contatos            | `certificacaosmart@userede.com.br` (certificação) · `erika.reis@userede.com.br` (Conexão Itaú)            |

**Consequência para a decisão do caminho A:**

1. **PagBank passa a ser o único fornecedor com o NOSSO modelo no terminal**
   (`doPreAutoCreate` / `doEffectuatePreAuto` / `doPreAutoCancel` no PlugPag).
2. A maquininha da Rede só serve com **mudança de modelo**: cobrança direta do
   valor exato ao FINAL da recarga (risco: motorista ir embora sem pagar) ou
   **Pix de valor fixo antes** (o SDK tem Pix; casa com o ADR-0010, sem troco
   automático pelo terminal).
3. O e.Rede online (verificado 8/8) segue valendo para o caminho B — QR
   Code/pagamento online — onde a pré-autorização existe.

Pergunta que resta à Rede (via certificacaosmart@userede.com.br): como obter o
terminal de desenvolvimento L400/N960k, e se há pré-autorização no roadmap do
SDK.

### 8.1-D GPOS700 (Gertec) e o formulário de distribuição (2026-08-04, 2ª leva)

A segunda página do portal cobre o terceiro terminal — **Smart Rede GPOS700**
(Gertec), com o `sdk-3.0` — e **repete em letra de forma** a mesma exclusão:
"não são suportadas as operações de crediário, pré-autorização e corban". A
limitação não é de um modelo: é da plataforma de pagamentos da Rede.

O que a página resolve de vez:

| Pergunta                             | Resposta                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Como obter o terminal de dev**     | (a) pelo **executivo de Parcerias Rede**, ou (b) **comprar direto da Gertec** pedindo "padrão de chaves — **Desenvolvimento Redeflex**" |
| Sem Smart Store na maquininha de dev | escrever para `DevSmartRede@userede.com.br`                                                                                             |
| Assinatura em dev (GPOS700)          | chave publicada no portal (Development — Gertec — Customer APP; senha/alias no "Manual de Assinaturas")                                 |
| Distribuição pós-certificação        | planilha "Distribuição da Aplicação": CNPJ + PV + Nº Lógico por maquininha (`SR...` = SDK Rede/RFAL; `SB...` = TEF)                     |
| Certificação (RFAL)                  | testes funcionais de todas as integrações usadas + **área de suporte obrigatória na tela inicial** + impressão + Mifare                 |

**A porta entreaberta que sobrou:** o GPOS700 também opera em modo **TEF**
(Software Express e PayGO). TEF é outra arquitetura — o app conversa com uma
TEF House, não com o App Pagamentos — e soluções TEF tradicionalmente TÊM
pré-autorização. Custo: contrato com TEF House e certificação por ela. Fica
registrado como plano C do caminho A; a pergunta "a SiTef/PayGO no GPOS700
expõe pré-autorização com captura parcial?" entra no e-mail à Rede.

### 8.1-E O canal de cadastro de apps da Rede Store está FECHADO (2026-08-04)

A tela "Meus Apps" tem o formulário completo de criação de aplicativo — tipo
de loja (**pública ou privada** — privada é exatamente o nosso caso: app
distribuído só para as nossas maquininhas), distribuição por planilha
(CNPJ + PV + Nº Lógico), ramo de atividade, contatos de suporte, tipo de
integração (TEF ou SDK Rede/RFAL) e modelo de terminal. Mas com este aviso:

> "Todos os campos do formulário de cadastro do Aplicativo serão
> **desabilitados enquanto o canal estiver fechado**. Assim que retornarmos
> com novos processos atualizaremos nosso portal."

E o portal direciona para `certificacaosmart@userede.com.br` para "acompanhar
o status do processo".

**Leitura do quadro Rede, completa:** sem pré-autorização no SDK **e** com o
canal de publicação fechado por prazo indeterminado. Duas barreiras
independentes. O caminho A da maquininha se concentra no **PagBank**; a Rede
fica registrada com tudo pronto para reavaliar se (a) o canal reabrir E (b) a
pré-autorização entrar no SDK ou o modo TEF a oferecer.

### 8.2 Confirmar a autorização contra o adquirente

É o resíduo do risco R-32. Hoje acreditamos no que a maquininha declara. Quando
houver sandbox, a autorização deve ser conferida contra o adquirente **antes** de
o carregador ligar. Depende das mesmas credenciais da FASE 7 —
ver [`fase-7-o-que-falta.md`](fase-7-o-que-falta.md).

---

## 9. Como operar, no painel

**Painel → Maquininhas.**

1. Cadastre a maquininha, escolhendo o conector em que ela está montada.
2. Anote o código de 8 caracteres (vale poucos minutos, serve uma vez).
3. No aplicativo da maquininha, digite o código.
4. A situação muda para **Pareada** e o "visto por último" passa a ser
   atualizado pelo `heartbeat`.

Se o equipamento sumir, use **Revogar**: o acesso é cortado na hora. Gerar um
código novo também invalida o token anterior — é o caso de equipamento trocado.

---

## 10. Configuração

```
# Provedor usado pelas maquininhas. A maquininha NUNCA escolhe (risco R-32).
BORA_TERMINAL_PAYMENT_PROVIDER=terminal-mock

# Validade do código de pareamento, em minutos.
BORA_TERMINAL_PAIRING_TTL_MINUTES=15
```

A API recusa subir se `BORA_TERMINAL_PAYMENT_PROVIDER` apontar para um provedor
não registrado, para um provedor que autoriza pelo backend, ou — em produção —
para um provedor simulado.
