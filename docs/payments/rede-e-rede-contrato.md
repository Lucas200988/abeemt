# e.Rede — o contrato, lido da coleção oficial

Levantado em 2026-07-31 a partir da **coleção Postman "Sandbox e.Rede"**, baixada
por você do Portal do Desenvolvedor Rede.

> **Isto não é suposição.** Cada linha marcada como _confirmado_ veio do arquivo
> oficial da Rede. O que a coleção **não** diz está marcado como _a confirmar_ e
> continua valendo o risco [R-31](../architecture/risks.md).

---

## 1. A resposta que estava travando tudo

**Sim — a Rede faz pré-autorização com captura parcial.** É o modelo do
[ADR-0008](../architecture/adr/0008-pre-autorizacao-e-captura.md), inteiro.

```
POST /v1/transactions        { "capture": false, "amount": 20000, … }   ← reserva R$ 200
PUT  /v1/transactions/{tid}  { "amount": 3000 }                          ← cobra R$ 30
```

O `PUT` de captura **recebe um valor**. Um valor menor que o reservado é
exatamente "pague apenas o que consumiu". Sem esse campo, o produto não existiria
na forma desenhada.

O cancelamento parcial também existe, e com um detalhe interessante:

```
POST /v1/transactions/{tid}/refunds  { "amount": 500, "delayRefunds": true, … }
```

---

## 2. Endereços

| Item                         | Valor                                          | Procedência |
| ---------------------------- | ---------------------------------------------- | ----------- |
| Base do sandbox              | `https://sandbox-erede.useredecloud.com.br`    | confirmado  |
| Base de produção             | —                                              | **a confirmar** |
| Emissão de token OAuth (sandbox) | `https://rl7-sandbox-api.useredecloud.com.br/oauth2/token` | confirmado |

---

## 3. Operações

| Operação                    | Método e caminho                       | Corpo relevante                                        | Procedência |
| --------------------------- | -------------------------------------- | ------------------------------------------------------ | ----------- |
| Autorizar (reservar)        | `POST /v1/transactions`                | `capture: false`, `kind`, `reference`, `amount`        | confirmado  |
| Capturar (confirmar)        | `PUT /v1/transactions/{tid}`           | `{ "amount": N }`                                      | confirmado  |
| Cancelar / devolver         | `POST /v1/transactions/{tid}/refunds`  | `{ "amount": N, "urls": [{ "kind": "callback", … }] }` | confirmado  |
| Cancelar parcial em D+0     | mesmo caminho                          | acrescenta `"delayRefunds": true`                      | confirmado  |
| Consultar por `tid`         | `GET /v1/transactions/{tid}`           | —                                                      | confirmado  |
| Consultar por `reference`   | `GET /v1/transactions?reference=…`     | —                                                      | confirmado  |
| Consultar cancelamento      | `GET` por `tid` ou por `refundId`      | —                                                      | confirmado  |

`reference` é **o nosso identificador**, escolhido por nós. É por ele que se
consulta uma transação sem conhecer o `tid` — o que resolve o caso "a resposta se
perdeu e eu não sei se cobrei".

---

## 4. O ponto que exige confirmação antes de qualquer teste com dinheiro

### 4.1 A unidade do `amount` — **a confirmar**

A coleção usa `2000` na autorização e `500` num cancelamento parcial. São
inteiros, sem casas decimais, e o padrão de mercado é centavos — mas **a coleção
não declara a unidade**.

Errar isto é um erro de **100×**: cobrar R$ 2.000,00 onde deveriam ser R$ 20,00.
Fica como pendência bloqueante, e a primeira transação no sandbox deve ser
conferida no extrato antes de qualquer outra coisa.

### 4.2 A autenticação — **contraditória, a confirmar**

| Fonte                          | O que diz                                                               |
| ------------------------------ | ----------------------------------------------------------------------- |
| Página "Ponto de Partida"      | "Todas as APIs da Rede utilizam autenticação Bearer (OAuth 2.0)"        |
| Coleção Sandbox e.Rede         | As 29 requisições de transação usam **Basic** com `pv` + `token`        |
| Coleção Sandbox e.Rede         | Só 4 requisições de tokenização usam o Bearer do OAuth                  |

O prazo de migração anunciado (05/01/2026) **já passou**. Ou a coleção está
desatualizada, ou a transação ainda usa Basic. Precisa ser resolvido antes de
escrever o adapter — não dá para adivinhar qual das duas.

Note que são **quatro credenciais diferentes** em jogo: `pv`, `token`,
`ClientId`, `ClientSecret`.

### 4.3 O formato da resposta — **desconhecido**

A coleção **não traz nenhum exemplo de resposta**. Não sabemos:

- o nome do campo que devolve o identificador da transação (`tid`?)
- o campo e os valores que indicam aprovado / recusado
- onde vêm NSU, bandeira, código de autorização e quatro últimos dígitos

**É o que falta para o adapter existir.** Todo o resto do `CONTRATO` já está
respondido; sem o mapeamento de estados, o adapter interpretaria recusa como
aprovação — o defeito mais caro possível.

---

## 5. O que isso significa para a maquininha (FASE 8)

Aqui está a consequência que muda o plano, e ela não é boa nem ruim — é uma
bifurcação que precisa ser decidida com informação.

**O corpo da autorização do e.Rede pede o número do cartão:**

```json
{ "cardNumber": "5448280000000007", "securityCode": "123", "expirationMonth": 1, … }
```

Ou seja: o e.Rede é a API **online** (e-commerce). Ela espera que o número do
cartão chegue ao **nosso servidor** — e isso é justamente o que a seção 12 do
briefing proíbe, e o que expandiria o nosso escopo de PCI.

Então **o e.Rede sozinho não atende o poste**. Ele atende o motorista que paga
pelo celular.

### Existe uma ponte: transação por token

```
POST /v2/transactions   { "cardToken": "f402464d-…", "amount": 2000, … }
```

Existe o caminho de cobrar por **token de cartão**, sem o número. Se o SDK da
maquininha gerar esse token ao passar o cartão, o desenho fecha: a maquininha lê,
gera o token, e **o nosso servidor** autoriza e captura pelo e.Rede — com captura
parcial e sem nunca ver o número.

Se o SDK gerar esse token, ou se ele próprio já fizer pré-autorização e captura,
é a pergunta para a **Rede Store** (`DevSmartRede@userede.com.br`).

### Os dois caminhos, e por que nenhum trabalho foi perdido

| Se o SDK da maquininha…                          | Usamos                                                          | Situação  |
| ------------------------------------------------ | --------------------------------------------------------------- | --------- |
| fizer reserva e captura parcial no equipamento   | `recordTerminalAuthorization` — o que a FASE 8 entregou         | ✅ pronto |
| só ler o cartão e devolver um token              | `startPaidSession` + adapter e.Rede — o caminho da FASE 5       | ✅ pronto (falta o adapter) |

A arquitetura já tem os dois. A escolha entre eles é uma linha de configuração
(`BORA_TERMINAL_PAYMENT_PROVIDER` e `BORA_PAYMENT_PROVIDER`), não uma reescrita.
Foi exatamente para isto que a porta de pagamento existe
([ADR-0004](../architecture/adr/0004-payment-provider-port.md)).

### E um caminho novo que ficou viável

Com o e.Rede em mãos, o **caminho B** — QR Code no carregador, o motorista paga
pelo próprio celular — deixa de ser hipótese. É o mesmo fluxo que a Go Electric
usa **em paralelo** à maquininha (ver [matriz-adquirentes.md](matriz-adquirentes.md)).

Serve como alternativa se a Rede Store demorar, e como complemento depois.

---

## 6. Critérios eliminatórios da FASE 7 — situação da Rede

| #   | Critério                | Rede                                                        |
| --- | ----------------------- | ----------------------------------------------------------- |
| E1  | Pré-autorização         | ✅ `capture: false`                                         |
| E2  | Captura parcial         | ✅ `PUT /v1/transactions/{tid}` com `amount`                |
| E3  | Operação não assistida  | ⏳ depende da Rede Store, não do e.Rede                     |
| E4  | Cancelamento e devolução parcial | ✅ `POST …/refunds` com `amount`                    |
| E5  | Pix com devolução parcial | ⏳ não consta nesta coleção                                |
| —   | Sandbox                 | ✅ gratuito, sem exigir contrato                            |

---

## 7. O que falta, exatamente

Em ordem de importância:

1. **A página de respostas e códigos de retorno do e.Rede.** É o único item que
   falta para o adapter. Sem ele, não escrevo — escrever por suposição é o R-31.
2. **A unidade do `amount`.** Centavos ou reais.
3. **Basic ou OAuth** na API de transação, hoje.
4. **A resposta da Rede Store** sobre o SDK da maquininha.
5. Endereço de produção.

Os itens 1 a 3 estão na documentação do e.Rede, acessível pelo card do projeto no
portal. O item 4 é o e-mail para `DevSmartRede@userede.com.br`.
