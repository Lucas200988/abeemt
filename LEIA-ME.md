# FMEES 2026 — peças para imprimir

Quatro maquetes de mesa para os patrocinadores e dois brindes. Impressora Bambu Lab H2C,
bico de 0,4 mm, PLA.

## Antes de importar qualquer arquivo

**O projeto aberto no Bambu Studio precisa ter os filamentos já carregados** — três nas
maquetes, dois nos brindes. Com menos que isso o importador joga todas as peças no
filamento 1 sem avisar, e a peça abre de uma cor só. Foi o primeiro problema que tivemos.

**O filamento 1 não é o mesmo em todas as maquetes.** Confira na tabela abaixo antes de
mandar imprimir.

| Pasta | Filamento 1 | Filamento 2 | Filamento 3 |
|---|---|---|---|
| `miniatura-weg` | Cinza | Preto | Branco |
| `miniatura-dcco` | Verde | Preto | Branco |
| `miniatura-powerstack` | Branco | Grafite | Laranja |
| `miniatura-painel-ccr` | Branco | Grafite | Laranja |
| `brinde-geral` | cor do corpo | cor do relevo | — |

Cada 3MF já traz gravados dois ajustes, aplicados por cima do seu perfil: **primeira camada
de 0,25 mm** e **gerador de parede Arachne**. Todo o resto continua vindo do seu perfil.

## O que imprimir

| Pasta | Conjunto | Peças | Massa |
|---|---|---|---|
| `miniatura-weg` | contêiner WEG BESS 1:80 | 4 | 50 g |
| `miniatura-dcco` | gerador Cummins carenado 1:50 | 5 | 49 g |
| `miniatura-powerstack` | Sungrow PowerStack 1:25 | 4 | 81 g |
| `miniatura-painel-ccr` | painel elétrico CCR 1:20 | 4 | 68 g |
| `brinde-geral` | chaveiro bateria | 1 | 5,7 g |
| `brinde-geral` | organizador mini BESS | 1 | 75 g |

Cada conjunto assenta numa placa de 84 × 84 mm e cabe na cúpula de acrílico de
90 × 90 × 110 mm internos. A folga vertical mais apertada é a do painel CCR: 7 mm.

## Peças coladas

Três maquetes têm uma peça que **imprime deitada e vai colada**, e isso é de propósito:

- WEG: a chapa do logo, no costado
- DCCO: o crachá do logo, no painel fixo — e o escapamento, no teto
- PowerStack: a chapa da marca, acima da grade
- CCR: a porta inteira, na frente

O motivo é o mesmo nas quatro: relevo de segunda cor em parede vertical não imprime. Em
parede vertical, cada camada do desenho é uma ilha solta que a máquina deposita logo depois
de uma troca de filamento — foram cem camadas assim que estragaram o símbolo da CCR e o logo
da WEG nas primeiras impressões. Deitada, a mesma arte vira mancha plana sobre superfície
horizontal e a troca de cor acontece em três a cinco camadas no total.

## Torre de purga

Cada pasta tem, além do arquivo de uma mesa só (`_multicor`), **duas mesas separadas** que
agrupam as peças por qual cor está embaixo. O que gera troca de filamento não é a peça ter
duas cores, é dois objetos pedirem cores diferentes na mesma altura: aí o fatiador troca
dentro de cada camada, dezenas de vezes seguidas.

| Maquete | Uma mesa | Duas mesas |
|---|---|---|
| WEG | 22 trocas | **3** |
| DCCO | 50 | **20** |
| Painel CCR | 32 | **22** |
| PowerStack | 23 | 23 (a divisão não ajuda; ver o README da pasta) |

## Arquivos de cada pasta

- `*_multicor.3mf` — tudo numa mesa, um trabalho só
- `*_mesa1_*.3mf` e `*_mesa2_*.3mf` — divididos, menos purga
- `*.stl` — as mesmas peças soltas, em uma cor, para imprimir avulso ou abrir noutro programa
- `README.md` — filamentos, massas, orientação, montagem e ajustes
- `*.py` — o programa que gera tudo; rodar de novo regrava os arquivos
