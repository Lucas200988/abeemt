# Miniatura Sungrow PowerStack ST255CS-2H, 1:25

Arquivo para imprimir: **`miniatura_powerstack_multicor.3mf`**

Projeto com **3 filamentos** carregados antes de importar.

| Slot | Filamento | Onde aparece |
|---|---|---|
| 1 | **Branco** | gabinete, corpo da chapa da marca |
| 2 | **Grafite** | rodapé, SUNGROW, tampa, placa de base |
| 3 | **Laranja** | barra de luz da tampa, indicador da chapa, letras da placa |

> O **vermelho saiu**. Era um slot inteiro só para o botão de emergência, numa cor que
> não está no estoque. O botão virou rebaixo dentro do anel branco: lê escuro pela sombra
> e não custa troca de filamento nenhuma.

## Peças

| Peça | Medidas | Massa | Como imprime |
|---|---|---|---|
| gabinete | 46 × 65,6 × 95,5 mm | 44,6 g | em pé, sem suporte |
| tampa | 46 × 64,4 × 5,5 mm | 10,2 g | de cabeça para baixo |
| chapa da marca | 32 × 10,4 × 1,5 mm | 0,6 g | **deitada**, arte para cima |
| placa de base | 84 × 84 × 4,4 mm | 25,2 g | deitada |

Total: **80,7 g**. Com a placa o conjunto tem 98,5 mm de altura — cabe na cúpula de 110 mm.

## Montagem

1. A **chapa da marca** (SUNGROW + indicador laranja) vai **colada** no bolso acima da
   grade hexagonal. Folga de 0,25 mm por lado, fica 0,7 mm saliente.
2. A tampa encaixa por aba, com a barra de luz laranja já embutida no canal frontal.
3. O gabinete assenta no rebaixo da placa.

Alça e anel do botão saem em branco, na cor do próprio gabinete: quem as desenha é a
sombra. Assim o corpo inteiro tem **uma troca de cor só**, na linha do rodapé.

## STL avulsos

`miniatura_powerstack_corpo.stl`, `miniatura_powerstack_tampa.stl`,
`miniatura_powerstack_chapa.stl`, `miniatura_powerstack_placa.stl`.

Gerado por `bess_miniature.py`.

## Torre de purga: duas mesas em vez de uma

Cada troca de filamento joga fora material na torre de purga. O que gera troca não é a peça
ter duas cores — é **dois objetos pedirem cores diferentes na mesma altura**: aí o fatiador
troca dentro de cada camada, dezenas de vezes seguidas. Agrupando na mesma mesa as peças que
começam com a mesma cor, a troca vira uma por peça, sequencial em Z.

| Arquivo | Trocas de filamento |
|---|---|
| `miniatura_powerstack_multicor.3mf` (tudo numa mesa) | 23 |
| `miniatura_powerstack_mesa1_corpo.3mf` + `miniatura_powerstack_mesa2_pecas.3mf` | **23** |

**Aqui a divisão não reduz nada, e vale dizer por quê:** as trocas não vêm da convivência
entre objetos, vêm das faixas laranja da própria tampa e da própria placa, que existem em
qualquer arranjo. O ganho da divisão é só tirar a torre de perto da peça de 95 mm. Neste
caso são os ajustes abaixo que resolvem.

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
