# ADR-0012 — Ordem da reserva e o que fazer com consumo zero

- **Situação:** aceito
- **Data:** 2026-07-30
- **Fase:** 5 (simulação de pagamento)
- **Relacionado:** [ADR-0008](0008-pre-autorizacao-e-captura.md), [ADR-0010](0010-pix-valor-fixo.md)

## Contexto

Duas perguntas apareceram só quando o fluxo financeiro foi construído de ponta a
ponta, e nenhuma delas dá para responder no papel:

1. **Em que ordem reservar?** O conector é um recurso físico único: só um veículo
   carrega por vez. O cartão é outro recurso. Se as duas reservas acontecerem na
   ordem errada, dois motoristas pagam pela mesma tomada.
2. **Quanto cobrar de quem não recebeu nada?** A tarifa tem taxa de conexão. Uma
   recarga que entregou 0 Wh ainda assim produz um valor a cobrar.

## Decisão

### 1. O conector é reservado antes do cartão

A sessão é criada em `AWAITING_PAYMENT` **antes** de qualquer contato com o
adquirente, e esse estado passou a fazer parte do índice parcial
`charging_sessions_one_active_per_connector`.

Consequência: a segunda tentativa simultânea no mesmo conector falha na criação
da linha, com `CONNECTOR_BUSY`, sem que o cartão do segundo motorista seja
tocado.

Isto foi um **defeito corrigido**, não um projeto acertado de primeira. O código
da FASE 5 já dizia, em comentário, que a criação da sessão protegia contra a
disputa — mas `AWAITING_PAYMENT` não estava na lista do índice, então a sessão
era criada normalmente e a regra só era aplicada na promoção para
`PAYMENT_APPROVED`, isto é, **depois** da autorização no cartão. O teste
`o segundo pagamento no mesmo conector é recusado ANTES de tocar no cartão`
expôs a diferença entre o comentário e o comportamento.

Migration: `20260730080000_awaiting_payment_ocupa_conector`.

**Contrapartida assumida:** um pagamento interrompido no meio (processo
derrubado entre criar a sessão e receber a resposta do adquirente) bloqueia o
conector. Coberto por `SessionWorker.expirarSemPagamento`, que libera a sessão
depois do prazo da regra 11.5.

### 2. Recarga sem energia entregue não é cobrada

Quando `energyWh = 0` **e** a tarifa não cobra por tempo, o valor final é zero —
mesmo que a tarifa preveja taxa de conexão. No cartão, a reserva é cancelada
(`void`); no Pix, o valor é devolvido integralmente ([ADR-0010](0010-pix-valor-fixo.md) §4).

A ressalva do tempo importa: numa tarifa por minuto, o veículo ocupou o ponto e
impediu outro motorista de usar. Aí há o que cobrar mesmo sem energia entregue, e
a cobrança acontece normalmente.

A regra mora em `PaymentsService.semEntregaNaoCobra`, e não em `@bora/pricing`. O
pacote de cálculo continua respondendo "quanto esta tarifa cobra por isto?" — a
resposta correta inclui a taxa de conexão. A decisão de **não cobrar** é
comercial e fica na camada que decide, não na que calcula.

## Alternativas consideradas

| Alternativa                                                     | Por que não                                                                                                                              |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Verificar "conector ocupado" na aplicação antes de autorizar     | Duas requisições simultâneas passam as duas pela verificação. Só o índice único do banco resolve                                          |
| Autorizar primeiro e criar a sessão depois                       | Inverte exatamente o problema: o segundo motorista teria o valor reservado antes de descobrir que o ponto está ocupado                    |
| Cobrar a taxa de conexão mesmo com zero energia                  | R$ 3,00 de quem plugou, esperou e não recebeu nada é a reclamação mais previsível do produto; atendê-la custa mais do que o próprio valor |
| Zerar a cobrança em `@bora/pricing`                              | Misturaria política comercial com cálculo de tarifa e tornaria o pacote impossível de reaproveitar para simulação de preços               |

## Consequências

**Positivas**

- A disputa pelo conector é resolvida pelo banco, no ponto certo do fluxo.
- Ninguém é cobrado por energia que não recebeu.

**Negativas**

- Mais um caminho de expiração no worker (`expirarSemPagamento`), com o custo de
  manutenção correspondente.
- A lista de estados ativos agora aparece em quatro lugares (migration,
  `@bora/database`, `@bora/contracts`, `SessionsService`). Divergir entre eles
  quebra a regra 11.1 em silêncio — os comentários em cada um apontam para os
  outros, e o teste `constraints.spec.ts` verifica todos os estados da lista.
