# Architecture Decision Records — Borá Carregar

Registros de decisões arquiteturais. Formato baseado em Michael Nygard.

**Regra:** um ADR aceito não é editado. Se a decisão mudar, cria-se um novo ADR
que **supersede** o anterior, e o antigo passa a status `Superseded by ADR-XXXX`.

| # | Título | Status | Data |
| --- | --- | --- | --- |
| [0001](0001-monorepo-pnpm-turborepo.md) | Monorepo com pnpm workspaces e Turborepo | Aceito | 2026-07-29 |
| [0002](0002-nestjs-ocpp-in-process.md) | Servidor OCPP no mesmo processo da API NestJS | Aceito | 2026-07-29 |
| [0003](0003-postgres-outbox-sem-redis.md) | PostgreSQL + outbox em vez de Redis/BullMQ no MVP | Aceito | 2026-07-29 |
| [0004](0004-payment-provider-port.md) | Pagamento como porta (`PaymentProvider`) | Aceito | 2026-07-29 |
| [0005](0005-dinheiro-centavos-energia-wh.md) | Dinheiro em centavos e energia em Wh, sempre inteiros | Aceito | 2026-07-29 |
| [0006](0006-estado-de-sessao-no-banco.md) | Estado da sessão persistido no banco, não em memória | Aceito | 2026-07-29 |
| [0007](0007-nome-do-produto-configuravel.md) | Marca do produto configurável ("Borá Carregar") | Aceito | 2026-07-29 |
