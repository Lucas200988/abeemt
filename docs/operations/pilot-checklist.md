# Checklist do piloto

A FASE 9 termina quando este checklist estiver **assinado** — cada item com
data e rubrica de quem conferiu. Item bloqueante (🔒) sem visto = piloto não
começa.

## A. Infraestrutura

| ✔   | Item                                                                                            | Data / rubrica |
| --- | ----------------------------------------------------------------------------------------------- | -------------- |
| ☐   | 🔒 Servidor com HTTPS válido no painel e `wss://` no OCPP (ADR-0009)                            |                |
| ☐   | 🔒 `NODE_ENV=production` — sobe recusando provedor simulado como padrão                         |                |
| ☐   | 🔒 Segredos novos gerados para produção (JWT, senha do banco); nada de valor de desenvolvimento |                |
| ☐   | 🔒 Backup diário agendado E copiado para fora da máquina                                        |                |
| ☐   | 🔒 **Ensaio de restauração executado NESTA máquina** ([roteiro](backup-restore.md))             |                |
| ☐   | Porta do banco fechada para fora; só API e painel expostos (regra 18.21)                        |                |

## B. Pagamento

| ✔   | Item                                                                                                       | Data / rubrica |
| --- | ---------------------------------------------------------------------------------------------------------- | -------------- |
| ☐   | 🔒 Credenciamento e.Rede de PRODUÇÃO concluído (PV real, chave real)                                       |                |
| ☐   | 🔒 Verificação `pnpm verificar:rede` contra PRODUÇÃO com valor simbólico real, seguido de devolução        |                |
| ☐   | 🔒 Prazo de captura da pré-autorização do nosso ramo confirmado com a Rede e registrado no `CONTRATO_REDE` |                |
| ☐   | URL de notificação (webhook) cadastrada na Rede com token, e token no `.env`                               |                |
| ☐   | Decisão sobre Pix registrada (conta Itaú sim/não)                                                          |                |

## C. Equipamento (FASE 4 — pré-requisito do piloto)

| ✔   | Item                                                                         | Data / rubrica |
| --- | ---------------------------------------------------------------------------- | -------------- |
| ☐   | 🔒 `wemob-data-collection.md` preenchido                                     |                |
| ☐   | 🔒 `tupi-rollback-plan.md` revisado, com a configuração original fotografada |                |
| ☐   | 🔒 Teste 4a (rede local) e 4b (infra pública) aprovados                      |                |
| ☐   | Intervalo de MeterValues do WEMOB configurado e registrado                   |                |

## D. Operação

| ✔   | Item                                                                                                      | Data / rubrica |
| --- | --------------------------------------------------------------------------------------------------------- | -------------- |
| ☐   | 🔒 Quem opera leu os [roteiros de incidente](incident-response.md) e sabe achar os alertas na Visão Geral |                |
| ☐   | 🔒 Tarifa real cadastrada e simulada no painel (sem tarifa, recarga sai R$ 0,00)                          |                |
| ☐   | Teto de pré-autorização revisado para o público real (R$ 200 é chute inicial — premissa P13)              |                |
| ☐   | Contato do suporte da Rede e da WEG à mão, com o PV e o número de série anotados                          |                |
| ☐   | Sinalização no local: como pagar, e um telefone de socorro                                                |                |

## E. Prova final (o ensaio geral)

| ✔   | Item                                                                                                                       | Data / rubrica |
| --- | -------------------------------------------------------------------------------------------------------------------------- | -------------- |
| ☐   | 🔒 Uma recarga real completa no equipamento real, paga de verdade, cobrada certa e visível no painel                       |                |
| ☐   | 🔒 Uma recarga interrompida de propósito (desligar o carregador no meio) tratada conforme o roteiro, sem cobrança indevida |                |
| ☐   | Suíte inteira verde na véspera (`pnpm test`) e CI verde no repositório                                                     |                |

---

Assinatura do responsável: ______________________ Data: ****/****/______
