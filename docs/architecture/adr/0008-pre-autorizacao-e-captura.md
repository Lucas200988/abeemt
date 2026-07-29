# ADR-0008 — Pré-autorização + captura pelo consumo real

- **Status:** Aceito
- **Data:** 2026-07-29
- **Fase:** 0 (implementação nas fases 5, 6 e 7)
- **Origem:** decisão do cliente em 2026-07-29, resolvendo a premissa P1

## Contexto

Havia duas formas de cobrar o motorista:

1. **Pré-pago com valor fixo** — o motorista escolhe R$ 40, paga, carrega até
   acabar o crédito. Simples de implementar; mas se ele consumir R$ 25, ou
   ficamos com R$ 15 que não são nossos, ou precisamos devolver.
2. **Pré-autorização + captura pelo consumo real** — reservamos um limite no
   cartão, entregamos a energia, e cobramos exatamente o que foi consumido.

Você escolheu a opção 2. É o modelo dos postos de combustível e hotéis no
Brasil, e é o correto do ponto de vista do motorista: ele nunca paga por energia
que não recebeu.

A escolha tem consequências reais que precisam estar registradas antes de
qualquer linha de código.

## Decisão

O fluxo financeiro padrão do MVP é **pré-autorização (reserva) → entrega de
energia → captura parcial pelo valor real → liberação automática do saldo**.

### Fluxo completo

```
1. Motorista seleciona carregador/conector no terminal
2. Sistema define o TETO da sessão (pré-autorização), ex.: R$ 100
3. Adquirente PRÉ-AUTORIZA R$ 100  → dinheiro reservado, NÃO cobrado
4. Sessão → PAYMENT_APPROVED
5. RemoteStartTransaction → carga inicia
6. MeterValues chegam; sistema recalcula o valor corrente continuamente
7. Ao atingir o teto → RemoteStopTransaction automático  (ver §4)
   ou motorista/veículo encerra normalmente
8. StopTransaction → energia final conhecida
9. Cálculo do valor final (ADR-0005)
10. CAPTURA do valor final (≤ pré-autorizado)
11. Saldo não capturado é liberado pelo emissor automaticamente
```

### Consequências diretas no modelo de dados

O campo `Payment` já previa os três valores necessários — agora eles têm
semântica obrigatória e distinta:

| Campo | Significado neste modelo |
| --- | --- |
| `amountAuthorizedCents` | Teto da sessão. Reservado no cartão, **nunca cobrado integralmente por padrão** |
| `amountCapturedCents` | Valor efetivamente cobrado = valor calculado da sessão |
| `amountRefundedCents` | Só usado em correção pós-captura (erro operacional, contestação) |

Novos estados de pagamento necessários:

```
PENDING → AUTHORIZED → CAPTURED
             │              │
             ├──► VOIDED    └──► PARTIALLY_REFUNDED / REFUNDED
             └──► EXPIRED
```

`VOIDED` (cancelamento da pré-autorização, sem captura) é **diferente** de
`REFUNDED` (estorno de valor já capturado). Confundir os dois gera cobrança
indevida e trabalho de conciliação. São transições distintas, com métodos
distintos da porta `PaymentProvider`.

### `capturePayment` deixa de ser opcional

No [ADR-0004](0004-payment-provider-port.md), a interface declarava:

```typescript
capturePayment?(paymentId: string, amount: number): Promise<PaymentResult>;
```

Com esta decisão, **um provedor sem `capturePayment` não serve para o produto**.
A interface passa a exigi-lo:

```typescript
capturePayment(paymentId: string, amountCents: number): Promise<PaymentResult>;
voidPayment(paymentId: string): Promise<PaymentResult>;  // cancela pré-autorização
```

Isso torna "suporta pré-autorização com captura parcial" um **critério
eliminatório** na matriz de adquirentes da FASE 7 — não uma linha a mais na
tabela comparativa.

## 4. Regra nova: parada automática no teto

Esta é a consequência menos óbvia e a mais importante.

**Não se pode capturar mais do que foi pré-autorizado.** Portanto, o valor
pré-autorizado é um teto rígido da sessão, e o sistema precisa garantir que a
recarga pare antes de ultrapassá-lo.

Regras:

1. A cada `MeterValues` recebido, o sistema recalcula o valor corrente com a
   tarifa congelada na sessão.
2. Ao atingir um **limiar de segurança** (proposta: 95% do teto), o sistema
   envia `RemoteStopTransaction` automaticamente.
3. A margem de 5% existe porque `MeterValues` chegam a cada N segundos e o
   carregador leva alguns segundos para parar — sem margem, ultrapassaríamos o
   teto entre duas leituras.
4. Se ainda assim o valor calculado exceder o pré-autorizado, **captura-se o
   valor pré-autorizado** e registra-se a diferença como perda operacional, com
   alerta. Nunca se tenta capturar acima do autorizado: o adquirente recusaria e
   a sessão ficaria sem cobrança nenhuma — o pior dos dois resultados.
5. O painel mostra ao operador o teto, o consumido e a margem restante.

O limiar (95%) e a margem serão parametrizáveis e calibrados na FASE 4 com dados
reais de periodicidade de `MeterValues` do WEMOB.

## 5. Captura mínima e sessão sem consumo

| Situação | Ação |
| --- | --- |
| Sessão nunca iniciou (timeout, carregador offline, veículo não plugado) | `voidPayment` — cancelamento total da pré-autorização. **Nada é cobrado** |
| Sessão iniciou e consumiu 0 Wh | `voidPayment`, salvo se a tarifa tiver taxa de conexão — nesse caso captura-se apenas a taxa |
| Sessão consumiu normalmente | Captura do valor calculado, respeitando `minimumAmountCents` da tarifa |
| Valor calculado < mínimo da tarifa | Captura o mínimo (regra comercial já prevista na FASE 6) |
| Falha após início, energia entregue | Captura do consumido; sessão marcada para revisão |

## 6. Janela de validade da pré-autorização

Pré-autorizações **expiram**. O prazo varia por adquirente e bandeira
(tipicamente de poucos dias a algumas semanas) — o número exato entra na matriz
da FASE 7, não vamos assumir um valor aqui.

Consequência operacional: **a captura tem que acontecer logo após o fim da
sessão**, não em um fechamento diário. O sistema captura no encerramento da
sessão; se a captura falhar, entra em retry pelo outbox
([ADR-0003](0003-postgres-outbox-sem-redis.md)) com alerta se não concluir dentro
de uma janela configurável.

Uma pré-autorização que expira sem captura é energia entregue e não faturada —
por isso vira alerta operacional de alta prioridade na FASE 9, não uma linha de
log.

## 7. O problema do Pix (não resolvido nesta decisão)

**Pix não tem pré-autorização.** É pagamento imediato e final. O modelo desta ADR
não se aplica a ele.

Três caminhos possíveis, **decisão pendente sua** (pergunta 17 em
`assumptions.md`):

| Opção | Como funciona | Custo |
| --- | --- | --- |
| **(a)** Pix pré-pago com devolução parcial | Motorista paga R$ 50 fixo; ao fim, devolvemos o não consumido pela API de devolução do Pix | Fluxo financeiro paralelo; devolução leva tempo; UX pior |
| **(b)** Pix fora do MVP | Só cartão no MVP | Perde-se o público sem cartão, que no Brasil não é pequeno |
| **(c)** Pix com valor fixo, sem devolução | Motorista compra "R$ 30 de energia" e carrega até acabar | Simples, mas precisa ser explicitíssimo na interface para não parecer abusivo |

**Recomendação:** (a) para o piloto, porque preserva a promessa do produto
("você paga o que consumiu") em ambos os meios. Mas é trabalho adicional real e
precisa da sua decisão antes da FASE 7.

Registro honesto: este ponto **não estava coberto** na decisão que você tomou, e
é a maior lacuna remanescente do modelo financeiro.

## 8. Cartão de débito

Débito frequentemente **não** suporta pré-autorização no Brasil. Se parte
relevante dos motoristas usa débito, esse público fica sem caminho — mesmo
problema do Pix. Também vira critério da matriz da FASE 7.

## Alternativas consideradas

| Alternativa | Por que não |
| --- | --- |
| Pré-pago com valor fixo (opção 1) | Descartada por você. Era mais simples, mas cobra por energia não entregue |
| Pós-pago com cadastro do motorista | Exige conta e cartão salvo — contraria a premissa central do produto ("sem cadastro") |
| Pré-autorização com captura total sempre | Anula o benefício: cobraria o teto independentemente do consumo |

## Consequências

**Positivas**
- O motorista paga exatamente o que consumiu. É a promessa correta e defensável.
- Elimina a necessidade de estorno no caminho feliz — não há valor a devolver.
- Falha antes do início não gera cobrança nenhuma (`void`), o que reduz
  drasticamente o risco R-07 (cobrar e não entregar).

**Negativas**
- Reduz o universo de adquirentes viáveis (pré-autorização + captura parcial não
  é universal, especialmente em SmartPOS).
- Exige a regra de parada automática no teto (§4) — código novo, com risco
  próprio, que precisa ser bem testado.
- Não cobre Pix nem débito sem uma decisão adicional (§7, §8).
- O valor reservado fica indisponível no limite do motorista por alguns dias até
  o emissor liberar — pode gerar reclamação. Precisa ser comunicado na interface.

**Neutras**
- `MockPaymentProvider` e `ManualPaymentProvider` (FASE 5) passam a simular o
  ciclo completo autorizar → capturar/cancelar, o que já exercita o fluxo real.
