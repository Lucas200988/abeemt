# Architecture Decision Records — Borá Carregar

Registros de decisões arquiteturais. Formato baseado em Michael Nygard.

**Regra:** um ADR aceito não é editado. Se a decisão mudar, cria-se um novo ADR
que **supersede** o anterior, e o antigo passa a status `Superseded by ADR-XXXX`.

| #                                            | Título                                                | Status | Data       |
| -------------------------------------------- | ----------------------------------------------------- | ------ | ---------- |
| [0001](0001-monorepo-pnpm-turborepo.md)      | Monorepo com pnpm workspaces e Turborepo              | Aceito | 2026-07-29 |
| [0002](0002-nestjs-ocpp-in-process.md)       | Servidor OCPP no mesmo processo da API NestJS         | Aceito | 2026-07-29 |
| [0003](0003-postgres-outbox-sem-redis.md)    | PostgreSQL + outbox em vez de Redis/BullMQ no MVP     | Aceito | 2026-07-29 |
| [0004](0004-payment-provider-port.md)        | Pagamento como porta (`PaymentProvider`)              | Aceito | 2026-07-29 |
| [0005](0005-dinheiro-centavos-energia-wh.md) | Dinheiro em centavos e energia em Wh, sempre inteiros | Aceito | 2026-07-29 |
| [0006](0006-estado-de-sessao-no-banco.md)    | Estado da sessão persistido no banco, não em memória  | Aceito | 2026-07-29 |
| [0007](0007-nome-do-produto-configuravel.md) | Marca do produto configurável ("Borá Carregar")       | Aceito | 2026-07-29 |
| [0008](0008-pre-autorizacao-e-captura.md)    | Pré-autorização + captura pelo consumo real           | Aceito | 2026-07-29 |
| [0009](0009-topologia-de-dominios.md)        | Topologia de domínios e endpoints (`sonare.com.br`)   | Aceito | 2026-07-29 |
| [0010](0010-pix-valor-fixo.md)               | Pix com valor fixo, sem devolução automática          | Aceito | 2026-07-29 |
| [0011](0011-painel-por-polling.md)           | Painel atualizado por polling, não WebSocket          | Aceito | 2026-07-29 |
| [0012](0012-ordem-de-reserva-e-consumo-zero.md) | Ordem da reserva e o que fazer com consumo zero    | Aceito | 2026-07-30 |

> **Nota sobre o ADR-0004:** o [ADR-0008](0008-pre-autorizacao-e-captura.md)
> altera a interface `PaymentProvider` definida no
> [ADR-0004](0004-payment-provider-port.md) — `capturePayment` deixa de ser
> opcional e `voidPayment` é adicionado. O ADR-0004 permanece válido no restante.
