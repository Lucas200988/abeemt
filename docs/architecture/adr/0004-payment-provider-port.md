# ADR-0004 — Pagamento como porta (`PaymentProvider`)

- **Status:** Aceito
- **Data:** 2026-07-29
- **Fase:** 0 (implementação na FASE 5)

## Contexto

O adquirente/gateway ainda **não foi escolhido** — a decisão é sua, na FASE 7,
após a matriz comparativa. Mesmo assim, as fases 5 e 6 precisam de um fluxo de
pagamento funcional para exercitar sessão, tarifação e idempotência.

Além disso, o produto se propõe a funcionar com diferentes adquirentes,
SmartPOS e gateways ao longo do tempo. Acoplar o domínio a uma API específica
seria repetir o erro que o briefing pede explicitamente para evitar (regra 24).

## Decisão

Definir uma **porta** `PaymentProvider` em `packages/payment-core`, com o
contrato do briefing, e nunca permitir que o módulo de sessões conheça um
provedor concreto.

```typescript
interface PaymentProvider {
  readonly name: string;

  createPayment(input: CreatePaymentInput): Promise<PaymentResult>;
  getPayment(paymentId: string): Promise<PaymentStatus>;
  cancelPayment(paymentId: string): Promise<PaymentResult>;
  refundPayment(paymentId: string, amount?: number): Promise<PaymentResult>;
  capturePayment?(paymentId: string, amount: number): Promise<PaymentResult>;

  verifyWebhook(payload: unknown, headers: Record<string, string>): Promise<boolean>;
  parseWebhook(payload: unknown): Promise<PaymentWebhookEvent>;
}
```

`capturePayment` é opcional porque nem todo provedor suporta pré-autorização +
captura posterior. Quando ausente, o fluxo cai para "cobrança direta", e isso
fica registrado na sessão.

### Adapters do MVP

1. **`MockPaymentProvider`** — determinístico, para testes automatizados. Permite
   forçar cenários: aprovado, recusado, pendente, timeout, provedor indisponível,
   webhook com assinatura inválida, valor divergente.
2. **`ManualPaymentProvider`** — o administrador aprova/recusa pelo painel.
   Serve para operação real assistida (o operador confere o comprovante da
   maquininha física e libera a carga) e para a FASE 4 com o WEMOB real, sem
   depender de nenhuma integração.
3. **Adapter real** — apenas na FASE 7, após sua escolha.

Seleção via configuração (`PAYMENT_PROVIDER=mock|manual|...`), resolvida por um
factory registrado no módulo do Nest.

### O que a plataforma armazena (e o que nunca armazena)

**Armazena:** `providerPaymentId`, valor autorizado/capturado/estornado, método,
status, `authorizationCode`, `nsu`, bandeira, últimos 4 dígitos, `pixEndToEndId`,
`terminalId`, timestamps e `rawMetadata` **já mascarado**.

**Nunca armazena:** PAN completo, CVV, trilha magnética, senha do cartão, ou
qualquer dado que amplie escopo PCI. Regra reforçada por revisão de schema e por
redaction no logger.

### Regras de domínio que a porta não pode violar

- Um pagamento inicia **no máximo uma** sessão (`UNIQUE(payment_id)` em
  `charging_sessions`).
- O valor sempre é conferido contra o `Payment` local — nunca se confia no valor
  do payload do webhook.
- Todo webhook passa por `verifyWebhook` antes de qualquer efeito. Em ambiente
  local, isso só pode ser relaxado por flag explícita, jamais por omissão.

## Alternativas consideradas

| Alternativa                                    | Por que não                                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Escolher um adquirente agora e integrar        | Contraria a regra 24 e a decisão ainda é sua                                                         |
| Usar uma biblioteca de "pagamentos universais" | Camada extra opaca; a variedade brasileira (Pix, SmartPOS, NSU, conciliação) raramente é bem coberta |
| Sem abstração, integrar direto quando escolher | Retrabalho garantido em sessões, testes e painel                                                     |

## Consequências

**Positivas**

- Fases 5 e 6 avançam sem depender da escolha comercial.
- Testar cenário de falha de pagamento é trivial e determinístico.
- Trocar de adquirente no futuro é escrever um adapter, não refatorar o domínio.
- `ManualPaymentProvider` é útil de verdade — permite piloto com maquininha
  avulsa antes de qualquer integração.

**Negativas**

- A interface pode não encaixar perfeitamente no primeiro provedor real. É
  esperado: na FASE 7 a porta pode ser ajustada, com ADR novo, tendo dois
  adapters como referência para não moldá-la a um único fornecedor.

**Neutras**

- Uma indireção a mais em um fluxo já assíncrono.
