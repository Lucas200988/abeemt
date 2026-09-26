# Letras 3D de mesa — CREA-MT e Mútua

Arquivo para imprimir: **`letras_duas.3mf`** (as duas peças numa mesa) · 194 × 98 × 28 mm ·
**1 filamento, nenhuma troca**

| Slot | Filamento |
|---|---|
| 1 | **Branco** |

| Peça | Em pé (na mesa) | Massa | Arquivo sozinha |
|---|---|---|---|
| `letras_crea` | 194 × 28 × 35 mm | 99 g | `letras_crea.3mf` |
| `letras_mutua` | 194 × 28 × 52 mm | 134 g | `letras_mutua.3mf` |

Massa de peça maciça; com o preenchimento de sempre fica perto da metade. Letra de 30 mm de
altura com 16 mm de espessura, sobre rodapé de 5 × 28 mm. "FMEES 2026" gravado na frente do
rodapé, pequeno — mesma cor, lido por sombra.

## Imprime DEITADA, face da letra contra o vidro

**Os arquivos já saem deitados; não virar.** Em pé, cada letra é uma armadilha de balanço: o
braço de cima do E sai 12 mm do tronco com nada embaixo, a barra do T idem, a pança do R
idem. Deitada não sobra balanço nenhum — medido camada a camada, o maior avanço além do
apoio é 0,55 mm, que é a borda do gravado — e a face que fica virada para quem olha sai com
o brilho do vidro.

Depois de impressa, é só levantar a peça e apoiar no rodapé.

Sem suporte, sem aba, sem torre de purga.

## Três coisas que não são óbvias olhando a peça

1. **O hífen do CREA-MT e o acento do mútua não encostam em letra nenhuma no logo.** Soltos,
   sairiam da impressora como pecinhas avulsas. Cada um tem uma **ligadura de 2,4 mm** no
   ponto de maior aproximação com a letra vizinha. Dá para ver de perto; some no desenho. A
   alternativa seria um filete descendo até o rodapé, que apareceria de frente.
2. **O rodapé começa rente à face da letra** e cresce só para trás. Centrado na espessura,
   ele sobrava 6 mm na frente, e deitada essa sobra virava degrau: as letras nasciam 6 mm no
   ar, 3300 mm² sem nada embaixo.
3. **As letras afundam 0,3 mm no rodapé.** Só encostando nele, a peça sai como dois corpos
   soltos, que o fatiador trata como objetos diferentes.

## Trocar a cor

O arquivo não muda: é um filamento só. Branco é o que está combinado; preto, cinza ou
laranja saem do mesmo arquivo, trocando o filamento na impressora.

## Ver em 3D antes de imprimir

`visualizador-letras.html` abre no navegador e mostra as duas peças em 3D: arrasta para
girar, rola para aproximar, troca entre a posição de mesa e a de impressão. As malhas são as
mesmas do 3MF — não é um desenho à parte que possa ficar desatualizado.

`gera_visualizador.py` refaz a página a partir do gerador; rodar depois de mexer na peça
mantém a visualização em dia.

## Como é gerado

`letras_crea_mutua.py` vetoriza a palavra dos arquivos oficiais em `nl/`, monta a peça e
grava os três 3MF mais os STL. O traçado fica em cache nos `.pkl` da pasta; apagá-los refaz
o traçado do zero.
