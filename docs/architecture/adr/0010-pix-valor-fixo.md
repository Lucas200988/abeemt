# ADR-0010 — Pix com valor fixo, sem devolução automática

- **Status:** Aceito, com uma exceção obrigatória (§4)
- **Data:** 2026-07-29
- **Fase:** 0 (implementação nas fases 5, 6 e 7)
- **Origem:** decisão do cliente em 2026-07-29, resolvendo a pergunta 17 e a premissa P8
- **Relacionado:** completa a seção §7 do [ADR-0008](0008-pre-autorizacao-e-captura.md)

## Contexto

O [ADR-0008](0008-pre-autorizacao-e-captura.md) definiu pré-autorização + captura
pelo consumo real como modelo padrão. Ficou aberto o caso do **Pix, que não tem
pré-autorização** — é pagamento imediato e final.

Três opções foram apresentadas. Você escolheu a **(c): valor fixo, sem
devolução**, observando corretamente que devolução de Pix é tecnicamente
possível hoje.

**A observação procede.** A API Pix do BACEN prevê devolução via
`PUT /pix/{e2eid}/devolucao/{id}`, aceita **valor parcial**, e a janela usual é
de até 90 dias. Praticamente todo PSP com API Pix implementa isso. Portanto a
escolha por (c) **não é uma limitação técnica — é uma decisão de escopo do MVP**,
e é assim que fica registrada.

> Nota de terminologia, porque afeta o que vamos exigir do PSP na FASE 7:
> "**Pix Troco**" é uma modalidade específica do BACEN (compra + saque de dinheiro
> em espécie no estabelecimento), diferente de **devolução**. O que precisamos é
> devolução parcial. Vale pedir o nome certo na hora de avaliar fornecedores.

## Decisão

**Pix funciona como crédito pré-pago de valor fixo.** O motorista escolhe um
valor, paga, e recebe energia até esgotá-lo. Não há devolução automática de saldo
não consumido.

```
Motorista escolhe R$ 30  →  QR Pix  →  pago  →  recarga inicia
   →  sistema entrega energia até atingir R$ 30
   →  parada automática
   →  sessão encerrada, nada a devolver
```

### Duas experiências diferentes, e tudo bem

| | Cartão de crédito | Pix |
| --- | --- | --- |
| Momento da cobrança | Depois (captura) | Antes |
| Valor cobrado | O que consumiu | O que escolheu |
| Teto da sessão | Valor pré-autorizado | Valor pago |
| Sobra não consumida | Não existe | Fica com o estabelecimento |
| Falha antes de iniciar | `void` — nada cobrado | **Devolução obrigatória** (§4) |

A interface precisa deixar essa diferença explícita **antes** do pagamento, não
depois. Não é letra miúda: é a informação que evita a reclamação.

## 3. Parada automática no valor pago (obrigatória)

A regra de parada automática já existe para cartão (ADR-0008 §4, risco R-22).
Para Pix ela é **reaproveitada com o mesmo código**, mudando apenas o limiar — e
isso é o que torna esta decisão barata de implementar.

**O limiar é diferente, e o motivo é que o incentivo se inverte:**

| | Cartão | Pix |
| --- | --- | --- |
| Se **ultrapassar** o teto | Prejuízo nosso — não é cobrável | Sem prejuízo — já recebemos |
| Se **parar antes** do teto | Sem prejuízo — capturamos menos | Prejuízo do motorista — pagou e não recebeu |
| Limiar adotado | **95%** (margem de segurança para baixo) | **~100%**, aceitando pequeno excedente |

No Pix, entregar 2% a mais de energia é um custo marginal nosso; entregar 5% a
menos é ficar com dinheiro do motorista. O limiar do Pix deve mirar 100% e a
sobra, quando houver, joga a favor de quem pagou.

Sem essa parada automática, a decisão (c) seria indefensável: o motorista pagaria
R$ 30 e a recarga continuaria consumindo até o carro encher, ou pararia num
ponto arbitrário. Com ela, no caminho feliz **não existe saldo não consumido** —
o valor é convertido integralmente em energia.

## 4. Exceção obrigatória: consumo zero exige devolução

Esta é a única parte desta ADR que **não é negociável no MVP**.

Se o Pix foi pago e a recarga **nunca entregou energia** — carregador offline,
comando recusado, timeout, veículo não conectado, falha do equipamento — houve
pagamento sem qualquer contraprestação. Ficar com esse dinheiro não é
simplificação de MVP; é cobrar por serviço não prestado.

No cartão isso é resolvido sozinho pelo `void`. No Pix, exige ação.

| Situação | Ação |
| --- | --- |
| Pago, energia = 0 Wh | **Devolução integral**, disparada pelo sistema |
| Pago, sessão iniciou e parou cedo por falha nossa ou do equipamento | Devolução do não consumido, **decidida pelo operador** |
| Pago, motorista desconectou o carro por vontade própria | Sem devolução — regra desta ADR |
| Pago, bateria encheu antes de esgotar o crédito | Sem devolução automática; operador pode devolver a critério comercial |

Consequências de implementação:

1. A porta `PaymentProvider` precisa de `refundPayment` **funcionando de verdade
   para Pix** — não como método declarado e não implementado.
2. "Suporta devolução parcial via API" vira **requisito** do PSP de Pix na matriz
   da FASE 7, não um diferencial desejável.
3. O painel precisa de uma ação de devolução com registro em `AuditLog`: quem
   devolveu, quanto, por quê.
4. A devolução por consumo zero é automática; as demais são manuais e auditadas.

Ou seja: economizamos a devolução automática do caso comum, mas **a capacidade
técnica de devolver continua sendo obrigatória**. A simplificação é de fluxo, não
de infraestrutura.

## 5. Exposição comercial e de consumidor

Registro honesto do que estamos aceitando: reter valor pago e não consumido pode
ser questionado sob o CDC como cobrança por serviço não prestado, mesmo com aviso
prévio na tela.

O que reduz essa exposição:

- A parada automática (§3) faz o caso comum ter **saldo zero** — não há o que reter.
- A devolução por consumo zero (§4) elimina o caso mais grave.
- Aviso explícito antes do pagamento, e comprovante final mostrando valor pago,
  energia entregue e saldo.
- Valores oferecidos em faixas modestas (R$ 20 / R$ 30 / R$ 50), não valores
  altos que aumentem a sobra típica.

O caso residual — motorista desconecta antes de esgotar o crédito — é pequeno em
valor e defensável, desde que informado antes. É esse caso, e só ele, que a
decisão (c) de fato simplifica.

## Alternativas consideradas

| Alternativa | Por que não |
| --- | --- |
| **(a)** Devolução parcial automática | Tecnicamente viável e coerente com a promessa do produto. Recusada por custo de escopo no MVP: fluxo financeiro paralelo, conciliação e comunicação de um valor que chega dias depois. Continua sendo o caminho natural pós-piloto |
| **(b)** Pix fora do MVP | Excluiria boa parte do público que o produto existe para atender — motorista sem cadastro pagando na hora |
| (c) sem parada automática | Descartado: transformaria o crédito num valor arbitrário e a decisão em algo indefensável |

## Consequências

**Positivas**
- Pix entra no MVP sem construir fluxo de devolução automática.
- Reaproveita integralmente a máquina de parada automática do cartão — o custo
  incremental é o limiar diferente, pouco mais que isso.
- No caminho feliz, o motorista recebe exatamente a energia que pagou.

**Negativas**
- Duas experiências de cobrança diferentes no mesmo produto, que precisam ser
  explicadas na interface.
- Exposição residual de consumidor no caso de desconexão antecipada.
- A migração futura para (a) implica mudar a UX depois de o público já ter
  aprendido o modelo — trocar regra de cobrança depois custa mais do que parece.

**Neutras**
- `refundPayment` continua obrigatório na porta de pagamento; muda apenas quem o
  aciona (sistema no consumo zero, operador nos demais casos).
