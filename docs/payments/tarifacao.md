# Tarifação (FASE 6)

Como o preço de uma recarga é decidido, e por que ele não muda depois.

---

## 1. As parcelas

```
valor = taxa de conexão
      + energia entregue (kWh) × preço por kWh
      + tempo CARREGANDO (min) × preço por minuto
      + tempo OCIOSO (min)     × taxa de ociosidade
```

Depois, nesta ordem:

1. **mínimo** — uma recarga de 30 segundos ainda ocupou o equipamento;
2. **teto comercial da tarifa**, se houver;
3. **teto financeiro** (o valor pré-autorizado), por último, porque é limite
   rígido: capturar acima é recusado pelo adquirente.

A ordem não é arbitrária. Se o mínimo fosse aplicado depois do teto, uma tarifa
com mínimo alto ultrapassaria o valor reservado e a captura falharia inteira.

### O tempo ocioso sai do tempo cobrado

O tempo em que o veículo fica plugado sem carregar **não** é somado por cima do
tempo total — ele é retirado da fatia cobrada como recarga. Cobrar os dois sobre
o mesmo período cobraria os mesmos minutos duas vezes.

Quando a tarifa não configura ociosidade (o padrão), nada muda: o tempo total é
cobrado como antes.

### Arredondamento

Sempre **para baixo**, em todas as parcelas. É decisão comercial — a favor do
motorista — e está escrita na tela de tarifas para que o operador saiba.

O único ponto do sistema autorizado a transformar fração em dinheiro é
`roundToCents`, e ele **exige** o modo de arredondamento explícito. Não existe
arredondamento implícito em lugar nenhum (ADR-0005).

---

## 2. Qual tarifa se aplica

Na ordem:

1. tarifa **do estabelecimento**, se houver uma ativa e dentro da validade;
2. tarifa **geral da organização**;
3. nenhuma → a recarga é calculada como **R$ 0,00**, e o painel mostra isso.

O terceiro caso é deliberado. Inventar um preço plausível quando ninguém
cadastrou tarifa seria um defeito silencioso: alguém seria cobrado por um valor
que nunca foi configurado. Com zero, o problema aparece na primeira recarga.

> **Detalhe que custou um teste:** o Postgres ordena `NULL` **primeiro** em
> `ORDER BY ... DESC`. Sem `NULLS LAST` explícito, a tarifa geral (com `siteId`
> nulo) vinha antes da específica e a precedência ficava invertida — o preço do
> estabelecimento nunca era aplicado.

### Ativa não é o mesmo que valendo

Uma tarifa com início no mês que vem aparece como **ativa** e não é aplicada a
nenhuma recarga hoje. O painel mostra as duas informações separadas, porque
confundi-las levaria o operador a achar que mudou o preço quando não mudou.

---

## 3. O passado não muda

Toda sessão guarda uma **cópia congelada** das condições da tarifa
(`tariffSnapshot`) no momento em que a recarga começou.

Alterar o preço hoje muda as recargas de amanhã. Nunca as de ontem.

Sem isso, corrigir um erro de digitação numa tarifa alteraria retroativamente o
valor de recargas já cobradas — inclusive as já capturadas no cartão, o que
tornaria a conciliação impossível de explicar.

Tarifa também **não se apaga**, só se desativa: o valor cobrado está congelado na
sessão, mas a origem dele precisa continuar existindo.

---

## 4. Validações no cadastro

| Regra                                       | Por quê                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| Máximo não pode ser menor que o mínimo      | Nenhuma recarga conseguiria atingir o mínimo; a tarifa é contraditória        |
| Fim da validade posterior ao início         | Janela invertida nunca se aplica a nada                                       |
| Nem tudo pode ser zero                      | Tarifa que não cobra nada é quase sempre erro de preenchimento — e sai de graça |
| Valores em centavos inteiros, com teto      | Barreira contra digitar reais onde se espera centavos                          |

A primeira já era verificada no cálculo, mas lá é tarde: a tarifa contraditória
já teria sido salva e só quebraria no fechamento de uma recarga real, com o
motorista esperando.

---

## 5. A ociosidade e seu limite conhecido

A ociosidade é medida pelos `MeterValues`: quando duas leituras consecutivas não
mostram energia nova, o intervalo entre elas conta como ocioso.

**A precisão é a do intervalo de medição do carregador.** Um equipamento que
reporta a cada 5 minutos produz ociosidade em blocos de 5 minutos. Não há como
ser mais fino do que o equipamento informa — o protocolo não oferece nada além
disso, e inventar precisão seria pior do que assumir a grossura (risco R-30).

Três cuidados que o teste obrigou a existir:

- Intervalo abaixo de um segundo **não avança o marcador**, senão o resto seria
  truncado a zero e perdido a cada leitura.
- O tempo ocioso é **limitado à duração da sessão**: relógio adiantado não pode
  cobrar tempo que não existiu.
- O acúmulo é `increment` no banco, não ler-somar-escrever em código: duas
  medições concorrentes não perdem cobrança.

**Recomendação até a FASE 4:** deixar a ociosidade em zero (o padrão) enquanto a
periodicidade real de `MeterValues` do WEMOB não for conhecida.

---

## 6. Simulador de preço

A tela de tarifas mostra quanto sai cada cenário típico com a tarifa escolhida.

Ele chama `calculateSessionAmount` — **a mesma função do fechamento real**. Se
usasse outra, a simulação poderia divergir do que é cobrado, que é exatamente o
defeito que ela existe para prevenir.
