# Conceitos para CREA-MT e Mútua — só para escolher

`conceitos-fmees-2026.png` mostra três peças. **Nenhum arquivo de impressão foi gerado.**
Depois que uma for escolhida, ela vira pasta própria, com as conferências de sempre
(balanço camada a camada, malha fechada, contagem de trocas de filamento) e aí sim 3MF e
STL.

Por que mudou de rumo: boneco humano convincente sai de escultura digital — um artista no
Blender ou um modelo pronto de marketplace. Código empilhando primitivas não chega lá, e o
resultado ficou ruim. O que código faz bem é geometria mecânica, e é disso que são os três.

| | Peça | Medidas | O que tem de bom | O que pesa contra |
|---|---|---|---|---|
| **A** | Engrenagem planetária | ⌀ 88 × 16 mm | **gira de verdade**, sai montada da impressora, numa peça só; dente involuto, não triangular | é peça de mexer, não de contemplar |
| **B** | Ponte treliçada | 200 × 64 × 52 mm | imponente na mesa, leitura imediata de engenharia; treliça Warren com tabuleiro e encontros | é a maior e a mais demorada de imprimir |
| **C** | Torre de transmissão | 92 × 92 × 172 mm | alta e elegante; fala direto do tema do evento (energia) | barras finas, a mais delicada de manusear |
| **E** | Letras 3D de mesa | 194 × 28 × 35 mm (CREA) e × 52 (Mútua) | a palavra do logo, em 3D, sobre rodapé; letra é geometria pura, é o que o código faz melhor; uma cor só, zero troca de filamento | não conta história nenhuma além do nome |
| **D** | Capacete de obra | 128 × 100 × 58 mm | casca lisa é o que a impressora faz melhor; o brasão vai na testa, como em capacete de verdade; uma cor só | é objeto de contemplar, não de usar |

Em todas, a marca vai numa chapa impressa deitada com a arte contra o vidro e colada — a
técnica que já funciona nas maquetes — e o evento fica gravado na base, discreto.

`conceito-letras.png` mostra a peça E e `conceito-capacete.png` a peça D, cada uma em seis
vistas.

## Letras 3D, em detalhe

A palavra do logo oficial, vetorizada, com 30 mm de altura de letra e 16 mm de espessura,
em pé sobre um rodapé de 5 × 28 mm que liga todas as letras. 194 mm de largura, 99 g (CREA)
e 134 g (Mútua) de material maciço — com o preenchimento de sempre, perto da metade disso.
"FMEES 2026" fica gravado na frente do rodapé, pequeno.

**Deitada é que imprime**, com a face da letra contra o vidro. Em pé, cada letra é uma
armadilha de balanço: o braço de cima do E sai 12 mm do tronco com nada embaixo, a barra do
T idem, a pança do R idem. Deitada não sobra um balanço sequer — medido camada a camada — e
a face boa ainda sai com o brilho do vidro. Depois é só levantar e apoiar no rodapé.

Três coisas que o desenho teve de resolver:

- **o hífen do CREA-MT e o acento do mútua não encostam em letra nenhuma no logo.** Soltos,
  sairiam como pecinhas avulsas. Cada um ganha uma ligadura de 2,4 mm no ponto de maior
  aproximação com a letra vizinha, que some no desenho — melhor que puxar um filete até o
  rodapé, que apareceria de frente;
- **o rodapé começa rente à face da letra**, e não centrado. Centrado, ele sobrava 6 mm na
  frente, e deitada para imprimir essa sobra virava degrau: as letras nasciam 6 mm no ar,
  3300 mm² sem nada embaixo;
- **uma cor só.** Duas sairiam caro: deitada, rodapé e letra convivem em todas as camadas de
  0 a 16 mm, e seria uma troca de filamento por camada.

## Capacete, em detalhe

Casca oca de 2,4 mm, 80 g de material maciço (com preenchimento, bem menos). Aba larga com
bico de 30 mm na frente e 3 mm atrás, casco de lados quase retos que fecha em cúpula, três
nervuras, as orelhas de encaixe dos abafadores e a testa achatada onde a chapa do brasão
cola. "FMEES 2026" fica gravado na aba de trás.

Imprime **deitado na aba**, sem suporte: a aba é plana e maciça, e o casco só fecha para
dentro conforme sobe. Três coisas tiveram de ser desenhadas para isso valer, e as três
vieram de medir camada a camada, não de achar:

- o oco tem de fechar em cúpula junto com o casco. Cortando a lista de contornos no alto,
  ele terminava num teto chato de 1700 mm² — um vão de 47 mm para o bico atravessar no ar;
- a barriga do corte da testa sobe a 45°, senão sobra um beiral de 5 mm virado para baixo;
- atrás da testa fica um bloco maciço: o corte tira 5 mm da frente do casco e a parede só
  tem 2,4 — sem o bloco, ele atravessava e abria um rasgo em meia-lua sob o brasão.

O que sobra no medidor é o fechamento do alto da cúpula e a testa acima do berço da chapa:
os dois são ponte, ancorada em volta, que o fatiador atravessa sem suporte.

`conceitos_fmees.py` monta A, B e C; `capacete.py` monta D. `ver_conceitos.py` e
`ver_capacete.py` desenham as folhas. Nenhum dos quatro grava 3MF ou STL, de propósito.
