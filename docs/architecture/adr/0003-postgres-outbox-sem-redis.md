# ADR-0003 — PostgreSQL + outbox em vez de Redis/BullMQ no MVP

- **Status:** Aceito
- **Data:** 2026-07-29
- **Fase:** 0

## Contexto

O briefing pede explicitamente: *"Utilize Redis e BullMQ somente caso sejam
necessários... Caso seja possível manter confiabilidade usando PostgreSQL e um
padrão de outbox, documente a decisão."*

As necessidades reais de assincronismo no MVP são cinco:

1. Controlar comandos OCPP pendentes (enviados, aguardando resposta, com retry).
2. Impedir comandos duplicados.
3. Processar webhooks de pagamento de forma idempotente.
4. Executar retentativas controladas.
5. Controlar sessões concorrentes (uma por conector).

## Decisão

**Não usar Redis nem BullMQ no MVP.** Usar PostgreSQL para as cinco
necessidades, com dois mecanismos:

### 1. Tabela `outbox_commands`

```
id                  uuid pk
charger_id          uuid
session_id          uuid null
command_type        text          -- RemoteStartTransaction, RemoteStopTransaction, ...
payload             jsonb
idempotency_key     text UNIQUE   -- ex.: "session:<id>:remote-start"
status              text          -- PENDING | IN_FLIGHT | SUCCEEDED | FAILED | ABANDONED
attempts            int default 0
max_attempts        int default 3
next_attempt_at     timestamptz
ocpp_message_id     text null
last_error          text null
created_at / updated_at
```

Consumo pelo worker:

```sql
SELECT * FROM outbox_commands
 WHERE status = 'PENDING' AND next_attempt_at <= now()
 ORDER BY next_attempt_at
 FOR UPDATE SKIP LOCKED
 LIMIT 20;
```

`FOR UPDATE SKIP LOCKED` dá exatamente a semântica de fila com múltiplos
consumidores, sem broker. Está disponível desde o PostgreSQL 9.5 e é a base de
implementações de fila em produção há anos.

**A idempotência vem da constraint `UNIQUE(idempotency_key)`**, não de lógica de
aplicação. Duas tentativas concorrentes de enfileirar o mesmo comando: uma
grava, a outra recebe violação de unicidade e é tratada como no-op. Isso resolve
o requisito 2 de forma estruturalmente correta — algo que um `if` em memória
nunca garante sob concorrência.

### 2. Escalonador de timeouts no `apps/worker`

Um job periódico (`@nestjs/schedule`, a cada 10 s) varre sessões cujos prazos
expiraram (`awaiting_charger_deadline`, `awaiting_start_deadline`) e aplica a
transição de estado adequada. É idempotente: a transição só ocorre se a sessão
ainda estiver no estado anterior (update condicional com `WHERE status = ...`).

Vantagem sobre um timer em memória: sobrevive a reinício da aplicação. Um
`setTimeout` de 5 minutos morre com o processo; uma linha no banco com
`deadline_at` não.

### 3. Webhooks

Tabela `payment_events` com `UNIQUE(provider, provider_event_id)`. A ingestão é
uma transação: grava o evento e aplica o efeito no mesmo commit. Reentrega gera
violação de unicidade → resposta 200 sem reprocessar.

## Justificativa quantitativa

| Requisito | Solução PostgreSQL | Suficiente? |
| --- | --- | --- |
| Throughput de comandos | dezenas por hora no MVP | Sim, por três ordens de grandeza |
| Latência de despacho | polling de 1 s (ou `LISTEN/NOTIFY` para o caminho crítico) | Sim — o gargalo real é o carregador, que leva segundos para responder |
| Durabilidade | ACID, mesmo commit dos dados de negócio | **Melhor** que Redis: não existe janela entre "gravei a sessão" e "enfileirei o comando" |
| Retry com backoff | `next_attempt_at` | Sim |
| Deduplicação | constraint única | Sim, e mais forte que a do BullMQ |

O ponto decisivo é o terceiro: com Redis, gravar a sessão no Postgres e
enfileirar no Redis são duas operações que podem divergir (dual-write). Com
outbox, é **um único commit**. Para um sistema que aciona equipamento elétrico
após receber dinheiro, essa garantia vale mais que a performance extra.

## Gatilhos objetivos para reavaliar

Introduzimos Redis/BullMQ quando **qualquer** um ocorrer:

1. Mais de ~50 comandos OCPP por segundo em regime.
2. Latência de despacho abaixo de 100 ms virar requisito.
3. Múltiplas instâncias da API precisarem coordenar conexões (relacionado ao ADR-0002).
4. Necessidade de fan-out pub/sub em tempo real para o painel (hoje resolvido com polling / SSE simples).
5. Necessidade de rate limiting distribuído entre instâncias.

Nesse momento, um novo ADR supersede este. A migração é contida: o worker troca
a fonte de trabalho, o modelo de dados permanece.

## Alternativas consideradas

| Alternativa | Por que não |
| --- | --- |
| Redis + BullMQ desde o início | Um container e um modo de falha a mais; problema de dual-write; sem ganho no volume do MVP |
| `setTimeout` em memória para timeouts | Perde tudo em restart — inaceitável para timeout que decide captura de pagamento |
| `pg_cron` | Menos visibilidade e testabilidade que um job na aplicação |
| `LISTEN/NOTIFY` puro, sem tabela | Notificação não é durável; se ninguém escuta no momento, perde-se |

## Consequências

**Positivas**
- Menos infraestrutura: `docker-compose` com Postgres, API e web apenas.
- Comando e dado de negócio no mesmo commit — sem inconsistência possível.
- Fila inspecionável com SQL comum; depuração trivial.

**Negativas**
- Polling gera carga base contínua no banco (irrelevante nesta escala).
- Latência de até ~1 s no despacho (irrelevante: o carregador responde em segundos).
- Precisamos escrever ~150 linhas que o BullMQ daria de graça.

**Neutras**
- `docker-compose.yml` já preverá o serviço Redis **comentado**, para quando um
  gatilho for atingido.
