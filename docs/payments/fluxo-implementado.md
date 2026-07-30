# Fluxo financeiro implementado (FASE 5)

O que existe hoje, o que ainda não existe, e onde cada garantia está.

> **O provedor é simulado.** Nenhuma chamada a adquirente real acontece. A regra
> 18.20 do briefing proíbe chamada real de pagamento sem ambiente de testes do
> fornecedor, e não temos um. Todo o resto — OCPP, banco, cálculo, parada
> automática, captura — é verdadeiro.

---

## 1. O caminho normal

```
motorista paga  →  reserva no cartão  →  carregador liga  →  consumo medido
                                                                    ↓
                            cobra o consumido  ←  recarga encerra
```

Em código:

| Passo                          | Onde                                                       |
| ------------------------------ | ---------------------------------------------------------- |
| Reserva o conector             | `PaymentsService.criarPagamentoESessao` (transação)        |
| Reserva o valor                | `PaymentProvider.authorize`                                |
| Manda o carregador ligar       | `OcppCommands.remoteStart`                                 |
| Acompanha o consumo            | `OcppHandlers.meterValues`                                 |
| Decide a parada automática     | `OcppHandlers.verificarTeto` + `@bora/pricing`             |
| Mede a ociosidade              | `OcppHandlers.medirOciosidade`                             |
| Calcula o valor final          | `SessionPricingService.finalAmount`                        |
| Cobra                          | `PaymentsService.settleSession` → `PaymentProvider.capture` |
| Reexecuta o que falhou         | `SessionWorker.tick`                                       |

### A ordem importa

O conector é reservado **antes** do cartão ([ADR-0012](../architecture/adr/0012-ordem-de-reserva-e-consumo-zero.md)).
Duas tentativas simultâneas no mesmo ponto: a segunda falha na criação da linha,
sem tocar no cartão de ninguém.

---

## 2. Cada caminho de falha, e o que acontece

| Situação                                        | O que o sistema faz                                                     | Motorista é cobrado?              |
| ----------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------- |
| Cartão recusado                                 | Sessão `DECLINED`, conector liberado                                    | Não                               |
| Adquirente fora do ar                           | Sessão `FAILED`, mensagem pedindo nova tentativa                        | Não                               |
| Conector já ocupado                             | `CONNECTOR_BUSY` antes de qualquer contato com o cartão                 | Não                               |
| Carregador recusa o comando                     | Reserva cancelada (`void`) na hora                                      | Não                               |
| Carregador não responde (120 s)                 | `SessionWorker.expirarSemResposta` → sessão `EXPIRED`, reserva cancelada | Não                               |
| Veículo não inicia (5 min)                      | `SessionWorker.expirarSemInicio` → sessão `EXPIRED`, reserva cancelada  | Não                               |
| Pagamento trava no meio                         | `SessionWorker.expirarSemPagamento` → conector liberado                 | Não                               |
| Recarga entrega 0 Wh                            | Reserva cancelada; no Pix, devolução integral                           | Não                               |
| Consumo atinge o teto                           | Parada automática, `stopReason = CEILING_REACHED`                       | Sim, até o teto                   |
| Captura falha (adquirente fora)                 | Worker tenta de novo, com espaçamento exponencial                       | Sim, quando o adquirente voltar   |
| Carregador não aceita a parada automática       | Log de erro e `failureReason` na sessão — precisa de gente              | Sim, limitado ao valor reservado  |
| Pré-autorização expira antes da captura         | Registrado na sessão; sem ação automática possível                      | **Não** — cobrança perdida (R-23) |
| Webhook reenviado                               | Índice único `(provider, eventId)` recusa o segundo                     | Não muda nada                     |
| Webhook sem assinatura válida                   | 401, nada é processado                                                  | Não muda nada                     |

---

## 3. A parada automática (risco R-22)

A proteção mais importante do modelo. Sem ela, o consumo passa do valor
reservado, o adquirente recusa capturar o excedente, e a energia entregue a mais
é prejuízo direto e irrecuperável.

- **Onde roda:** no handler de `MeterValues`, porque é o único momento em que o
  consumo real chega.
- **Limiar:** 95 % do teto no cartão, ~100 % no Pix. Os incentivos se invertem —
  no cartão, passar do teto é prejuízo nosso; no Pix, parar antes é entregar
  menos do que o motorista comprou ([ADR-0010](../architecture/adr/0010-pix-valor-fixo.md) §3).
- **A marca é gravada antes de o comando sair.** Se fosse depois, uma falha no
  envio faria o próximo `MeterValues` disparar tudo de novo, e o carregador
  receberia uma enxurrada de comandos.
- **O comando sai fora do handler.** Esperar pela resposta dentro dele trava: o
  carregador está bloqueado aguardando a resposta do `MeterValues` que estamos
  processando. Impasse dos dois lados — encontrado em teste, e aconteceria igual
  com o WEMOB.

### Verificado com o simulador

Teto de R$ 4,00, tarifa de R$ 2,50/kWh mais R$ 3,00 de conexão:

```
energia entregue     0,325 kWh
valor calculado      R$ 3,81   (300 de conexão + 81 de energia)
valor reservado      R$ 4,00
valor cobrado        R$ 3,81
motivo               CEILING_REACHED
```

Nunca ultrapassou o reservado.

---

## 4. O que ainda não existe

| O quê                                          | Onde entra |
| ---------------------------------------------- | ---------- |
| Adquirente real                                | FASE 7     |
| Maquininha (SmartPOS) chamando a API           | FASE 8     |
| Tarifa por faixa de horário                    | pós-piloto |
| Relatório de conciliação e fechamento de caixa | FASE 9     |

A interface `PaymentProvider` já prevê a maquininha: `initiatedBy: 'terminal'`
descreve o provedor cuja autorização acontece **no equipamento**, pelo SDK do
fabricante, e o endpoint `POST /payments/terminal-authorization` já registra esse
resultado e liga o carregador. É o caminho da FASE 8, e ele está testado com o
provedor `manual`.

---

## 5. Onde cada garantia mora

Nenhuma das regras abaixo depende de código de aplicação para valer:

| Regra                                | Garantida por                                                    |
| ------------------------------------ | ---------------------------------------------------------------- |
| Uma sessão ativa por conector (11.1) | Índice parcial `charging_sessions_one_active_per_connector`      |
| Um pagamento por sessão (11.2)       | `@unique` em `charging_sessions.paymentId`                       |
| Sem pagamento duplicado (11.3)       | `@unique` em `payments.idempotencyKey`                           |
| Sem webhook reprocessado (R-08)      | `@@unique([provider, eventId])` em `payment_events`              |
| Dinheiro sempre em centavos inteiros | `assertCents` em `@bora/contracts` — o Postgres trunca em silêncio |

O último merece nota: `Int` no Postgres aceita `1234.56` e grava `1234`, sem
erro. A garantia do ADR-0005 é do domínio, não do banco.
