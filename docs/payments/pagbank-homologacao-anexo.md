# Anexo de homologação — requests e responses (PagBank)

Integração: **Borá Carregar** (Sonare Engenharia) — recarga de veículos
elétricos com pré-autorização e captura pelo consumo real.

Fluxo: reservar um teto no cartão quando a recarga começa (`capture: false`),
capturar ao final **apenas o valor da energia consumida** (captura parcial) e
liberar a diferença; cancelamento integral quando a recarga não acontece;
devolução quando aplicável.

Todas as chamadas abaixo foram executadas com sucesso contra
`https://sandbox.api.pagseguro.com` em 2026-08-03. Valores em centavos.
`<TOKEN>` e `<CARTAO_CRIPTOGRAFADO>` estão redigidos — o cartão é sempre
criptografado no cliente com a chave pública da conta; o número em claro
nunca passa pelo nosso servidor.

---

## 1. Consultar chave pública de cartão

**Request**

```
GET /public-keys/card HTTP/1.1
Host: sandbox.api.pagseguro.com
Authorization: Bearer <TOKEN>
Accept: */*
```

**Response — 200**

```json
{
  "public_key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAr+ZqgD892U9...",
  "created_at": 1754241000000
}
```

---

## 2. Criar pedido com pré-autorização (reserva de R$ 200,00)

**Request**

```
POST /orders HTTP/1.1
Host: sandbox.api.pagseguro.com
Authorization: Bearer <TOKEN>
Content-Type: application/json
Accept: */*
x-idempotency-key: verif-1754242000000-a1b2c3d4
```

```json
{
  "reference_id": "verif-1754242000000-a1b2c3d4",
  "customer": {
    "name": "Teste Bora Carregar",
    "email": "teste@sonare.com.br",
    "tax_id": "12345678909"
  },
  "items": [
    {
      "reference_id": "verif-1754242000000-a1b2c3d4",
      "name": "Recarga de veículo elétrico",
      "quantity": 1,
      "unit_amount": 20000
    }
  ],
  "charges": [
    {
      "reference_id": "verif-1754242000000-a1b2c3d4",
      "description": "Bora Carregar verificacao",
      "amount": { "value": 20000, "currency": "BRL" },
      "payment_method": {
        "type": "CREDIT_CARD",
        "installments": 1,
        "capture": false,
        "soft_descriptor": "Bora Carregar verifica",
        "card": {
          "encrypted": "<CARTAO_CRIPTOGRAFADO>",
          "holder": { "name": "Teste Bora Carregar" }
        }
      }
    }
  ]
}
```

**Response — 201 (resumo dos campos relevantes)**

```json
{
  "id": "ORDE_...",
  "reference_id": "verif-1754242000000-a1b2c3d4",
  "charges": [
    {
      "id": "CHAR_A5E1C10D-E077-4FEA-A93A-E8AAEA40135E",
      "status": "AUTHORIZED",
      "amount": {
        "value": 20000,
        "currency": "BRL",
        "summary": { "total": 20000, "paid": 0, "refunded": 0 }
      },
      "payment_response": { "code": "20000", "message": "SUCESSO" },
      "payment_method": {
        "type": "CREDIT_CARD",
        "installments": 1,
        "capture": false,
        "card": { "brand": "visa", "first_digits": "453962", "last_digits": "2097" }
      }
    }
  ]
}
```

---

## 3. Consultar pagamento

**Request**

```
GET /charges/CHAR_A5E1C10D-E077-4FEA-A93A-E8AAEA40135E HTTP/1.1
Host: sandbox.api.pagseguro.com
Authorization: Bearer <TOKEN>
Accept: */*
```

**Response — 200**

```json
{
  "id": "CHAR_A5E1C10D-E077-4FEA-A93A-E8AAEA40135E",
  "status": "AUTHORIZED",
  "amount": {
    "value": 20000,
    "currency": "BRL",
    "summary": { "total": 20000, "paid": 0, "refunded": 0 }
  }
}
```

---

## 4. Capturar pagamento — captura PARCIAL (R$ 8,00 de R$ 200,00 reservados)

É o coração do produto: cobrar apenas a energia efetivamente consumida.

**Request**

```
POST /charges/CHAR_A5E1C10D-E077-4FEA-A93A-E8AAEA40135E/capture HTTP/1.1
Host: sandbox.api.pagseguro.com
Authorization: Bearer <TOKEN>
Content-Type: application/json
Accept: */*
x-idempotency-key: capture-CHAR_A5E1C10D-E077-4FEA-A93A-E8AAEA40135E-800
```

```json
{ "amount": { "value": 800 } }
```

**Response — 201**

```json
{
  "id": "CHAR_A5E1C10D-E077-4FEA-A93A-E8AAEA40135E",
  "status": "PAID",
  "amount": {
    "value": 20000,
    "currency": "BRL",
    "summary": { "total": 20000, "paid": 800, "refunded": 0 }
  },
  "payment_response": { "code": "20000", "message": "SUCESSO" }
}
```

---

## 5. Cancelar pagamento — devolução do valor capturado

**Request**

```
POST /charges/CHAR_A5E1C10D-E077-4FEA-A93A-E8AAEA40135E/cancel HTTP/1.1
Host: sandbox.api.pagseguro.com
Authorization: Bearer <TOKEN>
Content-Type: application/json
Accept: */*
x-idempotency-key: refund-CHAR_A5E1C10D-E077-4FEA-A93A-E8AAEA40135E-800
```

```json
{ "amount": { "value": 800 } }
```

**Response — 201**

```json
{
  "id": "CHAR_A5E1C10D-E077-4FEA-A93A-E8AAEA40135E",
  "status": "CANCELED",
  "amount": {
    "value": 20000,
    "currency": "BRL",
    "summary": { "total": 20000, "paid": 800, "refunded": 800 }
  },
  "payment_response": { "code": "20000", "message": "SUCESSO" }
}
```

Observação de robustez implementada: logo após a captura o sandbox pode
responder `40008 · refund_temporarily_unavailable`; tratamos como erro
temporário com nova tentativa. Em caso de `40005 · idempotency_key_in_use`,
consultamos a cobrança antes de re-tentar com chave nova — nunca devolvemos
em dobro.

---

## 6. Cancelar pagamento — desfazer pré-autorização sem captura

Caso "recarga não aconteceu": reserva de R$ 50,00 desfeita integralmente.

**Request**

```
POST /charges/CHAR_7C3A2CC0-0F67-4982-9124-186D5C308894/cancel HTTP/1.1
Host: sandbox.api.pagseguro.com
Authorization: Bearer <TOKEN>
Content-Type: application/json
Accept: */*
x-idempotency-key: void-CHAR_7C3A2CC0-0F67-4982-9124-186D5C308894
```

```json
{ "amount": { "value": 5000 } }
```

**Response — 201**

```json
{
  "id": "CHAR_7C3A2CC0-0F67-4982-9124-186D5C308894",
  "status": "CANCELED",
  "amount": {
    "value": 5000,
    "currency": "BRL",
    "summary": { "total": 5000, "paid": 0, "refunded": 0 }
  }
}
```

---

## 7. Recusa do emissor (tratamento de negativa)

Criação de pedido com cartão de teste da aba "Negada" — a recusa é exibida ao
cliente e nenhuma sessão de recarga é liberada.

**Request** — igual ao item 2, com `capture: true` e o cartão de teste
recusado.

**Response — 201 (cobrança negada)**

```json
{
  "charges": [
    {
      "id": "CHAR_...",
      "status": "DECLINED",
      "payment_response": { "code": "10002", "message": "..." }
    }
  ]
}
```

---

## Webhooks

URL de notificação enviada por pedido em `notification_urls` (HTTPS).
Autenticidade conferida pelo cabeçalho `x-authenticity-token` com
`sha256("{token}-{payload}")` sobre os bytes crus do corpo, em comparação de
tempo constante. Eventos com assinatura inválida são descartados.
