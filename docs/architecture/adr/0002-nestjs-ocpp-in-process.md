# ADR-0002 — Servidor OCPP no mesmo processo da API NestJS

- **Status:** Aceito
- **Data:** 2026-07-29
- **Fase:** 0

## Contexto

O sistema precisa manter conexões WebSocket persistentes com os carregadores
(subprotocolo `ocpp1.6`) e, ao mesmo tempo, expor uma API REST para o painel e
para webhooks de pagamento. Quando um pagamento é aprovado, a API precisa enviar
um `RemoteStartTransaction` **para uma conexão WebSocket específica**.

Se o gateway OCPP for um serviço separado, a API não tem acesso direto à conexão:
seria preciso um canal intermediário (Redis pub/sub, fila, RPC interno) só para
dizer "envie este comando para aquele carregador". Isso adiciona uma peça de
infraestrutura e uma classe inteira de falhas (mensagem perdida, serviço fora do
ar, roteamento errado) antes de existir um único carregador conectado.

## Decisão

No MVP, o servidor WebSocket OCPP roda **dentro do mesmo processo Node** da API
NestJS, como um módulo (`apps/api/src/ocpp/`), com um `ConnectionRegistry` em
memória mapeando `chargePointIdentity → WebSocket`.

Estrutura interna do módulo:

- `OcppGateway` — servidor `ws`, valida o subprotocolo, extrai o
  `chargePointIdentity` da rota `/ocpp/:chargePointId`, autentica e registra a
  conexão.
- `ConnectionRegistry` — mapa em memória; expõe `isOnline()`, `send()`,
  `disconnect()`. **Não é fonte de verdade do estado comercial** (ver ADR-0006).
- `CallDispatcher` — envia CALL, gera `messageId`, guarda a promessa pendente,
  aplica timeout, resolve com CALLRESULT ou rejeita com CALLERROR/timeout.
- `InboundHandlers` — um handler por action (`BootNotification`, `Heartbeat`,
  `StatusNotification`, `Authorize`, `StartTransaction`, `StopTransaction`,
  `MeterValues`).
- `OcppMessageLogger` — persiste **toda** mensagem, nos dois sentidos.

O parsing e a validação vivem em `packages/ocpp-core`, sem I/O, reaproveitados
pelo simulador.

## Consequência importante: uma única instância da API no MVP

Com o registro de conexões em memória, **não é possível escalar a API
horizontalmente** sem antes resolver o roteamento de comandos entre instâncias.
Isso é aceito conscientemente: o MVP tem 1 carregador e cresce para dezenas.

## Caminho de extração (documentado agora para não virar dívida silenciosa)

Quando qualquer um destes gatilhos ocorrer, o gateway OCPP é extraído:

1. Necessidade de mais de uma instância da API (HA ou escala).
2. Mais de ~500 carregadores conectados simultaneamente.
3. Deploys da API causando quedas de conexão inaceitáveis para a operação.

O corte é limpo porque a API só fala com o gateway por três operações
(`isOnline`, `sendCall`, `disconnect`). A extração substitui a implementação em
memória do `ConnectionRegistry` por uma que roteia via Redis pub/sub ou gRPC,
sem tocar no domínio.

## Alternativas consideradas

| Alternativa                                       | Por que não agora                                                                                                                                        |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway OCPP como serviço separado desde o início | Complexidade e modos de falha novos sem benefício com 1 carregador                                                                                       |
| `@nestjs/websockets` com adapter padrão           | Otimizado para Socket.IO; OCPP exige controle do handshake, do subprotocolo e de frames crus. `ws` direto é mais previsível                              |
| Biblioteca OCPP pronta de terceiros               | Regra 19 do briefing: não assumir que funciona sem testes. Além disso, precisamos de controle total sobre tolerância a payloads divergentes (risco R-03) |

## Consequências

**Positivas**

- Um processo, um deploy, um lugar para depurar no MVP.
- Envio de comando é chamada de método, não chamada de rede.
- Latência mínima entre decisão de negócio e comando OCPP.

**Negativas**

- API não escala horizontalmente enquanto o gateway estiver embutido.
- Reinício da API derruba as conexões dos carregadores. Mitigado por: os
  carregadores reconectam automaticamente (comportamento padrão OCPP), e o
  estado comercial sobrevive no banco (ADR-0006).

**Neutras**

- O `worker` roda o mesmo código sem o listener HTTP nem o servidor OCPP.
