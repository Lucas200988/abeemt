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

Em todas, a marca vai numa chapa impressa deitada com a arte contra o vidro e colada — a
técnica que já funciona nas maquetes — e o evento fica gravado na base, discreto.

`conceitos_fmees.py` monta os três e `ver_conceitos.py` desenha a folha. Este arquivo não
grava 3MF nem STL de propósito.
