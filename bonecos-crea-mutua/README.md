# Bonecos de engenharia — CREA-MT e Mútua

Arquivo para imprimir: **`bonecos_bonecos.3mf`** (os dois bonecos) mais
**`bonecos_placas_obra.3mf`** (as duas placas de obra, que vão coladas).

Uma peça para cada patrocinador: boneco de capacete em pé sobre uma base, com uma placa de
obra ao lado trazendo a marca. O CREA-MT leva o engenheiro, com o tubo de projeto ao lado;
a Mútua leva a engenheira, com a prancheta — o emblema dela já é um perfil feminino de elmo,
e a peça conversa com isso.

| Slot | Filamento | Onde |
|---|---|---|
| 1 | **Preto** | base, sapatos e o pé dos postes |
| 2 | **Cinza** | pernas, tronco, braços, cabeça, postes, adereço |
| 3 | **Laranja** | capacete, e a arte da placa de obra |

| Peça | Medidas | Massa | Como imprime |
|---|---|---|---|
| `boneco_crea` | 88 × 46 × 90 mm | 61 g | em pé, sem suporte |
| `boneco_mutua` | 88 × 46 × 90 mm | 60 g | em pé, sem suporte |
| `placa_crea` | 48 × 30 × 2,4 mm | 4,3 g | deitada, **arte para baixo** |
| `placa_mutua` | 48 × 30 × 2,4 mm | 4,3 g | deitada, **arte para baixo** |

Massa de peça maciça; com 15 % de preenchimento cada boneco sai por volta de 25 g.

## Duas mesas, e por quê

| Arquivo | O que tem | Trocas |
|---|---|---|
| `bonecos_bonecos.3mf` | os dois bonecos | **2** |
| `bonecos_placas_obra.3mf` | as duas placas de obra | **3** |
| `bonecos_multicor.3mf` | tudo numa mesa só | 5 |

A cor do boneco é função só da altura: preto de 0 a 11,5 mm, cinza de 11,5 a 75,1 e laranja
daí para cima. São duas trocas sequenciais para os dois bonecos juntos — o fatiador faz
todas as camadas de uma faixa antes de passar para a próxima. Qualquer peça que cruze uma
fronteira é cortada nela; é por isso que o pé dos postes sai preto, e não cinza: pintá-los
de cinza lá embaixo custaria uma troca por camada durante 35 camadas.

As fronteiras caem exatamente em linha de camada — 11,45 e 75,05 são 0,25 + 0,2k, com os
ajustes que o próprio arquivo grava. Medido no arquivo: **nenhuma camada tem duas cores**, as
duas trocas são sequenciais e a linha de troca sai reta. As faixas se encostam num plano
horizontal sem se penetrar, e isso aqui é o certo: a regra de interpenetrar 0,05 mm vale para
cores que se tocam numa parede vertical, onde pode abrir fresta.

As placas de obra vão em outra mesa porque o laranja delas mora nas três primeiras camadas,
altura em que o boneco é preto. Juntas, as duas cores conviveriam camada a camada lá
embaixo, e a torre de purga engordaria.

## A arte da placa imprime CONTRA O VIDRO

Mesma decisão das chapas das maquetes. Relevo de segunda cor em parede vertical não imprime
— foi o que estragou o símbolo da CCR e o logo da WEG. E mesmo deitada, arte na face de cima
pega a sujeira do purgo na costura entre as cores, como aconteceu na chapa do SUNGROW. Com a
placa virada, a face da arte é a primeira camada, esmagada contra o vidro.

**Não ligar o passar a ferro (ironing)** nesse trabalho.

No arquivo a placa já está na posição certa. Se abrir o STL, a face da arte é a que fica em
z = 0.

## Montagem

A placa de obra cola na frente dos dois postes; cada poste tem um consolo em 8,8 mm em que
ela senta, para não escorregar enquanto a cola pega. Fora isso, nada para montar.

## Nada pede suporte

Conferido camada a camada, medindo quanto o material avança além do apoio de baixo:

- a **aba do capacete** brota da testa 4 mm abaixo da linha do capacete e abre a 45°
- o **queixo** nasce com a largura do pescoço e abre 44° — não pousa em cima dele
- os **braços** prendem em cima e embaixo, arqueados no meio: o vão é um furo com ponte de
  2 mm no alto, não um braço pendurado com a mão começando no ar
- o **tubo de projeto** e a **prancheta** se apoiam na base; a mão só encosta
- o **cabelo** da engenheira é uma gota que começa dentro do tronco e engrossa subindo
- o **consolo** dos postes é uma cunha a 45°, não uma prateleira

O único ponto que o medidor ainda acusa é a virilha, em 41 mm: um vão de 1,4 a 4 mm entre as
duas coxas. É ponte, ancorada dos dois lados — o fatiador atravessa sem suporte.

## Colete, cinto e dedicatória

São **sulcos na própria cor**, lidos por sombra, e não faixas de segunda cor: faixa colorida
numa parede vertical custaria uma troca de filamento por camada, dezenas seguidas. A
dedicatória "HOMENAGEM ABEE-MT" está gravada 0,8 mm na frente da base, discreta.

## Como é gerado

`bonecos_engenharia.py` desenha tudo e grava os três 3MF mais os STL. O corpo sai de cascos
convexos sobre contornos empilhados — tornozelo, joelho, quadril, cintura, ombro —, que é o
jeito de ter volume cheio sem superfície pendurada. O traçado dos logos fica em cache nos
`.pkl` da pasta.

Para mexer na peça, quase tudo são números no alto do arquivo: altura de cada junta, largura
de ombro, cintura e quadril, tamanho da base e da placa.
