# OCPP 1.6J — mensagens implementadas

Estado em 2026-07-29 (FASE 2). Este documento é a referência de **o que existe
hoje**, não do que o OCPP 1.6 define — a maior parte do protocolo está fora do
escopo do MVP e permanece não implementada por decisão.

## Transporte

| Item                        | Valor                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Protocolo                   | OCPP 1.6 JSON sobre WebSocket (OCPP-J)                                                                                |
| Subprotocolo                | `ocpp1.6` — **obrigatório** no handshake                                                                              |
| Endpoint de desenvolvimento | `ws://localhost:3001/ocpp/{chargePointIdentity}`                                                                      |
| Endpoint de produção        | `wss://ocpp.sonare.com.br/ocpp/{chargePointIdentity}` ([ADR-0009](../architecture/adr/0009-topologia-de-dominios.md)) |
| Autenticação                | Basic Auth no handshake, usuário = `chargePointIdentity`                                                              |

O servidor OCPP compartilha a porta HTTP da API: o upgrade para WebSocket
acontece no mesmo listener, conforme [ADR-0002](../architecture/adr/0002-nestjs-ocpp-in-process.md).

### Handshake — condições de recusa

| Situação                                                            | Resposta HTTP |
| ------------------------------------------------------------------- | ------------- |
| `chargePointIdentity` ausente no caminho                            | 400           |
| Subprotocolo `ocpp1.6` não oferecido                                | 400           |
| Carregador não cadastrado                                           | 404           |
| Estabelecimento inativo                                             | 403           |
| Credencial inválida ou ausente (quando o carregador tem credencial) | 401           |

Carregador **sem** `credentialsHash` cadastrado conecta sem autenticação. Isso é
deliberado e temporário: o simulador precisa disso, e a premissa E4 (o WEMOB
suportar Basic Auth) **ainda não foi confirmada**. Antes do piloto, todo
carregador em produção precisa ter credencial individual.

## Mensagens recebidas do carregador

| Ação                            | Situação | Efeito                                                                                                                                                  |
| ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BootNotification`              | ✅       | Grava fabricante, modelo, firmware, número de série e dados do modem. Responde `Accepted`, ou `Pending` se o carregador estiver bloqueado pelo operador |
| `Heartbeat`                     | ✅       | Atualiza `lastHeartbeatAt` e devolve a hora do servidor                                                                                                 |
| `StatusNotification`            | ✅       | Atualiza o estado do conector; registra código de erro quando houver. Conector 0 = o carregador inteiro, não gera registro de conector                  |
| `Authorize`                     | ✅       | Aceita apenas `idTag` de sessão paga aguardando início. Qualquer outro é `Invalid`                                                                      |
| `StartTransaction`              | ✅       | Atribui `transactionId`, vincula à sessão, grava leitura inicial                                                                                        |
| `StopTransaction`               | ✅       | Calcula energia e duração, encerra a sessão                                                                                                             |
| `MeterValues`                   | ✅       | Guarda todas as amostras; mantém a energia da sessão monotônica                                                                                         |
| `DiagnosticsStatusNotification` | ❌       | Fora do MVP — responde `NotImplemented`                                                                                                                 |
| `FirmwareStatusNotification`    | ❌       | Atualização de firmware está fora do MVP                                                                                                                |
| `DataTransfer`                  | ❌       | Fora do MVP                                                                                                                                             |

## Comandos enviados ao carregador

| Ação                     | Situação | Observação                                                     |
| ------------------------ | -------- | -------------------------------------------------------------- |
| `RemoteStartTransaction` | ✅       | Timeout de 120 s para o carregador aceitar (regra 11.5)        |
| `RemoteStopTransaction`  | ✅       | Timeout padrão de 30 s                                         |
| `ChangeAvailability`     | ❌       | Previsto para a FASE 3 (bloqueio de carregador)                |
| `Reset`                  | ❌       | **Só com aprovação administrativa explícita** (regra 18.2)     |
| `UnlockConnector`        | ❌       | Não implementado por decisão                                   |
| `ChangeConfiguration`    | ❌       | Alterar parâmetros do equipamento exige aprovação              |
| `GetConfiguration`       | ❌       | Previsto para a FASE 4, para registrar a configuração do WEMOB |

## Comportamentos que valem conhecer

### Ordem de processamento

Mensagens de uma mesma conexão são processadas **em série**. Sem isso, um
`MeterValues` poderia ser processado antes de o `StartTransaction` que o precede
ter sido gravado, e não encontraria a sessão.

### Reconexão

Quando a mesma `chargePointIdentity` reconecta, a conexão anterior é derrubada
(código 1012). Queda de 4G costuma deixar o socket antigo aparentemente vivo por
minutos; sem isso, comandos iriam para um socket que nunca responderia.

O evento `close` do socket antigo **não** marca o carregador offline se já houver
uma conexão nova — a verificação compara a instância do socket.

### Deduplicação

Uma `CALL` recebida com `messageId` já visto para o mesmo carregador **não é
processada de novo**: devolvemos a resposta anterior. A garantia é o índice único
parcial `ocpp_messages_inbound_unique`, não uma verificação em memória.

É isso que faz um `StartTransaction` retransmitido devolver o mesmo
`transactionId` em vez de abrir uma segunda sessão (regra 11.3, risco R-08).

### `transactionId`

O OCPP 1.6 exige um **inteiro** atribuído pelo Central System. Nosso id de sessão
é UUID, que não serve. Vem da sequência `ocpp_transaction_id_seq` do PostgreSQL —
`nextval` nunca devolve o mesmo valor duas vezes, mesmo sob concorrência.

### Normalização de energia

Leituras de energia são convertidas para **Wh inteiro** na entrada
([ADR-0005](../architecture/adr/0005-dinheiro-centavos-energia-wh.md)):

| Situação             | Tratamento                                               |
| -------------------- | -------------------------------------------------------- |
| `unit` ausente       | Assume `Wh` (padrão do OCPP 1.6)                         |
| `unit: "kWh"`        | Multiplica por 1000                                      |
| `measurand` ausente  | Assume `Energy.Active.Import.Register`                   |
| Valor fracionário    | Arredondado explicitamente                               |
| Amostras com `phase` | Ignoradas para energia acumulada (são parciais)          |
| Unidade desconhecida | **Erro** — adivinhar a unidade é adivinhar quanto cobrar |

### MeterValues fora de ordem

A leitura acumulada do medidor é monotônica por natureza. Mantemos o **maior**
valor já visto: aceitar a última leitura recebida faria uma mensagem atrasada
reduzir a energia da sessão e, com ela, o valor a cobrar.

### Medição inconsistente

Leitura final menor que a inicial acontece de verdade (medidor reiniciado, troca
de firmware, leitura corrompida). A sessão é encerrada com `energyWh = 0` e
`failureReason` preenchido, para revisão do operador. Nunca geramos energia
negativa.

### Recarga iniciada fora da plataforma

Um `StartTransaction` sem sessão correspondente — alguém usou o cartão RFID do
próprio carregador — é **aceito** e registrado como sessão sem pagamento. Recusar
deixaria o equipamento em estado inconsistente com o nosso. O caso aparece na
conciliação.

## Erros devolvidos

| Situação                                                          | Código OCPP               |
| ----------------------------------------------------------------- | ------------------------- |
| JSON inválido                                                     | `FormationViolation`      |
| Não é array, tipo desconhecido, `messageId` ou `action` inválidos | `ProtocolError`           |
| Payload não passa na validação da ação                            | `TypeConstraintViolation` |
| Ação não suportada                                                | `NotImplemented`          |
| Falha no processamento                                            | `InternalError`           |

Mensagens malformadas são **registradas** em `ocpp_messages` com o payload bruto
antes de responder — uma mensagem que não conseguimos interpretar é exatamente a
que precisamos investigar depois.

Quando a mensagem está tão malformada que nem o `messageId` é legível, não há
como correlacionar uma resposta: registramos e ignoramos.

## Tolerância a divergências de firmware

O briefing (regra 18.20) avisa que carregadores não implementam OCPP da mesma
forma. A política adotada é **estrito na saída, tolerante na entrada**:

- Payload omitido em ações vazias (`Heartbeat`) é aceito como `{}`.
- Timestamp sem timezone é interpretado como UTC em vez de recusado.
- Campos extras não derrubam a mensagem, e ficam registrados no payload bruto.
- Campos **obrigatórios** continuam obrigatórios.

O motivo: recusar um `StopTransaction` por um campo a mais significaria perder o
encerramento de uma recarga paga.

Divergências observadas no WEMOB real serão documentadas em
`docs/ocpp/wemob-quirks.md` durante a FASE 4.

## Simulador

`apps/ocpp-simulator` implementa o lado do carregador, incluindo os
comportamentos que quebram sistemas:

```bash
pnpm --filter @bora/ocpp-simulator start -- --identity SIM-001 --plug-in
pnpm --filter @bora/ocpp-simulator start -- --help
```

| Opção               | Simula                                      |
| ------------------- | ------------------------------------------- |
| `--reject-start`    | Carregador recusa o comando de início       |
| `--reject-stop`     | Carregador recusa o comando de parada       |
| `--never-start`     | Aceita o comando mas o veículo nunca inicia |
| `--out-of-order`    | Leitura de medidor atrasada                 |
| `--energy-unit kWh` | Firmware que reporta em kWh                 |
| `--no-reconnect`    | Não reconecta ao cair                       |

A API programática oferece ainda `simulateConnectionLoss()` (queda abrupta, como
perda de 4G), `simulateFault()`, `sendMalformedJson()` e `goSilent` (não responde,
para exercitar o timeout do servidor).

## Cobertura de testes

170 testes automatizados no total do projeto; 87 cobrem OCPP:

- **42** no protocolo puro (`packages/ocpp-core`) — envelope, erros, normalização
  de unidades, reconciliação de leituras.
- **45** de ponta a ponta (`apps/api/test/ocpp.e2e-spec.ts`) — servidor real,
  banco real, simulador conectando pela rede.

O fluxo completo dos 12 passos exigidos no critério de aceite da FASE 2 está
coberto por um único teste que percorre `BootNotification` → sessão concluída.
