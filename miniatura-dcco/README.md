# Miniatura DCCO — grupo gerador Cummins carenado, 1:50

Arquivo para imprimir: **`miniatura_dcco_multicor.3mf`**

Projeto com **3 filamentos** carregados antes de importar.

| Slot | Filamento | Onde aparece |
|---|---|---|
| 1 | **Verde** | carenagem, teto, corpo do crachá |
| 2 | **Preto** | chassi, escapamento, placa de base |
| 3 | **Branco** | **logo da DCCO**, letras e emblema da placa |

> O logo saiu do preto e foi para o **branco**, como na máquina real: branco sobre o verde.

## Peças

| Peça | Medidas | Massa | Como imprime |
|---|---|---|---|
| corpo | 72,4 × 26,0 × 34,2 mm | 15,7 g | apoiado no chassi, sem suporte |
| teto | 72,4 × 25,0 × 6,0 mm | 6,5 g | de cabeça para baixo |
| crachá do logo | 20 × 10 × 1,5 mm | 0,4 g | **deitado**, logo para cima |
| escapamento | 5,1 × 5,1 × 7,7 mm | 0,08 g | **em pé**, apoiado no disco |
| placa de base | 84 × 84 × 4,4 mm | 26,0 g | deitada |

Total: **48,5 g**. Cabe na cúpula de 90 × 90 × 110 mm.

## Montagem

1. O **crachá** vai **colado** no rebaixo do painel fixo, entre as duas portas. Fica
   0,8 mm saliente, como um emblema aplicado de verdade; o rebaixo serve de gabarito.
2. O **escapamento** vai **colado** no rebaixo redondo do teto — o mesmo que já existia
   como saída de escape. O disco de 5,1 mm entra no rebaixo de 0,7 mm de profundidade e
   se apoia num anel de 15 mm² de cola.
3. O teto encaixa por aba.
4. O gerador assenta no rebaixo da placa.

A chaminé sai com a boca cortada a 45° em vez do cotovelo curvo da foto. O cotovelo termina
apontando para o lado, e a última parte dele seria balanço horizontal sem nada embaixo — 45°
é o limite que o bico forma sozinho. Em 1:50 lê como escapamento do mesmo jeito. Verificado:
nenhuma face em balanço acima da mesa, 20 mm² de primeira camada.

A linha entre chassi preto e carenagem verde é uma faixa horizontal: **uma troca de cor
só**, na camada 30. As maçanetas saem em verde de propósito — barra preta de 1,2 mm em
parede vertical seria a mesma ilha solta que estragou o logo do contêiner da WEG.

## STL avulsos

`miniatura_dcco_corpo.stl`, `miniatura_dcco_teto.stl`, `miniatura_dcco_cracha.stl`,
`miniatura_dcco_placa.stl`.

Gerado por `gerador_dcco_miniatura.py`.

## Torre de purga: duas mesas em vez de uma

Cada troca de filamento joga fora material na torre de purga. O que gera troca não é a peça
ter duas cores — é **dois objetos pedirem cores diferentes na mesma altura**: aí o fatiador
troca dentro de cada camada, dezenas de vezes seguidas. Agrupando na mesma mesa as peças que
começam com a mesma cor, a troca vira uma por peça, sequencial em Z.

| Arquivo | Trocas de filamento |
|---|---|
| `miniatura_dcco_multicor.3mf` (tudo numa mesa) | 50 |
| `miniatura_dcco_mesa1_base_preta.3mf` + `miniatura_dcco_mesa2_base_verde.3mf` | **20** |

As 20 que sobram vêm do escapamento preto, que continua subindo enquanto a carenagem
já virou verde. Se quiser zerar isso, imprima o escapamento junto com a placa numa
terceira mesa — ou peça que eu o deixe verde.

Quatro ajustes no Studio ajudam tanto quanto a divisão, e valem para qualquer um dos arquivos:

1. **Agrupamento de filamentos em "Automático (descarga)"** na H2C. Forçar tudo num bico só
   resolve erro de mapeamento mas desliga a otimização de purga dos dois bicos.
2. **Descarregar no preenchimento do objeto** — manda o descarte para dentro das peças. A
   placa de base tem 84 × 84 × 3 mm de reservatório bem ali na mesa.
3. **Volumes de descarga**: o cálculo automático é conservador; os pares entre cores escuras
   aceitam bem menos que o padrão.
4. **Largura da torre**: as trocas todas acontecem nos primeiros milímetros, então a torre é
   baixa e pode ser estreita.

## Ajustes já gravados no arquivo

Os 3MF trazem dois ajustes dentro deles, aplicados por cima do seu perfil ao importar:

- **altura da primeira camada: 0,25 mm**
- **gerador de parede: Arachne**

Todo o resto continua vindo do seu perfil. Se algum arquivo reclamar ao abrir, apague
`Metadata/project_settings.config` de dentro do zip — ou me avise, que eu regravo sem ele;
os dois ajustes também podem ser postos uma vez no perfil e salvos como preset.

### Imprimir por objeto

A ordem que você viu em outros projetos (imprime uma peça inteira, depois a outra) é
**Sequência de impressão → Por objeto**. Ela zera a troca de filamento entre peças, e é o
melhor remédio para a torre de purga. Não deixei ligada no arquivo porque ela exige que as
peças fiquem afastadas o bastante para o bico passar por cima das já prontas — com o
espaçamento destas mesas o Studio recusaria fatiar. Para usá-la: ligue a opção e deixe o
Studio rearranjar a mesa; se ele avisar de colisão, é porque as peças não cabem afastadas o
suficiente, e aí a divisão em duas mesas acima faz o mesmo trabalho.
