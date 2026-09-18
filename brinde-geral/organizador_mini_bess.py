"""Organizador de mesa em formato de mini contêiner BESS — porta-caneta, porta-celular
e porta-cartões. Brinde do Fórum BESS 2026.

70 x 90 x 60 mm. Casca de 2,2 mm com fundo fechado, imprime em pé e sem suporte nenhum:
tudo na peça é corte na superfície ou parede vertical.

Divisões internas: fenda da frente, larga e rasa, para o celular em pé ou um maço de
cartões; atrás dela duas cubas para canetas, separadas por um septo. Passagem de cabo
entalhada no rodapé de trás, para o carregador sair por baixo.

Fachada de contêiner, o mesmo vocabulário da maquete do WEG: rodapé escuro, duas folhas
de porta com venezianas e dobradiças, corrugação nas laterais, raio e dizeres do evento
na frente, e a frase da associação em vertical na lateral.

Eixos: X = largura, Y = altura, Z = profundidade (fachada em z = 0).
Exporta com Z para cima.
"""
import os
import numpy as np
import trimesh
from trimesh.creation import box, extrude_polygon
from shapely.geometry import Polygon, box as sbox
from shapely.ops import unary_union
from shapely import affinity
from matplotlib.textpath import TextPath
from matplotlib.font_manager import FontProperties

# ---------- parâmetros ----------
W, D, H = 70.0, 90.0, 60.0
PAREDE, FUNDO = 2.0, 1.8
RODAPE = 6.0                     # rodapé escuro
R_CANTO = 1.5
SEPTO = 2.0                      # septo entre as cubas de caneta
FENDA_Z = 18.0                   # fenda da frente (celular / cartões)
RELIEF, SINK = 0.7, 0.05
GROOVE = 0.5
CABO_L, CABO_A = 20.0, 9.0
DENSIDADE = 1.24
FONT = FontProperties(fname="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")


def rbox(w, h, d, x=0, y=0, z=0):
    b = box(extents=[w, h, d])
    b.apply_translation([x + w / 2, y + h / 2, z + d / 2])
    return b


def rounded_rect(x0, z0, x1, z1, r):
    return sbox(x0, z0, x1, z1).buffer(-r, join_style=1).buffer(r, join_style=1)


def profile_prism(shape_xz, y0, y1):
    m = extrude_polygon(shape_xz, y1 - y0)
    v = m.vertices.copy()
    m.vertices = np.column_stack([v[:, 0], v[:, 2] + y0, v[:, 1]])
    m.fix_normals()
    return m


def text_shape(txt, cap, max_width=None, fatten=0.18):
    tp = TextPath((0, 0), txt, size=10, prop=FONT)
    polys = sorted((Polygon(p) for p in tp.to_polygons() if len(p) >= 3),
                   key=lambda p: p.area, reverse=True)
    shape = None
    for p in polys:
        p = p.buffer(0)
        if shape is None:
            shape = p
        elif shape.contains(p.representative_point()):
            shape = shape.difference(p)
        else:
            shape = shape.union(p)
    minx, miny, maxx, maxy = shape.bounds
    k = cap / (maxy - miny)
    if max_width and (maxx - minx) * k > max_width:
        k = max_width / (maxx - minx)
    shape = affinity.scale(shape, k, k, origin=(0, 0)).buffer(fatten, join_style=1).simplify(0.02)
    minx, miny, maxx, maxy = shape.bounds
    return affinity.translate(shape, -(minx + maxx) / 2, -(miny + maxy) / 2)


def raio_shape(altura):
    p = Polygon([(0.55, 1.0), (0.10, 0.42), (0.42, 0.42), (0.30, 0.0),
                 (0.90, 0.58), (0.58, 0.58), (0.70, 1.0)])
    p = affinity.scale(p, altura, altura, origin=(0, 0))
    minx, miny, maxx, maxy = p.bounds
    return affinity.translate(p, -(minx + maxx) / 2, -(miny + maxy) / 2)


def na_frente(shape_xy, altura):
    """Relevo na fachada (z = 0), saindo para -Z, girado em torno de x = W/2 para
    continuar centrado e legível de frente."""
    geoms = list(shape_xy.geoms) if hasattr(shape_xy, "geoms") else [shape_xy]
    m = trimesh.util.concatenate([extrude_polygon(g, altura) for g in geoms])
    m.apply_translation([-W / 2, 0, 0])
    m.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [0, 1, 0]))
    m.apply_translation([W / 2, 0, SINK])
    return m


def na_lateral(shape_xy, altura, lado):
    """Relevo numa lateral. O giro de 90° em Y troca X por Z e inverte o sinal, então
    o bloco é centrado antes de girar e reposicionado depois — sem isso ia parar em z
    negativo, fora da peça."""
    geoms = list(shape_xy.geoms) if hasattr(shape_xy, "geoms") else [shape_xy]
    m = trimesh.util.concatenate([extrude_polygon(g, altura) for g in geoms])
    m.apply_translation([-D / 2, 0, 0])
    ang = np.pi / 2 if lado == "direita" else -np.pi / 2
    m.apply_transform(trimesh.transformations.rotation_matrix(ang, [0, 1, 0]))
    m.apply_translation([W - SINK if lado == "direita" else SINK, 0, D / 2])
    return m


# ---------- casca ----------
externo = rounded_rect(0, 0, W, D, R_CANTO)
interno = rounded_rect(PAREDE, PAREDE, W - PAREDE, D - PAREDE, 0.8)
corpo = profile_prism(externo, 0, H).difference(profile_prism(interno, FUNDO, H + 1))

# septo entre as duas cubas de caneta, e parede entre a fenda da frente e as cubas
corpo = corpo.union(profile_prism(
    sbox(PAREDE - 0.5, FENDA_Z, W - PAREDE + 0.5, FENDA_Z + SEPTO), FUNDO - 0.5, H))
corpo = corpo.union(profile_prism(
    sbox(W / 2 - SEPTO / 2, FENDA_Z + SEPTO - 0.5, W / 2 + SEPTO / 2, D - PAREDE + 0.5),
    FUNDO - 0.5, H))

# passagem de cabo, no rodapé de trás
corpo = corpo.difference(rbox(CABO_L, CABO_A, PAREDE + 2.0, W / 2 - CABO_L / 2, -0.01,
                              D - PAREDE - 1.0))

# ---------- fachada de contêiner ----------
PORTA_Y0, PORTA_Y1 = RODAPE + 2.0, H - 2.5
cortes = []
for x0, x1 in [(3.0, W / 2 - 1.0), (W / 2 + 1.0, W - 3.0)]:      # duas folhas de porta
    o = rbox(x1 - x0, PORTA_Y1 - PORTA_Y0, GROOVE, x0, PORTA_Y0, -0.01)
    # a caixa interna precisa cobrir toda a faixa em Z da externa, senão sobra um
    # degrau de décimos de milímetro que fragmenta a casca
    i = rbox(x1 - x0 - 2 * GROOVE, PORTA_Y1 - PORTA_Y0 - 2 * GROOVE, GROOVE + 1,
             x0 + GROOVE, PORTA_Y0 + GROOVE, -0.5)
    cortes.append(o.difference(i))
for cx in (6.5, W - 6.5):                                        # venezianas nas folhas
    y = PORTA_Y0 + 3.0
    while y <= PORTA_Y1 - 12.0:
        cortes.append(rbox(6.0, 1.0, 0.56, cx - 3.0, y, -0.01))
        y += 2.2
corpo = corpo.difference(trimesh.util.concatenate(cortes))

# corrugação das laterais e do fundo do contêiner
ondas = []
for z in (0.0, W - 0.6):
    x = 6.0
    while x <= D - 6.0:
        ondas.append(rbox(0.61, H - RODAPE - 5.0, 1.6, z - 0.005, RODAPE + 2.0, x))
        x += 4.0
x = 6.0
while x <= W - 6.0:                                              # fundo do contêiner
    ondas.append(rbox(1.6, H - RODAPE - 5.0, 0.61, x, RODAPE + 2.0, D - 0.6))
    x += 4.0
corpo = corpo.difference(trimesh.util.concatenate(ondas))

# ---------- fachada: relevo na cor do próprio corpo ----------
# Antes isto era tudo em segunda cor, saindo da fachada vertical. É a condição que
# estragou o logo da CCR e o da WEG na impressão: em parede vertical cada camada do
# relevo é uma ilha solta depositada logo depois de uma troca de filamento, e aqui
# seriam quase 200 camadas com duas trocas em cada.
#
# Nas maquetes a saída foi imprimir a arte deitada numa chapinha e colar. Aqui não:
# este é o brinde de tiragem, e chapinha significa uma colagem por unidade, além do
# desperdício de purga de 400 trocas. Então a fachada inteira sai na cor do corpo, com
# relevo de 1,0 mm em vez de 0,7 — quem desenha o raio e os dizeres é a sombra. A única
# troca de cor que sobra na peça é o rodapé, que é uma faixa horizontal: uma troca só,
# na camada 30. A frase da lateral vira baixo-relevo, que numa parede lisa lê melhor
# que saliência e não muda nada no tempo de impressão.
RELIEF_FACHADA = 1.0
frente2d = [affinity.translate(raio_shape(14.0), W / 2, 41.0),
            affinity.translate(text_shape("FÓRUM BESS 2026", 5.4, max_width=40.0), W / 2, 28.0)]
for i, linha in enumerate(["ENGENHARIA", "ENERGIA", "FUTURO"]):
    # fatten 0,12 nas linhas de 3 mm: com 0,18 duas letras encostavam a 0,02 mm e
    # sairiam fundidas; o traço ainda fica acima de 0,9 mm
    frente2d.append(affinity.translate(text_shape(linha, 3.0, max_width=30.0, fatten=0.12),
                                       W / 2, 20.5 - i * 4.6))
corpo = corpo.union(na_frente(unary_union(frente2d), RELIEF_FACHADA + SINK))

dobradicas = []
# Só nas arestas externas das folhas: o par do meio caía em cima do subtítulo, e em
# contêiner real o encontro das folhas é o fecho, não a dobradiça.
for cx in (3.6, W - 3.6):
    for cy in (PORTA_Y0 + 3.0, PORTA_Y1 - 6.0):
        dobradicas.append(rbox(2.6, 3.0, RELIEF_FACHADA + SINK, cx - 1.3, cy, -RELIEF_FACHADA))
corpo = corpo.union(trimesh.util.concatenate(dobradicas))

# A frase inteira numa linha teria 64 mm e a lateral só tem 60 de altura útil;
# em cinco linhas curtas o bloco fica 20 x 39 mm e sobra folga nos dois sentidos.
linhas_lat = ["ARMAZENANDO", "HOJE", "UM AMANHÃ", "MAIS", "SUSTENTÁVEL"]
bloco = unary_union([affinity.translate(text_shape(t, 3.0, max_width=34.0), 0, -i * 4.4)
                     for i, t in enumerate(linhas_lat)])
bx0, by0, bx1, by1 = bloco.bounds
bloco = affinity.rotate(affinity.translate(bloco, -(bx0 + bx1) / 2, -(by0 + by1) / 2), -90)
# baixo-relevo de 0,6 mm: o bloco é gerado 1 mm para fora e recortado do corpo
# na_lateral entrega o bloco começando em x = W - SINK e saindo para fora; recuar
# 0,55 o faz começar em x = W - 0,6 e ainda romper a superfície em x = W + 0,4
frase = na_lateral(affinity.translate(bloco, D / 2, (RODAPE + H) / 2), 1.0, "direita")
frase.apply_translation([-0.55, 0, 0])
corpo = corpo.difference(frase)

# rodapé escuro: mesma casca, cor separada. O corte vem depois da fachada, e a peça de
# uma cor só sai de `corpo` inteiro — unir as duas metades de volta deixava 6 faces de
# área zero na junta, onde a passagem de cabo atravessa a linha do rodapé.
rodape = corpo.intersection(rbox(W + 2, RODAPE + 1.05, D + 2, -1, -1, -1))
corpo_claro = corpo.difference(rbox(W + 2, RODAPE + 1, D + 2, -1, -1, -1))

# ---------- verificação e exportação ----------
parts = {"corpo_claro": corpo_claro, "rodape_escuro": rodape}
for nome, m in parts.items():
    m.merge_vertices()
    m.fix_normals()
    print(f"{nome:18s} fechada={m.is_watertight}  volume={m.volume:9.1f} mm³  "
          f"massa={m.volume / 1000 * DENSIDADE:6.2f} g")
total_g = sum(m.volume for m in parts.values()) / 1000 * DENSIDADE
print(f"{'peça':18s} {W:.0f} x {D:.0f} x {H:.0f} mm   massa da casca {total_g:.1f} g")

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from bambu3mf import write_3mf, place_in_rows, clean_mesh

TO_Z_UP = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])
# A peça de uma cor só é o próprio `corpo`, antes do corte do rodapé: sem booleano de
# remontagem, sem sliver na junta. Antes isto era uma concatenação das partes, e o STL
# saía como colagem de 73 cascas que se atravessam.
uma_cor = corpo.copy()
uma_cor.apply_transform(TO_Z_UP)
uma_cor.apply_translation([0, 0, -uma_cor.bounds[0][2]])
uma_cor = clean_mesh(uma_cor)
print(f"{'stl':18s} fechada={uma_cor.is_watertight}  cascas={len(uma_cor.split(only_watertight=False))}  medidas={np.round(uma_cor.extents, 1)}")
uma_cor.export("organizador_mini_bess.stl")


PALETTE = [("1_corpo", "Cinza", "#C9CDCB"), ("2_rodape", "Preto", "#1A1A1A")]
pecas = []
for cor, ms in [("1_corpo", [corpo_claro]), ("2_rodape", [rodape])]:
    e = trimesh.util.concatenate([m.copy() for m in ms])
    e.apply_transform(TO_Z_UP)
    pecas.append((cor, e))
objects = [("organizador_mini_bess", pecas)]
place_in_rows(objects, [["organizador_mini_bess"]])
slots = write_3mf("organizador_mini_bess.3mf", "Organizador mini BESS Fórum 2026",
                  objects, PALETTE, precision=4)
print("filamentos:", ", ".join(f"{k} = {v}" for k, v in slots.items()))
print("arquivos gravados")
