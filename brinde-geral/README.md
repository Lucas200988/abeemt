# Brindes de tiragem — FMEES 2026

Duas peças em uso, feitas para consumir as sobras das cinco bobinas de 1 kg.

## 1. Chaveiro bateria — brinde de todos

Arquivo: **`chaveiro_bateria.3mf`** · 70 × 32 × 3,2 mm · **5,73 g**

A peça inteira é o símbolo da bateria: o polo vira a argola e o raio é vazado de lado a
lado. Imprime deitada; a troca de cor acontece só nos últimos 0,8 mm.

| Slot | Filamento | Onde aparece |
|---|---|---|
| 1 | cor do corpo | silhueta (troca livremente entre as cinco bobinas) |
| 2 | cor do relevo | FÓRUM / BESS / 2026 |

O verso traz ABEE-MT · MATO GROSSO em baixo-relevo, sem troca de cor. A frente diz
**FMEES / 2026** em duas linhas de 6,26 mm — quem limita a letra é a largura livre ao
lado do raio vazado, não a altura.

**A cor do corpo é trocável sem mexer na geometria** — é assim que as cinco bobinas baixam
juntas. Plano para **716 unidades** com 5 % de reserva (94,5 % de aproveitamento, 32 por mesa):

| Corpo | Relevo | Unidades |
|---|---|---|
| Laranja | Verde | 165 |
| Cinza | Branco | 151 |
| Verde | Branco | 147 |
| Preto | Cinza | 127 |
| Branco | Laranja | 126 |

Sobra no fim: 54 g de laranja, 49 de cinza, 50 de verde, 45 de branco e 42 de preto.

Para trocar as cores, edite `PALETTE` no fim de `chaveiro_bateria.py` e rode de novo.

## 2. Organizador mini BESS — brinde de destaque

Arquivo: **`organizador_mini_bess.3mf`** · 70 × 90 × 60 mm · **74,7 g** · até **58 unidades**

Porta-caneta, porta-celular e porta-cartões em formato de contêiner. Fenda larga na frente
para o aparelho em pé, duas cubas para canetas atrás, passagem de cabo no rodapé de trás.
Imprime em pé e sem suporte nenhum.

| Slot | Filamento | Onde aparece |
|---|---|---|
| 1 | **Cinza** | casca inteira, raio, dizeres e dobradiças em relevo |
| 2 | **Preto** | rodapé |

A fachada sai **na cor do corpo**, com relevo de 1,0 mm — quem desenha o raio e os dizeres
é a sombra. Na tiragem isso importa: em segunda cor seriam quase 400 trocas de filamento
por unidade, com a purga correspondente, e cada camada seria uma ilha solta na parede
vertical, que é o defeito que estragou o logo do contêiner da WEG. Assim sobra **uma troca
por peça**, na linha do rodapé. A frase da lateral é baixo-relevo.

Sugestão de divisão: organizador para palestrantes, patrocinadores e sorteio; chaveiro para
todo mundo.

## Peças anteriores, mantidas para referência

- `suporte_celular.3mf` — suporte de celular inclinado, 56,1 g, um filamento só.
- `tag_forum_bess.3mf` — etiqueta retangular, 6,34 g. Substituída pelo chaveiro bateria,
  que lê como objeto em vez de etiqueta e pesa menos.

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
