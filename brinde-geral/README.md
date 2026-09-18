# Brindes de tiragem — Fórum BESS 2026

Duas peças em uso, feitas para consumir as sobras das cinco bobinas de 1 kg.

## 1. Chaveiro bateria — brinde de todos

Arquivo: **`chaveiro_bateria.3mf`** · 70 × 32 × 3,2 mm · **5,81 g**

A peça inteira é o símbolo da bateria: o polo vira a argola e o raio é vazado de lado a
lado. Imprime deitada; a troca de cor acontece só nos últimos 0,8 mm.

| Slot | Filamento | Onde aparece |
|---|---|---|
| 1 | cor do corpo | silhueta (troca livremente entre as cinco bobinas) |
| 2 | cor do relevo | FÓRUM / BESS / 2026 |

O verso traz ABEE-MT · MATO GROSSO em baixo-relevo, sem troca de cor.

**A cor do corpo é trocável sem mexer na geometria** — é assim que as cinco bobinas baixam
juntas. Plano para 707 unidades com 5 % de reserva (94,6 % de aproveitamento, 32 por mesa):

| Corpo | Relevo | Unidades |
|---|---|---|
| Laranja | Branco | 155 |
| Cinza | Laranja | 156 |
| Verde | Branco | 147 |
| Preto | Laranja | 127 |
| Branco | Verde | 122 |

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
