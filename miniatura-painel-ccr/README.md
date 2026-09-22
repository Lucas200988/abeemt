# Miniatura CCR — painel elétrico auto-sustentado, 1:20

Arquivo para imprimir: **`miniatura_painel_ccr_multicor.3mf`**

Projeto com **3 filamentos** carregados antes de importar.

| Slot | Filamento | Onde aparece |
|---|---|---|
| 1 | **Branco** | corpo do painel, folha da porta |
| 2 | **Grafite** | rodapé, símbolo da CCR, tampa, placa de base |
| 3 | **Laranja** | letras e emblema da placa |

## Peças

| Peça | Medidas | Massa | Como imprime |
|---|---|---|---|
| corpo | 40 × 30 × 97 mm | 28,0 g | em pé, sem suporte |
| porta | 36,6 × 88,5 × 3,0 mm | 7,7 g | **deitada**, símbolo para cima |
| tampa | 40 × 30 × 7 mm | 5,4 g | de cabeça para baixo |
| placa de base | 84 × 84 × 4,4 mm | 26,4 g | deitada |

Total: **67,5 g**. Com a placa, 100 mm de altura — cabe na cúpula de 110 mm.

## Montagem

1. A **porta** é peça à parte e vai **colada** no bolso da frente do corpo. A fresta de
   0,25 mm em volta é realista: painel de verdade tem.
2. O símbolo da CCR já vem embutido rente à face da porta — nada a colar ali.
3. A tampa encaixa por aba.

Foi nesta maquete que o problema apareceu primeiro: com o símbolo em relevo na parede
vertical, a impressora depositava uma ilha solta de grafite a cada camada, logo depois de
uma troca de filamento — cerca de 100 camadas. Com a porta deitada são **5 camadas**.

## STL avulsos

`miniatura_painel_ccr_corpo.stl`, `miniatura_painel_ccr_porta.stl`,
`miniatura_painel_ccr_tampa.stl`, `miniatura_painel_ccr_placa.stl`.

Gerado por `painel_ccr_miniatura.py`.

## A porta imprime com a arte para CIMA

Diferente das chapas das outras três maquetes, que são viradas. A porta tem as dobradiças
em relevo na mesma face do símbolo — virada, elas seriam o único ponto apoiado na mesa e a
porta ficaria pendurada nelas.

Isso é aceitável aqui por uma questão de escala: o símbolo tem **28 mm de largura**, contra
4 mm de altura de letra na chapa do SUNGROW. Uma borda irregular de 0,2 mm é 5 % de uma
letra pequena e 0,7 % de um símbolo desse tamanho.

**Não use engomar (ironing) na porta.** Numa superfície de duas cores o bico arrasta o
grafite para dentro do branco.

## Torre de purga e ordem de impressão

Cada troca de filamento joga fora material na torre de purga. O que gera troca não é a peça
ter duas cores — é **dois objetos pedirem cores diferentes na mesma altura**: aí o fatiador
troca dentro de cada camada, dezenas de vezes seguidas. Duas coisas reduzem isso:

1. **Mesas agrupadas** por qual cor está embaixo em cada peça.
2. **A placa de base saiu daqui** e vai junto com as outras três em `placas-base/`, numa
   troca só para as quatro. O laranja dela convivia com as cores do modelo camada a camada.

| Arquivo | Trocas |
|---|---|
| `miniatura_painel_ccr_multicor.3mf` (tudo numa mesa) | 32 |
| `mesa1_corpo` + `mesa2_porta` + a placa em `placas-base/` | **15** |

As dez trocas da mesa1 vêm da tampa grafite convivendo com o corpo já branco entre 5 e
7 mm de altura.

Quatro ajustes no Studio ajudam tanto quanto a divisão, e valem para qualquer arquivo:

1. **Agrupamento de filamentos em "Automático (descarga)"** na H2C. Forçar tudo num bico só
   resolve erro de mapeamento mas desliga a otimização de purga dos dois bicos.
2. **Descarregar no preenchimento do objeto** — manda o descarte para dentro das peças.
3. **Volumes de descarga**: o cálculo automático é conservador; pares entre cores escuras
   aceitam bem menos que o padrão.
4. **Sequência de impressão → Por objeto**, se as peças couberem afastadas o bastante para
   o bico passar por cima das já prontas. Zera a troca entre peças.

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
