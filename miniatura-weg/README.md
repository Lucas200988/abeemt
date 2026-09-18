# Miniatura WEG BESS — contêiner ISO 20 pés, 1:80

Arquivo para imprimir: **`miniatura_weg_multicor.3mf`**

Antes de importar, o projeto aberto no Bambu Studio precisa ter **3 filamentos
carregados**. Com menos que isso o importador joga tudo no filamento 1 sem avisar.

| Slot | Filamento | Onde aparece |
|---|---|---|
| 1 | **Cinza** | contêiner, teto, corpo da chapa do logo |
| 2 | **Preto** | placa de base, logo weg + BESS |
| 3 | **Branco** | letras e emblema da placa |

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

## Torre de purga: duas mesas em vez de uma

Cada troca de filamento joga fora material na torre de purga. O que gera troca não é a peça
ter duas cores — é **dois objetos pedirem cores diferentes na mesma altura**: aí o fatiador
troca dentro de cada camada, dezenas de vezes seguidas. Agrupando na mesma mesa as peças que
começam com a mesma cor, a troca vira uma por peça, sequencial em Z.

| Arquivo | Trocas de filamento |
|---|---|
| `miniatura_weg_multicor.3mf` (tudo numa mesa) | 22 |
| `miniatura_weg_mesa1_cinza.3mf` + `miniatura_weg_mesa2_placa.3mf` | **3** |

A placa de base é a única peça preta e branca; tirada de perto do contêiner cinza,
sobram três trocas na maquete inteira.

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
