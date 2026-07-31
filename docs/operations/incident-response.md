# Resposta a incidentes — os roteiros

Escritos para quem está com um motorista esperando na frente do carregador:
passos numerados, sem teoria. Cada alerta do painel aponta para um roteiro
daqui pelo nome.

Regra geral, antes de qualquer roteiro: **anote a hora e tire print do
painel.** Toda investigação depois começa por "quando".

---

## carregador-offline

**Alerta:** `CARREGADOR_OFFLINE` · o carregador caiu e nenhuma recarga nova sai.

1. Havia recarga em andamento? Se sim, o roteiro é [sessao-sem-medicao](#sessao-sem-medicao) — vá para lá primeiro.
2. O carregador tem energia? (Disjuntor, tela acesa.)
3. A internet do carregador está de pé? (4G: sinal; Ethernet: cabo e switch.)
4. Espere 5 minutos: o equipamento reconecta sozinho quando a rede volta.
5. Se não voltar: reinicie o carregador pelo procedimento do fabricante.
6. Se ainda não voltar: o problema pode ser do NOSSO lado — confira se a API
   está no ar (`/api/health`) e olhe o log dela por erros de conexão OCPP.
7. Registre o episódio (hora da queda, hora da volta, causa se souber).

**Enquanto isso:** o painel continua funcionando; sessões antigas e cobranças
não são afetadas. Só recarga nova é impossível.

---

## sessao-sem-medicao

**Alerta:** `SESSAO_SEM_MEDICAO` · dizemos ao motorista que está carregando e
não temos medição para provar. **É o incidente mais sério do sistema.**

1. Vá até o carregador (ou peça a alguém no local): **o carro está carregando
   de verdade?** (LED do carregador, painel do carro.)
2. **Se está carregando:** o problema é só de comunicação. Siga
   [carregador-offline](#carregador-offline) para religar. Quando a conexão
   voltar, a medição acumulada chega e a cobrança sai correta — o medidor do
   equipamento não zera com a queda (provado no teste de caos).
3. **Se NÃO está carregando:** encerre a sessão pelo painel (detalhe da sessão
   → Encerrar). O sistema cobra só o que foi medido até a queda — o teto
   protege o resto.
4. **Na dúvida entre 2 e 3:** espere até 30 minutos pela reconexão. Depois
   disso, encerre pelo painel. Cobrar de menos é aborrecimento nosso; cobrar
   sem prova é briga com o motorista.

---

## sessao-presa

**Alerta:** `SESSAO_LONGA_DEMAIS` · sessão ativa há mais de 12 horas.

1. Confira no local: tem carro conectado mesmo?
2. Se é uma recarga real e longa (possível em AC lento): apenas registre — o
   alerta é um pedido de olhar, não uma ordem de encerrar.
3. Se não tem carro, ou o estado no painel não bate com a realidade: encerre
   pelo painel. A cobrança sai pelo que foi medido.

---

## cobranca-pendente

**Alerta:** `COBRANCA_PENDENTE` · energia entregue e ainda não cobrada (risco R-23).

1. **Não faça nada nos primeiros 30 minutos.** O sistema retenta sozinho, com
   espaçamento crescente — na maioria dos casos o adquirente estava fora do ar
   e a cobrança sai quando ele volta (provado no teste de caos).
2. Persistiu por mais de 30 minutos: olhe o log da API pela mensagem
   `falha ao fechar a sessão` — ela diz o motivo real.
3. Se o motivo é o adquirente (erro 5xx, timeout): aguarde. A reserva no
   cartão segura o valor; o prazo dela é o limite real (ver
   [pre-autorizacao-expirando](#pre-autorizacao-expirando)).
4. Se o motivo é recusa definitiva do adquirente: caso para gente — abra o
   detalhe do pagamento no painel e acione o suporte da Rede com o `tid`.

---

## pre-autorizacao-expirando

**Alertas:** `PRE_AUTORIZACAO_EXPIRANDO` / `PRE_AUTORIZACAO_EXPIRADA` · a
reserva no cartão vai vencer (ou venceu) sem captura.

1. Expirando: descubra POR QUE não capturou ainda — quase sempre é uma
   [cobranca-pendente](#cobranca-pendente) antiga. Resolva a causa e a captura
   sai no próximo ciclo.
2. Expirada: a cobrança automática já não é possível. Registre o valor, a
   sessão e o motivo. A decisão de cobrar por outra via (ou absorver) é
   comercial, não técnica — fica com o administrador.
3. Em ambos os casos: anote o episódio. Se repetir, o prazo de captura do
   nosso ramo na Rede precisa ser renegociado.

---

## maquininha-muda

**Alerta:** `MAQUININHA_MUDA` · o terminal pareado parou de dar sinal de vida.

1. Olhe (ou peça para olharem) o poste: **a maquininha está lá?**
2. **Está lá:** energia e rede — reinicie o equipamento. Voltando o sinal, o
   alerta some sozinho.
3. **NÃO está lá (furto/remoção):** no painel → Maquininhas → **Revogar**.
   O acesso morre na hora; o equipamento vira um peso de papel (risco R-32).
   Depois registre o boletim de ocorrência com o número de série.
4. Para instalar a substituta: cadastrar → código de pareamento → parear.

---

## conector-com-falha

**Alerta:** `CONECTOR_COM_FALHA` · o conector reporta erro (código OCPP no alerta).

1. Olhe o código no alerta e a tela do equipamento.
2. Falhas transitórias (sobretemperatura, GroundFailure após chuva) costumam
   sair sozinhas — aguarde e acompanhe.
3. Persistindo: bloqueie o carregador pelo painel (ninguém paga por conector
   quebrado) e acione a assistência do fabricante com o código.

---

## banco-caiu

**Sintoma:** painel com "não foi possível conectar"; API fora; carregador até
conecta mas nada é registrado.

1. O PostgreSQL está de pé? (`docker compose ps` ou serviço do sistema.)
2. Suba-o de volta. A API reconecta sozinha; o carregador reenvia o que o
   OCPP garante reenviar (StartTransaction/StopTransaction têm confirmação).
3. Depois da volta, confira a Visão Geral: os alertas apontam o que ficou
   pendente — cobranças atrasadas saem sozinhas pelo worker.
4. Se o banco não sobe por corrupção/disco: [restaurar-backup](backup-restore.md).

---

## restaurar-backup

Roteiro completo, com o ensaio obrigatório, em
[backup-restore.md](backup-restore.md). Não improvise restauração de cabeça.
