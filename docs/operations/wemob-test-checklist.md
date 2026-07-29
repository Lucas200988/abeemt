# Checklist de Teste Controlado — WEG WEMOB (FASE 4)

> **Não executar antes da validação explícita das fases 1, 2 e 3 e da sua
> autorização para a FASE 4.** Este checklist pressupõe que o
> [`tupi-rollback-plan.md`](tupi-rollback-plan.md) está preenchido e revisado.

**Data do teste:** `__________`  **Início:** `____`  **Término:** `____`
**Presente no local:** `__________`  **Operando o painel:** `__________`

---

## Bloco A — Pré-requisitos (todos obrigatórios)

### A.1 Software validado com o simulador
- ⬜ Fluxo completo Boot → Heartbeat → Status → RemoteStart → Start → MeterValues → RemoteStop → Stop passando nos testes automatizados
- ⬜ Reconexão testada e funcionando
- ⬜ Timeout testado e funcionando
- ⬜ Comando duplicado não cria sessão duplicada (testado)
- ⬜ Painel exibe status, sessão ao vivo e mensagens OCPP
- ⬜ Logs estruturados com `chargerId`, `sessionId`, `correlationId`

### A.2 Infraestrutura de produção temporária
- ⬜ Domínio público configurado: `__________________`
- ⬜ Certificado TLS válido e testado (`wss://` responde)
- ⬜ Endpoint OCPP acessível pela internet: `wss://______/ocpp/{chargePointId}`
- ⬜ Firewall permite apenas as portas necessárias (443; nada além disso exposto)
- ⬜ Credencial individual gerada para este carregador (armazenada em cofre)
- ⬜ Banco com backup automatizado e restauração testada ao menos uma vez
- ⬜ Monitoramento ativo com alerta de desconexão
- ⬜ Servidor testado com o **simulador conectando pela internet** (não só localhost)

### A.3 Dados e documentação
- ⬜ [`wemob-data-collection.md`](wemob-data-collection.md) §1 (itens 1–10) preenchido
- ⬜ [`tupi-rollback-plan.md`](tupi-rollback-plan.md) §2 completo, com capturas de tela
- ⬜ Contatos de emergência confirmados e disponíveis **durante a janela**
- ⬜ Carregador cadastrado no nosso sistema com o `chargePointIdentity` correto
- ⬜ Conectores cadastrados com tipo e potência corretos
- ⬜ Tarifa de teste criada (valor simbólico)

### A.4 Condições operacionais
- ⬜ Janela acordada com o estabelecimento, fora do horário de pico
- ⬜ Duração máxima definida: `____ min`
- ⬜ Pessoa fisicamente presente ao lado do carregador durante todo o teste
- ⬜ Veículo elétrico compatível disponível — modelo: `__________`
- ⬜ Aviso físico no local informando manutenção programada
- ⬜ Critério de abortar combinado com toda a equipe
- ⬜ **Sua autorização explícita registrada**

---

## Bloco B — Execução do teste

Registrar horário e resultado de cada passo. Anexar capturas do painel.

### B.1 Conexão inicial

| # | Passo | Esperado | Resultado | Hora |
| --- | --- | --- | --- | --- |
| 1 | Registrar configuração original (rollback §2) | Tudo capturado | ⬜ | |
| 2 | Alterar URL OCPP para o nosso endpoint | Salvo com sucesso | ⬜ | |
| 3 | Aguardar conexão WebSocket | Conexão aceita, subprotocolo `ocpp1.6` | ⬜ | |
| 4 | Receber `BootNotification` | Payload completo registrado | ⬜ | |
| 5 | Responder `Accepted` com intervalo de heartbeat | Carregador aceita | ⬜ | |
| 6 | Receber `Heartbeat` periódico | Intervalo conforme configurado | ⬜ | |
| 7 | Receber `StatusNotification` dos conectores | Status `Available` | ⬜ | |
| 8 | Painel mostra carregador **online** | Status correto e `lastSeenAt` atualizando | ⬜ | |

**Ponto de decisão:** se os passos 3–5 não ocorrerem em **15 minutos**, executar
o rollback e analisar os logs offline. Não insistir além disso.

### B.2 Preparação da recarga

| # | Passo | Esperado | Resultado | Hora |
| --- | --- | --- | --- | --- |
| 9 | Conectar o veículo ao carregador | `StatusNotification: Preparing` | ⬜ | |
| 10 | Painel reflete "conectado ao veículo" | Estado correto | ⬜ | |

### B.3 Início remoto

| # | Passo | Esperado | Resultado | Hora |
| --- | --- | --- | --- | --- |
| 11 | Criar pagamento manual aprovado no painel | Sessão em `PAYMENT_APPROVED` | ⬜ | |
| 12 | Enviar `RemoteStartTransaction` | Resposta `Accepted` (ou `Rejected` — registrar) | ⬜ | |
| 13 | Receber `StartTransaction` | `transactionId` e `meterStart` registrados | ⬜ | |
| 14 | `StatusNotification: Charging` | Sessão em `CHARGING` | ⬜ | |
| 15 | Painel mostra sessão em andamento | Energia começa a subir | ⬜ | |

Se o passo 12 retornar `Rejected`, **registrar o motivo exato** e não repetir
mais de duas vezes. Isso é dado valioso, não falha do teste.

### B.4 Monitoramento (duração controlada: `____ min`)

| # | Passo | Esperado | Resultado | Hora |
| --- | --- | --- | --- | --- |
| 16 | Receber `MeterValues` periodicamente | Intervalo: `____ s` | ⬜ | |
| 17 | Registrar `measurand` e unidades recebidos | Documentar em `docs/ocpp/wemob-quirks.md` | ⬜ | |
| 18 | Energia acumulada crescendo de forma coerente | Sem saltos absurdos | ⬜ | |
| 19 | Painel atualiza energia ao vivo | Atualização visível | ⬜ | |
| 20 | Comparar leitura do display do carregador com o painel | Divergência: `____` | ⬜ | |

O passo 20 é o teste de confiança mais importante do dia: se o número do nosso
painel não bate com o do equipamento, nada mais importa.

### B.5 Encerramento remoto

| # | Passo | Esperado | Resultado | Hora |
| --- | --- | --- | --- | --- |
| 21 | Enviar `RemoteStopTransaction` | Resposta `Accepted` | ⬜ | |
| 22 | Receber `StopTransaction` | `meterStop` e `reason` registrados | ⬜ | |
| 23 | `StatusNotification` volta para `Available` | Conector liberado | ⬜ | |
| 24 | Energia calculada = `meterStop − meterStart` | Confere com o display | ⬜ | |
| 25 | Valor calculado conforme a tarifa de teste | Conferido manualmente | ⬜ | |
| 26 | Sessão em `COMPLETED` no painel | Linha do tempo completa | ⬜ | |
| 27 | Desconectar o veículo | Sem erro | ⬜ | |

### B.6 Teste de resiliência (opcional, somente se B.1–B.5 foram limpos)

| # | Passo | Esperado | Resultado |
| --- | --- | --- | --- |
| 28 | Derrubar o WebSocket do nosso lado durante carga | Carregador reconecta sozinho | ⬜ |
| 29 | Verificar reconciliação de estado após reconexão | Sessão preservada e coerente | ⬜ |
| 30 | Reiniciar a API durante uma carga | Sessão sobrevive; estado correto após subir | ⬜ |

Só executar 28–30 com o veículo disponível e tempo de janela sobrando. Se
houver qualquer dúvida, pular.

---

## Bloco C — Encerramento

- ⬜ Executar [`tupi-rollback-plan.md`](tupi-rollback-plan.md) §3 integralmente
- ⬜ Confirmar carregador online na Tupi (§4 do rollback)
- ⬜ Executar teste funcional de confirmação na Tupi (§5 do rollback)
- ⬜ Comunicar o estabelecimento que o serviço está normalizado
- ⬜ Exportar os logs OCPP do teste
- ⬜ Criar/atualizar `docs/ocpp/wemob-quirks.md` com o comportamento observado
- ⬜ Registrar o tempo real de rollback em §6 do plano de rollback
- ⬜ Redigir o relato do teste com o que funcionou, o que falhou e os próximos passos

---

## Bloco D — Proibições absolutas durante a FASE 4

Nenhum destes comandos ou ações, sob nenhuma circunstância, sem sua aprovação
explícita item a item:

- ❌ `Reset` (soft ou hard)
- ❌ `UnlockConnector`
- ❌ `UpdateFirmware` / qualquer atualização de firmware
- ❌ `ChangeConfiguration` em parâmetros elétricos (corrente, potência, limites)
- ❌ `ChangeAvailability` para `Inoperative` sem plano de reversão
- ❌ `ClearCache` / `SendLocalList` / alteração de lista de autorização
- ❌ Reset de fábrica
- ❌ Alteração de qualquer parâmetro de proteção elétrica
- ❌ Teste em horário de pico
- ❌ Teste sem alguém presente no local

---

## Bloco E — Registro de resultado

**Resultado geral:** ☐ sucesso ☐ sucesso parcial ☐ abortado ☐ falha

**Critérios de aceite da FASE 4:**

| Critério | Atendido |
| --- | --- |
| WEMOB conecta ao nosso backend | ⬜ |
| Sessão remota inicia | ⬜ |
| Medições são recebidas | ⬜ |
| Sessão remota encerra | ⬜ |
| Dados são registrados corretamente | ⬜ |
| Procedimento de retorno à Tupi funciona | ⬜ |
| Nenhuma configuração crítica é perdida | ⬜ |

**Observações e aprendizados:**

```
____________________________________________________________________
____________________________________________________________________
```
