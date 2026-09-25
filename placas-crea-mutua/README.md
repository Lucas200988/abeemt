# Placas CREA-MT e Mútua — FMEES 2026

Arquivo para imprimir: **`placas_crea_mutua_multicor.3mf`** · as quatro peças numa mesa ·
212 × 162 mm · **195 g** · 2 filamentos · **3 trocas de filamento**

| Slot | Filamento | Onde |
|---|---|---|
| 1 | **Preto** | corpo das duas placas e os dois pés |
| 2 | **Laranja** | toda a arte (logo, dizeres, régua, emblema) |

Quem preferir a arte em branco ou cinza troca só o filamento do slot 2 — o arquivo é o
mesmo.

| Peça | Medidas | Massa | Como imprime |
|---|---|---|---|
| `placa_crea` | 100 × 120 × 4 mm | 59,6 g | deitada, **arte para baixo** |
| `placa_mutua` | 100 × 120 × 4 mm | 59,5 g | deitada, **arte para baixo** |
| `pe_crea` | 100 × 30 × 11 mm | 38,1 g | em pé, rasgo para cima |
| `pe_mutua` | 100 × 30 × 11 mm | 38,1 g | em pé, rasgo para cima |

Massa de peça maciça. Os pés são um bloco: com 15 % de preenchimento cada um sai por volta
de 18 g. Nenhuma peça pede suporte.

## A arte imprime CONTRA O VIDRO

É o mesmo motivo das chapas coladas das maquetes. Numa superfície de topo, a fronteira
entre duas cores é uma costura entre perímetros, e o primeiro filete depois de cada troca
ainda vem sujo da cor anterior — foi o que estragou a chapa do SUNGROW. Com a placa virada,
a face da arte é a primeira camada, esmagada contra o vidro: a fronteira fica selada pela
mesa, o brilho é o do vidro e a sujeira do purgo, se houver, sobe para dentro da peça.

**Não ligar o passar a ferro (ironing).** Em superfície de duas cores o ferro arrasta o
escuro para dentro do claro.

No arquivo as placas já estão na posição certa. Se abrir o STL em vez do 3MF, a face da
arte é a que fica em z = 0 — não virar.

## Purga

Três trocas para o trabalho inteiro. A arte está toda entre 0 e 0,65 mm, que são as três
primeiras camadas (0,25 + 0,2 + 0,2); daí para cima é preto puro. Os pés entram na mesma
mesa de graça: são pretos do começo ao fim, e nas três camadas de arte usam a cor que já
está no bico.

Os outros dois arquivos são para imprimir uma parte só:

| Arquivo | O que tem | Trocas |
|---|---|---|
| `placas_crea_mutua_placas.3mf` | as duas placas | 3 |
| `placas_crea_mutua_pes.3mf` | os dois pés | 0 |

## Montagem

A placa entra no rasgo do pé por atrito: rasgo de 4,4 mm para uma placa de 4,0 mm, ou seja
0,2 mm de folga por lado. O rasgo é inclinado 10° para trás e fica a 9 mm da frente do pé —
com a placa encaixada, o centro de massa dela cai em y = 19,4 mm, dentro dos 30 mm do pé e
a 10,6 mm da borda de trás. Se quiser fixo, uma gota de cola no fundo do rasgo resolve; sem
cola, desmonta para transportar.

## Os logos

Vetorizados dos arquivos oficiais em `nl/crea.png` e `nl/mutua.png`, por limiar de
luminância: o que é escuro no original (o azul do brasão e do disco, o preto da palavra)
vira arte laranja; o que é claro (o cavaleiro do CREA, a figura da Mútua, os dentes da
engrenagem) vira vão e mostra o preto do corpo. Dá uma leitura de duas tintas fiel ao
desenho, que é o que dá para fazer com filamento — azul não temos.

A linha de apoio de cada logo ("Conselho Regional de Engenharia e Agronomia de Mato Grosso",
"Caixa de Assistência dos Profissionais do Crea") é redigitada, não traçada: no original ela
tem 2 px de altura de haste e sairia mais fina que um filete de 0,4 mm.

Medido no modelo final, o que é mais fino do que um filete de 0,42 mm (o mínimo que o
Arachne consegue depositar) é 0,5 % da área da arte do CREA e 0,2 % da Mútua — restos de
ponta de letra, nada que se perca de vista.

## Como é gerado

`placas_crea_mutua.py` desenha tudo e grava os três 3MF mais os STL. O traçado dos logos
fica em cache nos `.pkl` da pasta; apagar os `.pkl` refaz o traçado do zero.
