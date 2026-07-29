# ADR-0006 — Estado da sessão persistido no banco, não em memória

- **Status:** Aceito
- **Data:** 2026-07-29
- **Fase:** 0

## Contexto

Requisito explícito do briefing (§8): _"Não depender exclusivamente da conexão
mantida em memória para determinar o estado comercial da sessão"_, e (§9 dos
critérios da FASE 9): _"Nenhuma sessão fica sem estado definido"_.

O cenário concreto: um motorista paga R$ 40, a recarga começa, e a API é
reiniciada (deploy, crash, OOM). Se o estado da sessão viver em memória, a
plataforma perde a noção de que existe uma carga em andamento paga. O carregador
continua entregando energia; ninguém fatura; ninguém encerra.

## Decisão

A `ChargingSession` no PostgreSQL é a **única fonte de verdade** do estado
comercial. A conexão WebSocket em memória responde apenas a uma pergunta: _"este
carregador está alcançável neste instante?"_.

### Máquina de estados persistida

```
AWAITING_PAYMENT ──► PAYMENT_APPROVED ──► AWAITING_CHARGER ──► COMMAND_SENT
                             │                    │                  │
                             │                    │                  ▼
                             │                    │              STARTING
                             │                    │                  │
                             ▼                    ▼                  ▼
                          REJECTED            FAILED            CHARGING
                                                                     │
                                                             ┌───────┴───────┐
                                                             ▼               ▼
                                                         STOPPING        FAILED
                                                             │
                                                             ▼
                                                         COMPLETED

Estados terminais: COMPLETED · REJECTED · CANCELLED · FAILED · EXPIRED
```

Regras:

1. **Toda transição é um `UPDATE` condicional** (`WHERE id = ? AND status = ?`).
   Se afetar 0 linhas, outro ator já transicionou — a operação vira no-op, não
   sobrescrita. Isso torna a máquina segura sob concorrência entre API e worker,
   sem lock distribuído.
2. **Todo estado não-terminal tem um prazo** (`deadlineAt`). O worker varre
   prazos vencidos e força a transição. Consequência: nenhuma sessão fica presa
   para sempre, mesmo que a mensagem esperada nunca chegue.
3. **Toda transição é registrada** com timestamp, ator (sistema, operador,
   carregador) e motivo — é isso que alimenta a linha do tempo do painel exigida
   em §13 do briefing.
4. **Uma sessão ativa por conector** é garantida por índice único parcial:

```sql
CREATE UNIQUE INDEX one_active_session_per_connector
  ON charging_sessions (connector_id)
  WHERE status IN ('PAYMENT_APPROVED','AWAITING_CHARGER','COMMAND_SENT','STARTING','CHARGING','STOPPING');
```

Duas tentativas simultâneas: o banco recusa a segunda. Não depende de a
aplicação ter checado antes, nem de haver uma única instância rodando.

### Reconciliação na reconexão

Quando um carregador (re)conecta, o servidor compara o que o banco diz com o que
o carregador reporta:

| Banco                 | Carregador                                      | Ação                                                                                                                  |
| --------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Sessão `CHARGING`     | `StatusNotification: Charging`, mesma transação | Nada — segue monitorando                                                                                              |
| Sessão `CHARGING`     | `Available` / sem transação                     | Encerrar por reconciliação; energia pelo último `MeterValue` conhecido; marcar para revisão                           |
| Sem sessão            | transação ativa reportada                       | Criar sessão órfã (`paymentId` nulo), sinalizar no painel — é energia entregue sem cobrança, o operador precisa saber |
| Sessão `COMMAND_SENT` | `StartTransaction` chegando                     | Transição normal para `STARTING`/`CHARGING`                                                                           |

O terceiro caso é justamente o que o briefing exige em §16 ("sessão sem
pagamento", "pagamento sem sessão").

### O que fica em memória (e pode ser perdido sem prejuízo)

- O socket em si.
- As promessas de CALLs em voo. Se a API cair com um `RemoteStartTransaction`
  pendente, o `outbox_commands` (ADR-0003) tem o registro `IN_FLIGHT` e o worker
  decide: reconsultar o estado do carregador ou marcar falha — nunca reenviar
  cegamente (risco R-14).

## Alternativas consideradas

| Alternativa                              | Por que não                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Estado em memória com snapshot periódico | Janela de perda; complexidade de sincronização                                                                   |
| Event sourcing completo                  | Auditoria excelente, custo de implementação alto demais para o MVP. A tabela de transições dá 80% do benefício   |
| Redis como store de estado               | Persistência configurável, mas separa estado de sessão dos dados relacionais — dual-write de novo (ver ADR-0003) |

## Consequências

**Positivas**

- Restart da API não perde sessão nem dinheiro.
- Concorrência resolvida pelo banco, não por locks de aplicação.
- Linha do tempo do painel sai de graça da tabela de transições.
- Auditoria e diagnóstico pós-incidente ficam viáveis.

**Negativas**

- Cada transição é uma escrita no banco. Irrelevante nesta escala.
- Mais código do que "guardar num Map".

**Neutras**

- O worker torna-se peça essencial: sem ele, timeouts não são aplicados. Precisa
  de health check próprio e alerta se parar (FASE 9).
