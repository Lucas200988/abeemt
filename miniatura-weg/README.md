# Miniatura WEG BESS — contêiner ISO 20 pés, 1:80

Arquivo para imprimir: **`miniatura_weg_multicor.3mf`**

Antes de importar, o projeto aberto no Bambu Studio precisa ter **3 filamentos
carregados**. Com menos que isso o importador joga tudo no filamento 1 sem avisar.

| Slot | Filamento | Onde aparece |
|---|---|---|
| 1 | **Cinza** | contêiner, teto, corpo da chapa do logo |
| 2 | **Preto** | placa de base, logo weg + BESS |
| 3 | **Laranja** | letras e emblema da placa |

> Atenção: aqui o filamento 1 é o **cinza**. Nas maquetes da CCR e do PowerStack o 1 é
> o branco, e no gerador da DCCO é o verde.

## Peças

| Peça | Medidas | Massa | Como imprime |
|---|---|---|---|
| contêiner | 75,7 × 30,5 × 30,2 mm | 16,8 g | apoiado na base, sem suporte |
| teto | 75,7 × 30,5 × 5,2 mm | 7,0 g | de cabeça para baixo |
| chapa do logo | 19 × 20,4 × 1,6 mm | 0,8 g | **deitada**, arte para cima |
| placa de base | 84 × 84 × 4,4 mm | 25,4 g | deitada |

Total: **50 g**. Cabe na cúpula de acrílico de 90 × 90 × 110 mm internos.

## Montagem

1. A **chapa do logo** é peça à parte e vai **colada** no bolso do costado, entre as
   venezianas e as portas. Folga de 0,25 mm por lado; encaixa rente à parede.
2. O teto encaixa por aba, sem cola.
3. O contêiner assenta no rebaixo da placa de base.

O logo é peça separada porque relevo de segunda cor em parede vertical não imprime: cada
camada vira uma ilha solta depositada logo depois de uma troca de filamento. Deitada, a
troca de cor acontece em 3 camadas horizontais em vez de 101 verticais.

Para conferir o encaixe sem gastar o contêiner inteiro, imprima só
`miniatura_weg_chapa_logo.stl` (0,8 g, poucos minutos).

## STL avulsos (uma cor só)

`miniatura_weg_corpo.stl`, `miniatura_weg_teto.stl`, `miniatura_weg_chapa_logo.stl`,
`miniatura_weg_placa.stl` — para imprimir peça a peça ou abrir em outro programa.

Gerado por `weg_bess_miniatura.py` (`python3 weg_bess_miniatura.py` regrava tudo).

## A chapa imprime com a arte para BAIXO

A chapa é virada na mesa: a face da arte encosta no vidro, e a face que vai colada é que
fica por cima. Não mude isso ao rearranjar a mesa.

Numa face de topo, a fronteira entre duas cores é uma costura entre perímetros — sai
ondulada, e o primeiro filete de cada cor ainda vem sujo do purgo da cor anterior. Contra
a mesa, quem define o limite é o próprio vidro, e sai reto. A face colada vira o topo, onde
o acabamento não importa.

**Não use engomar (ironing) nessa peça.** Numa superfície de duas cores o bico arrasta o
escuro para dentro do claro e piora o que deveria melhorar. Como a arte agora imprime
contra a mesa, engomar não tem o que fazer ali de qualquer forma.

**Se a fronteira ainda sair suja**, o ajuste é o volume de descarga do par claro→escuro (e
principalmente escuro→claro). O cálculo automático do Studio é conservador para cima em
algumas combinações e curto em outras; branco depois de grafite é o par que mais precisa.

A profundidade da arte é **0,65 mm** de propósito: com a primeira camada de 0,25 e as
demais de 0,2, a troca de cor cai exatamente no fim da terceira camada (0,25 / 0,45 / 0,65),
sem meia camada misturada.

## Torre de purga e ordem de impressão

Cada troca de filamento joga fora material na torre de purga. O que gera troca não é a peça
ter duas cores — é **dois objetos pedirem cores diferentes na mesma altura**: aí o fatiador
troca dentro de cada camada, dezenas de vezes seguidas. Duas coisas reduzem isso:

1. **Mesas agrupadas** por qual cor está embaixo em cada peça.
2. **A placa de base saiu daqui** e vai junto com as outras três em `placas-base/`, numa
   troca só para as quatro. O laranja dela convivia com as cores do modelo camada a camada.

| Arquivo | Trocas |
|---|---|
| `miniatura_weg_multicor.3mf` (tudo numa mesa) | 22 |
| `miniatura_weg_mesa_conteiner.3mf` + a placa em `placas-base/` | **3** |

O contêiner, o teto e a chapa do logo são todos cinza com um toque de preto, então
cabem numa mesa só sem se atrapalhar.

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
