# ADR-0011 — Atualização do painel por polling, não WebSocket

- **Status:** Aceito
- **Data:** 2026-07-29
- **Fase:** 3

## Contexto

O briefing (FASE 3) pede "atualização em tempo real **ou** atualização periódica
do painel". O operador precisa ver a energia subir durante uma recarga e o
carregador ficar online sem apertar F5.

Duas formas de fazer isso:

1. **Push** — WebSocket ou Server-Sent Events do servidor para o navegador.
2. **Polling** — o navegador consulta a cada N segundos.

## Decisão

**Polling**, com intervalo por tela:

| Tela                   | Intervalo | Por quê                                     |
| ---------------------- | --------- | ------------------------------------------- |
| Sessão ao vivo (ativa) | 2 s       | O operador fica olhando a energia subir     |
| Detalhe do carregador  | 3 s       | Estado do conector muda durante a operação  |
| Diagnóstico OCPP       | 3 s       | Mensagens chegam a cada poucos segundos     |
| Visão geral e sessões  | 5 s       | Painorama, não acompanhamento               |
| Sessão encerrada       | 30 s      | Não muda mais; consultar mais é desperdício |
| Estabelecimentos       | 30 s      | Dados de cadastro                           |

A sessão encerrada **baixa a própria frequência** ao detectar que virou final.

## Por que não push

Um canal push só para o painel exigiria manter estado de assinatura em memória —
quem está olhando qual sessão, quem precisa ser notificado do quê. É exatamente
o tipo de estado que o [ADR-0003](0003-postgres-outbox-sem-redis.md) evita no MVP,
e que precisaria ser resolvido de novo quando houvesse mais de uma instância da
API.

Além disso, o volume não justifica: um carregador, poucos operadores. Uma
consulta a cada 2 segundos com uma aba aberta é ruído no Postgres.

E há uma vantagem de operação que costuma ser subestimada: quando o polling
falha, o comportamento é óbvio — a tela mostra o erro e tenta de novo no próximo
ciclo. Quando um WebSocket falha, ele pode ficar aparentemente conectado
mostrando dados congelados, que é o pior estado possível para um painel de
operação.

## Consequências

**Positivas**

- Nenhum estado de assinatura no servidor; escala horizontal sem mudança.
- Falha é visível e se recupera sozinha no ciclo seguinte.
- O hook `usePolling` concentra a lógica; trocar para SSE depois mexe em um arquivo.

**Negativas**

- Latência de até um intervalo para ver uma mudança. Aceitável: 2 segundos numa
  recarga de 40 minutos.
- Consultas mesmo sem mudança. Irrelevante nesta escala, e o gatilho para
  reavaliar está definido abaixo.

**Quando reavaliar** — qualquer um destes:

- Mais de ~50 carregadores com painel aberto simultaneamente.
- Necessidade de latência abaixo de 1 segundo.
- O custo de consulta aparecer no perfil do banco.

O caminho então é Server-Sent Events na mesma rota (mais simples que WebSocket
para fluxo unidirecional), contido no `usePolling`.
