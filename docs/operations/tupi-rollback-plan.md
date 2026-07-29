# Plano de Retorno à Tupi — Procedimento de Rollback

> **Este documento é pré-requisito obrigatório da FASE 4.**
> Nenhuma alteração no WEMOB real acontece antes de ele estar preenchido,
> revisado e com a seção 2 (registro do estado atual) completa.

**Objetivo:** garantir que, em qualquer momento e por qualquer motivo, o
carregador WEG WEMOB possa voltar a operar normalmente na plataforma Tupi em
poucos minutos, sem perda de configuração.

**Princípio:** *a configuração original é registrada antes de ser tocada.* Não
existe "eu lembro qual era".

---

## 1. Quando executar este plano

| Gatilho | Urgência |
| --- | --- |
| Fim planejado da janela de teste | Normal |
| Carregador não conecta ao nosso servidor em 15 min | Imediata |
| Comportamento anômalo do equipamento (falha, LED de erro, travamento) | Imediata |
| Cliente real precisa carregar durante a janela | Imediata |
| Qualquer dúvida da pessoa presente no local | Imediata |
| Nosso servidor indisponível ou instável | Imediata |
| Decisão sua, por qualquer motivo | Imediata |

**Regra:** na dúvida, reverte-se. Reverter é barato; deixar um carregador de
produção sem plataforma não é.

---

## 2. Registro do estado atual — PREENCHER ANTES DE QUALQUER ALTERAÇÃO

### 2.1 Configuração OCPP original

| Campo | Valor original | Registrado por | Data/hora |
| --- | --- | --- | --- |
| URL do servidor OCPP | `________________________` | | |
| `chargePointIdentity` | `________________________` | | |
| Tipo de autenticação | `________________________` | | |
| Usuário (se Basic Auth) | `________________________` | | |
| Senha (se Basic Auth) | **guardada em:** `________` (cofre, não aqui) | | |
| Intervalo de heartbeat | `________` | | |
| Demais parâmetros OCPP alterados | `________________________` | | |

### 2.2 Evidências obrigatórias (armazenar fora do repositório)

- ⬜ Captura de tela de **todas** as telas de configuração de rede do equipamento
- ⬜ Captura de tela de **todas** as telas de configuração OCPP
- ⬜ Captura de tela do painel Tupi mostrando o carregador online e seus dados
- ⬜ Foto do equipamento em operação normal (LEDs/display) antes do teste
- ⬜ Foto da etiqueta de identificação (nº de série, modelo)
- ⬜ Exportação/print do histórico recente de sessões na Tupi

### 2.3 Contatos de emergência — preencher antes da janela

| Papel | Nome | Telefone | Disponível na janela? |
| --- | --- | --- | --- |
| Responsável presente no local | | | ⬜ |
| Responsável técnico Sonare | | | ⬜ |
| Suporte WEG | | | ⬜ |
| Suporte Tupi | | | ⬜ |
| Responsável pelo estabelecimento | | | ⬜ |

---

## 3. Procedimento de rollback

**Tempo alvo: menos de 10 minutos.** Cronometrar na execução real e registrar.

### Passo 1 — Encerrar qualquer sessão em andamento com segurança
1. Se houver recarga ativa iniciada por nós, enviar `RemoteStopTransaction` pelo painel.
2. Aguardar o `StopTransaction`.
3. Se não houver resposta em 60 s, parar pelo próprio equipamento (botão/interface local).
4. **Nunca** usar `Reset` para "resolver" — pode deixar o equipamento em estado pior.
5. Desconectar o cabo do veículo, se houver.

### Passo 2 — Restaurar a configuração OCPP
1. Acessar o menu técnico do equipamento (mesmo caminho usado para alterar).
2. Restaurar a **URL original** exatamente como registrada em §2.1.
3. Restaurar `chargePointIdentity` original, se tiver sido alterado.
4. Restaurar credenciais de autenticação originais.
5. Restaurar demais parâmetros alterados.
6. Salvar/aplicar.

### Passo 3 — Reiniciar a comunicação
1. Aguardar a reconexão automática (até 2 min).
2. Se não reconectar, reiniciar **apenas a comunicação** pela interface local, se
   o equipamento oferecer essa opção isoladamente.
3. Se ainda assim não conectar, aí sim considerar reinício do equipamento — com
   sua aprovação explícita e o suporte WEG acessível.

### Passo 4 — Confirmar restauração na Tupi
1. ⬜ Carregador aparece **online** no painel Tupi.
2. ⬜ Heartbeat sendo recebido pela Tupi.
3. ⬜ Status dos conectores correto (Available).
4. ⬜ Comparar a tela atual com a captura de §2.2 — sem divergência.

### Passo 5 — Teste funcional de confirmação
1. ⬜ Iniciar uma recarga curta **pela Tupi** (2 a 3 minutos).
2. ⬜ Confirmar que a energia é registrada na Tupi.
3. ⬜ Encerrar a recarga.
4. ⬜ Confirmar que a sessão aparece corretamente no histórico da Tupi.

Sem o Passo 5, o rollback **não está confirmado** — apenas parece estar.

### Passo 6 — Encerramento do procedimento
1. ⬜ Desligar/parar o nosso servidor OCPP de teste (evita reconexão acidental).
2. ⬜ Registrar em `docs/operations/` o relato do teste: o que funcionou, o que
   falhou, mensagens capturadas, tempo de rollback real.
3. ⬜ Comunicar o estabelecimento que o serviço está normalizado.

---

## 4. Plano de contingência — se o rollback falhar

| Sintoma | Ação imediata |
| --- | --- |
| Não consigo acessar o menu técnico | Acionar suporte WEG. **Não** tentar reset de fábrica |
| URL restaurada mas não conecta à Tupi | Verificar sinal 4G; conferir a URL caractere a caractere contra a captura; acionar suporte Tupi |
| Equipamento travado / não responde | Acionar suporte WEG antes de qualquer reinício |
| Conector travado com cabo preso | Procedimento de destravamento manual do fabricante; **não** usar `UnlockConnector` por OCPP sem aprovação |
| Reset de fábrica aconteceu | Reconfigurar tudo a partir das capturas de §2.2 (é exatamente para isso que elas existem) |

**Nunca, em nenhuma hipótese, durante a FASE 4:**
- Atualização de firmware
- Reset de fábrica
- `ChangeConfiguration` em parâmetros elétricos (corrente, potência, limites)
- `UnlockConnector` sem alguém presente e sem sua aprovação
- Alteração de configuração de segurança elétrica

---

## 5. Antes de começar o teste — checagem final

Este bloco é a "trava" da FASE 4. Todos os itens marcados, sem exceção:

- ⬜ §2.1 preenchido com valores literais
- ⬜ §2.2 com todas as evidências capturadas e armazenadas
- ⬜ §2.3 com contatos confirmados e disponíveis
- ⬜ Janela acordada com o estabelecimento, fora de horário de pico
- ⬜ Pessoa fisicamente presente no local durante todo o teste
- ⬜ Nosso servidor de teste no ar, com TLS válido e testado com o simulador
- ⬜ Duração máxima da janela definida e acordada
- ⬜ Critério de abortar definido e combinado com todos
- ⬜ Este documento lido pela pessoa que estará no local
- ⬜ **Sua autorização explícita para iniciar a FASE 4**

---

## 6. Registro de execuções

| Data | Motivo | Executado por | Tempo de rollback | Resultado | Observações |
| --- | --- | --- | --- | --- | --- |
| | | | | | |
