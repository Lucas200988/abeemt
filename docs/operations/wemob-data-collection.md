# Levantamento de Dados — WEG WEMOB Station

> **Estado atual: NADA FOI COLETADO.** Este documento é o formulário a ser
> preenchido. Nenhuma conexão, comando ou alteração foi executada contra o
> equipamento real durante a FASE 0, conforme a instrução do briefing.

**Equipamento de referência do MVP**

| Campo | Valor conhecido |
| --- | --- |
| Fabricante | WEG |
| Linha/modelo | WEMOB Station |
| Potência aproximada | 30 kW |
| Comunicação | 4G |
| Protocolo declarado | OCPP 1.6 JSON (1.6J) |
| Plataforma atual | Tupi |
| Situação | **Em operação, conectado à Tupi** |

---

## 1. Dados bloqueantes para a FASE 4

Sem estes, a FASE 4 não pode ser planejada com segurança.

| # | Dado | Valor | Onde obter | Status |
| --- | --- | --- | --- | --- |
| 0 | Interface de rede em uso hoje (4G ou Ethernet) | `________` | Menu técnico | ⬜ |
| 1 | URL OCPP atual configurada no equipamento | `________` | Menu técnico do carregador / painel Tupi | ⬜ |
| 2 | `chargePointIdentity` atual | `________` | Menu técnico / painel Tupi | ⬜ |
| 3 | Tipo de autenticação OCPP em uso | ☐ nenhuma ☐ Basic Auth ☐ certificado ☐ outro: `____` | Menu técnico | ⬜ |
| 4 | Credencial atual (usuário/senha), se houver | **não transcrever para o repositório** — guardar em cofre | Menu técnico | ⬜ |
| 5 | Procedimento exato para alterar a URL OCPP | passo a passo | Manual WEG / suporte WEG | ⬜ |
| 6 | A alteração é reversível sem intervenção da WEG? | ☐ sim ☐ não ☐ desconhecido | Manual / suporte | ⬜ |
| 7 | Senha de instalador / menu técnico disponível? | ☐ sim ☐ não | Documentação de instalação | ⬜ |
| 8 | Suporte WEG ativo / garantia vigente? | ☐ sim ☐ não — contato: `________` | Nota fiscal / contrato | ⬜ |
| 9 | Existe cláusula contratual com a Tupi que impeça a desconexão? | ☐ sim ☐ não | Contrato Tupi | ⬜ |
| 10 | Janela segura para teste (data/hora, duração) | `________` | Definição sua + operação do local | ⬜ |

## 2. Dados técnicos do equipamento

| # | Dado | Valor | Status |
| --- | --- | --- | --- |
| 11 | Número de série | `________` | ⬜ |
| 12 | Versão de firmware atual | `________` | ⬜ |
| 13 | Quantidade de conectores | `____` | ⬜ |
| 14 | Tipo de cada conector (CCS2, CHAdeMO, Tipo 2, GB/T) | 1: `____` · 2: `____` | ⬜ |
| 15 | Potência nominal por conector (kW) | 1: `____` · 2: `____` | ⬜ |
| 16 | Corrente máxima (A) e tensão (V) | `________` | ⬜ |
| 17 | Versão OCPP exata reportada pelo firmware | `________` | ⬜ |
| 18 | Suporta OCPP 1.6J (WebSocket) ou apenas 1.6 SOAP? | ☐ JSON ☐ SOAP ☐ ambos | ⬜ |
| 19 | Interfaces de rede disponíveis | ☑ 4G ☐ Wi-Fi **☑ Ethernet** *(confirmado 2026-07-29)* | ✅ |
| 20 | Operadora e qualidade do sinal 4G no local | `________` | ⬜ |
| 21 | IP fixo ou dinâmico? Há NAT/firewall no caminho? | `________` | ⬜ |
| 21a | **Existe cabo de rede puxado até o carregador?** | ☑ **sim** *(confirmado 2026-07-29)* | ✅ |
| 21b | A interface de rede é selecionável no menu e a troca é reversível? | ☐ sim ☐ não | ⬜ 🔴 |
| 21c | O firmware aceita `ws://` (sem TLS) com IP privado? | ☐ sim ☐ não ☐ desconhecido | ⬜ 🔴 |
| 21d | Configuração IP atual (DHCP ou estático + endereço) | `________` | ⬜ |
| 21e | Faixa de IP da rede local e há DHCP disponível? | `________` | ⬜ |

> **Itens 19 e 21a confirmados: o equipamento tem Ethernet e existe cabo até
> ele.** A **FASE 4a está viável** — primeiro teste em rede local, sem domínio
> público, TLS ou VPS. É a maior redução de risco do projeto (R-18 caiu de
> severidade 16 para 6).
>
> Restam **21b e 21c** como bloqueantes da 4a: se a troca de interface não for
> reversível, ou se o firmware recusar `ws://` sem TLS (risco R-26), o ganho
> desaparece e vamos direto para o caminho público (FASE 4b). Vale perguntar
> ambos ao suporte WEG **antes** da janela de teste.

## 3. Comportamento OCPP a observar (preencher durante a FASE 4)

Estes campos serão preenchidos com a **captura real** de mensagens. São o insumo
para `docs/ocpp/wemob-quirks.md`.

| # | Observação | Resultado | Status |
| --- | --- | --- | --- |
| 22 | Intervalo de `Heartbeat` solicitado/aceito | `____ s` | ⬜ |
| 23 | Payload completo do `BootNotification` | anexar JSON | ⬜ |
| 24 | `measurand` presentes nos `MeterValues` | `________` | ⬜ |
| 25 | Envia `Energy.Active.Import.Register`? Em qual unidade? | ☐ Wh ☐ kWh ☐ ausente | ⬜ |
| 26 | Periodicidade dos `MeterValues` | `____ s` | ⬜ |
| 27 | Formato de timestamp (com/sem timezone) | `________` | ⬜ |
| 28 | Sequência de `StatusNotification` ao plugar o veículo | `________` | ⬜ |
| 29 | Aceita `RemoteStartTransaction` com `idTag` arbitrário? | ☐ sim ☐ não | ⬜ |
| 30 | Exige `Authorize` antes do `StartTransaction`? | ☐ sim ☐ não | ⬜ |
| 31 | Usa `LocalAuthList` / lista local de tags? | ☐ sim ☐ não | ⬜ |
| 32 | Valores de `stopReason` reportados | `________` | ⬜ |
| 33 | Comportamento ao perder conexão durante a carga | `________` | ⬜ |
| 34 | Tempo típico de reconexão após queda | `____ s` | ⬜ |
| 35 | Envia mensagens enfileiradas após reconexão? | ☐ sim ☐ não | ⬜ |
| 36 | Chaves suportadas em `GetConfiguration` | anexar lista | ⬜ |

## 4. Dados do local de instalação

| # | Dado | Valor | Status |
| --- | --- | --- | --- |
| 37 | Endereço completo da instalação | `________` | ⬜ |
| 38 | Estabelecimento responsável | `________` | ⬜ |
| 39 | Horário de funcionamento e período de pico | `________` | ⬜ |
| 40 | Há alguém no local durante a janela de teste? Quem? | `________` | ⬜ |
| 41 | Veículo elétrico compatível disponível para o teste | ☐ sim — modelo: `____` ☐ não | ⬜ |
| 42 | Acesso físico ao painel/menu do equipamento | ☐ sim ☐ não | ⬜ |

## 5. Regras para o preenchimento

1. **Nenhuma credencial real neste arquivo.** Senhas, tokens e chaves vão para
   um cofre (1Password/Bitwarden/gerenciador da empresa). Aqui registra-se
   apenas *onde* está guardado.
2. **Capturas de tela** de toda tela de configuração antes de qualquer alteração,
   armazenadas fora do repositório (é material com dados sensíveis).
3. **Registrar valores literais**, não interpretações. "URL: `wss://ocpp.tupi.
   com.br/…`" e não "aponta pra Tupi".
4. Este documento é pré-requisito de entrada da FASE 4. Itens 1 a 10 são
   bloqueantes.

## 6. O que já está decidido sem depender destes dados

Para que a espera não trave o projeto: as fases 1, 2, 3, 5 e 6 **não dependem**
de nenhum item deste documento. Elas rodam contra o simulador OCPP. O
levantamento acima pode acontecer em paralelo ao desenvolvimento.
