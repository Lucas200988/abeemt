# e.Rede — o contrato, agora com o manual oficial lido

Fontes, ambas oficiais e levantadas por você:

1. Coleção Postman **"Sandbox e.Rede"** (2026-07-31)
2. **Integration Manual e.Rede v1.38**, de 23/03/2026, lido na íntegra em 2026-07-31

> Cada item marcado _confirmado_ vem de uma dessas fontes. O que restou em
> aberto está na seção 9 — e agora é pouco.

---

## 1. As três pendências bloqueantes: TODAS resolvidas

### 1.1 A unidade do valor é CENTAVOS ✅

Do manual, literal: _"Total transaction amount without thousands and decimal
separators. Examples: R$10.00 = 1000 · R$0.50 = 50"_.

É exatamente o ADR-0005. **Nenhuma conversão** entre o nosso banco e a Rede.

### 1.2 A autenticação vigente é OAuth 2.0 ✅

A coleção estava desatualizada; o manual é explícito:

| Item | Valor |
| ---- | ----- |
| Protocolo | OAuth 2.0 (client credentials). O Basic legado será descontinuado |
| `clientId` | é o **PV** (número de afiliação) — **sem zeros à esquerda**, senão `401 invalid_client` |
| `clientSecret` | é a **Chave de Integração**, gerada no portal Use Rede (perfil administrador) |
| Token (sandbox) | `POST https://rl7-sandbox-api.useredecloud.com.br/oauth2/token` |
| Token (produção) | `POST https://api.userede.com.br/redelabs/oauth2/token` |
| Corpo | `grant_type=client_credentials`, header `Authorization: Basic base64(clientId:clientSecret)` |
| Validade | **24 minutos** — renovar entre 15 e 23 minutos |
| Uso | `Authorization: Bearer {access_token}` em toda chamada |
| **Regra crítica** | Com OAuth, usar **somente as rotas V2**. V1 com Bearer devolve `370 – Request failed` |

Consequência para o código: o adapter precisa de um gerenciador de token
(obter, guardar, renovar antes de expirar). É trabalho pequeno e padrão.

### 1.3 O formato das respostas está documentado ✅

**Autorização aprovada** devolve:

```json
{
  "reference": "pedido123",          ← o NOSSO identificador (≤16, único)
  "tid": "8345000363484052380",      ← identificador da Rede (20) — é por ele que se captura
  "nsu": "663206341",
  "returnCode": "00",                ← "00" = sucesso
  "returnMessage": "Success.",
  "amount": 2099,
  "cardBin": "544828", "last4": "0007",
  "brand": { "name": "Mastercard", "returnCode": "00", "authorizationCode": "186376", "brandTid": "…" }
}
```

**Consulta** (`GET /v2/transactions/{tid}` ou `?reference=`) devolve
`authorization/status` com exatamente quatro estados:

| Estado da Rede | No nosso modelo |
| -------------- | --------------- |
| `Approved`     | AUTHORIZED / CAPTURED (conforme bloco `capture` presente) |
| `Denied`       | DECLINED |
| `Canceled`     | VOIDED / REFUNDED |
| `Pending`      | PENDING |

Estado desconhecido → FAILED, como sempre (nunca sucesso).

**Tabelas de códigos registradas no manual** (para o mapeamento do adapter):
retornos de integração (1–4012), retornos do emissor (101–175), códigos ABECS
por bandeira com classificação **reversível/irreversível**, códigos MAC da
Mastercard, e retornos de cancelamento (351–374).

---

## 2. O modelo do produto, confirmado item por item

| # | Critério | Situação | Fonte |
| - | -------- | -------- | ----- |
| E1 | Pré-autorização | ✅ `capture: false` | manual §Authorization Flow |
| E2 | **Captura parcial** | ✅ literal: _"the merchant must request a full cancellation **or capture a lower amount**"_ | manual §Cancellation |
| E4 | Devolução parcial | ✅ `POST /v2/transactions/{tid}/refunds` com `amount` | manual §Cancellation |
| — | Consulta por nosso id | ✅ `reference` (60 dias) ou `tid` (400 dias) | manual §Transaction query |
| — | Sandbox | ✅ gratuito, sem contrato, cartões de teste tabelados | manual §Sandbox Tutorial |

### As operações, em resumo

```
Token:     POST {oauth}/oauth2/token                        (24 min)
Reservar:  POST /v2/transactions          { capture:false, kind:"credit", reference, amount, … }
Capturar:  PUT  /v2/transactions/{tid}    { amount }        ← pode ser MENOR que o reservado
Cancelar:  POST /v2/transactions/{tid}/refunds  { amount }
Consultar: GET  /v2/transactions/{tid}    ou  ?reference={ref}
```

Base sandbox: `https://sandbox-erede.useredecloud.com.br`
Base produção: `https://api.userede.com.br/erede`

---

## 3. Regras operacionais que afetam o nosso desenho

### 3.1 A reserva não capturada se cancela sozinha

_"If the authorization is not captured within the maximum period **according to
the branch of the establishment**, it is automatically cancelled."_

O prazo **varia por ramo de atividade** e o manual não diz qual é o nosso.
Pergunta obrigatória à Rede no credenciamento (risco R-23 — nosso alerta de
expiração precisa do número real).

### 3.2 Cancelamento: só total antes da captura; D+1 é assíncrono

- Reserva pendente: **só cancelamento total** (parcial não existe — captura-se
  menos, que dá no mesmo).
- Depois de capturado: parcial ou total. No mesmo dia (D0) é imediato para
  Mastercard/Elo; nos demais casos processa em **D+1**.
- **Código 360 significa "recebido", não "feito"**: _"the merchant must
  subsequently check whether the cancellation has been completed or declined"_.
  O nosso worker precisa reconsultar até `Done` ou `Denied` — nunca marcar
  devolvido no 360.
- Prazos: crédito ~90 dias, débito 7 dias.

### 3.3 O webhook da Rede NÃO tem assinatura HMAC

A notificação de cancelamento/Pix vai para uma URL cadastrada, com, no máximo,
um token **Bearer/Basic fixo** que nós registramos no portal. Não há assinatura
sobre o corpo.

Consequência: o desenho do nosso lado muda de "verificar assinatura" para
**"webhook é só um aviso — a verdade vem de reconsultar a API pelo `tid`"**.
Já era a nossa prática preferida; aqui vira obrigatória. (TLS 1.2+ exigido na
nossa URL.)

### 3.4 Retentativa tem regra e tem multa

As bandeiras cobram por retentativa fora da regra (Visa: 15 em 30 dias;
Mastercard: 7 em 24h/35 em 30 dias, guiado pelos códigos MAC; código
**irreversível não se retenta nunca**). O nosso `SessionWorker` de reexecução
precisa respeitar a classificação reversível/irreversível das tabelas ABECS —
retentar um 57 para sempre custaria dinheiro além de não funcionar.

### 3.5 Pré-autorização Mastercard tem custo por transação

R$ 0,04 (abaixo de ~R$ 69/100) ou 0,058–0,093% acima. Entra na conta do preço
por recarga — não muda o desenho, muda a margem.

### 3.6 Débito online exige 3DS

_"3DS authentication is mandatory for all debit card transactions."_ 3DS pede
interação do portador (desafio no celular/banco). Consequências:

- **Caminho B (QR code, motorista paga no celular)**: débito só com 3DS — o
  fluxo existe, mas é do e-commerce clássico; crédito funciona direto.
- **Na maquininha (caminho A)**: débito com senha no equipamento é o fluxo
  normal de POS — nada disso se aplica; é assunto do SDK.

### 3.7 Pix pelo e.Rede: só para correntista Itaú

_"Payment method available only for Itaú account holders."_ A chave Pix é
cadastrada no portal e vinculada a agência/conta Itaú.

- Devolução **parcial e total por API, síncrona**, até 90 dias ✅ — resolve a
  premissa P11 (devolução por consumo zero, ADR-0010 §4), **se** houver conta
  Itaú.
- Pergunta para você na seção 9.

---

## 4. O que isso significa para a maquininha (FASE 8)

Nada do manual muda o veredicto de ontem — ele o confirma:

- O `POST /v2/transactions` pede `cardNumber` e `securityCode`. É API
  e-commerce: o número do cartão passaria pelo **nosso** servidor, o que a
  seção 12 do briefing proíbe.
- A ponte continua sendo **token**: transação por `cardToken` (v2) ou
  `tokenCryptogram`. Quem pode gerar isso a partir da leitura física do cartão
  é o SDK do equipamento — pergunta em aberto na **Rede Store**
  (`DevSmartRede@userede.com.br`).
- As APIs de tokenização deste manual **também recebem `cardNumber`** — servem
  ao e-commerce que já lida com o número, não tiram o nosso servidor do escopo
  PCI. Não são a saída para o poste.

Os dois caminhos preparados (autorização no terminal → `recordTerminalAuthorization`;
ou terminal só lê e o servidor autoriza → `startPaidSession` + adapter e.Rede)
continuam válidos. A escolha segue travada na resposta da Rede Store.

---

## 5. O caminho B ficou concreto

Com o e.Rede lido, o fluxo "QR code no carregador, motorista paga no celular"
é implementável já: crédito direto, carteiras digitais (Apple/Google Pay via
PSP), e Pix se houver conta Itaú. É o mesmo desenho da Go Electric — os dois
caminhos convivem.

---

## 6. Sandbox: o que já se sabe para o dia do teste

- Cartões de teste tabelados (Mastercard crédito `5448 2800 0000 0007`, jan/35,
  cvv 123, etc.). Cartão fora da tabela → erro 58.
- Erros simuláveis pelo **valor** da transação (ex.: `amount: 111` → "Insufficient
  funds"); MAC simulável por mês/validade; data retroativa por `30,01–30,99`.
- Pix no sandbox: paga sozinho 2 minutos depois do QR Code (webhook automático).
- 3DS: tela de desafio simulada; valores 207/208/209 forçam cada jornada.

---

## 7. Critérios eliminatórios da FASE 7 — Rede

| # | Critério | Situação |
| - | -------- | -------- |
| E1 Pré-autorização | ✅ confirmado no manual |
| E2 Captura parcial | ✅ confirmado no manual |
| E3 Operação não assistida | ⏳ Rede Store (SDK do SmartPOS) |
| E4 Cancelamento/devolução parcial | ✅ confirmado (D+1 assíncrono, código 360) |
| E5 Pix com devolução parcial | ✅ por API, síncrona — **exige conta Itaú** |
| Sandbox | ✅ gratuito, cartões e erros simuláveis |

---

## 8. Efeito no código (o que fica destravado)

O adapter e.Rede **pode ser escrito agora** — o R-31 caía sobre "escrever sem
ler o contrato", e o contrato foi lido. O que ele precisa ter, além do padrão
`HttpPaymentProvider`:

1. **Gerenciador de token OAuth** (24 min, renovar antes; nunca logar o token).
2. **Rotas V2 sempre**; PV sem zeros à esquerda.
3. Mapeamento de estados: `Approved/Denied/Canceled/Pending` + `returnCode` das
   tabelas; desconhecido → FAILED.
4. **Devolução em dois tempos**: 360 = pendente; reconsultar até `Done`/`Denied`.
5. Retentativa guiada por reversível/irreversível (ABECS/MAC), não cega.
6. Webhook tratado como aviso; verdade = consulta por `tid`.
7. `reference` = nosso id de pagamento (≤16, único — encaixar o formato).

A trava continua: **nada opera sem passar na suíte de conformidade contra o
sandbox real** (`BORA_REDE_VERIFIED`, mesmo desenho do PagBank).

---

## 9. O que ainda depende de fora

| # | Pendência | Quem destrava |
| - | --------- | ------------- |
| 1 | Credenciais do sandbox (clientId/clientSecret do projeto "Carregador veicular") | você — copiar do card do projeto para o `.env` |
| 2 | Resposta da Rede Store sobre o SDK (pré-auth/captura no terminal? token?) | e-mail já roteirizado |
| 3 | Prazo de validade da pré-autorização **no nosso ramo** | perguntar à Rede no credenciamento |
| 4 | Pix: existe (ou haverá) conta Itaú da operação? | você — decisão comercial |
| 5 | Endereço de produção confirmado no credenciamento (`https://api.userede.com.br/erede`) | credenciamento |
