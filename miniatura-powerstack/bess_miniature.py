"""Miniatura do Sungrow PowerStack ST255CS-2H em escala 1:25, para cúpula de acrílico de 90 x 90 x 110 mm internos.

Real: 1150 (L) x 2450 (A) x 1610 (P) mm, <= 3000 kg, 125 kW / 257 kWh, refrigeração a líquido.
Aparência (foto de referência): gabinete branco de cantos verticais arredondados, tampa escura
com barra de luz laranja na frente, porta com grade hexagonal perfurada na parte superior,
marca SUNGROW acima da grade, indicador luminoso, botão de emergência à direita,
alça vertical à esquerda e rodapé escuro. Atrás: painel de venezianas do trocador de calor.

Nada de segunda cor solta em parede vertical, que é o que estragou o logo da CCR e o da WEG
na impressão: ali cada camada do relevo é uma ilha depositada logo depois de uma troca de
filamento. A marca e a barra indicadora saíram da parede e viraram chapa à parte, impressa
deitada e colada; a alça e o anel do botão ficaram na cor da própria carenagem; o botão e o
ponto do rodapé viraram rebaixo, que lê escuro pela sombra sem custar troca nenhuma.
Sobra uma troca de cor no corpo inteiro: a linha do rodapé.

Peças (impressão em pé, sem suporte):
  corpo - caixa oca aberta em cima, parede 1,6 mm, fundo 2,4 mm (branco; rodapé escuro em cor separada)
  tampa - placa escura com aba que encaixa no corpo (imprime de cabeça para baixo)
  chapa - 32 x 10,4 x 1,5 mm com SUNGROW e o indicador; imprime deitada e vai colada
  placa - base de 84 x 84 x 3 mm com os dizeres do evento

Eixos de construção: X = largura, Y = altura, Z = profundidade (frente em +Z). Exporta com Z para cima.
"""
import os
import numpy as np
import trimesh
from trimesh.creation import box, cylinder, extrude_polygon
from shapely.geometry import Polygon, Point, box as sbox
from shapely.ops import unary_union
from shapely import affinity
from matplotlib.textpath import TextPath
from matplotlib.font_manager import FontProperties

SCALE = 25.0                                   # 1:25 -> 46 x 98 x 64,4 mm (cúpula: 90 x 90 x 110 internos)
W, H, D = 1150 / SCALE, 2450 / SCALE, 1610 / SCALE
R_CORNER = 2.4                                 # raio dos cantos verticais
WALL, FLOOR = 1.6, 1.6
CAP_T, CAP_LIP, CAP_CLEAR = 2.5, 3.0, 0.25      # tampa: espessura, altura da aba, folga da aba
BASE_BAND = 7.2                                # rodapé escuro (180 mm reais)
RELIEF, SINK = 0.8, 0.05
GROOVE = 0.4
PLATE_S, PLATE_T = 84.0, 3.0                   # placa de base para a cúpula (84 x 84 x 3 mm)
FONT = FontProperties(fname="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")


def rbox(w, h, d, x=0, y=0, z=0):
    b = box(extents=[w, h, d])
    b.apply_translation([x + w / 2, y + h / 2, z + d / 2])
    return b


def rounded_rect(x0, z0, x1, z1, r):
    return sbox(x0, z0, x1, z1).buffer(-r, join_style=1).buffer(r, join_style=1)


def profile_prism(shape2d, y0, y1):
    """Prisma com perfil (x, z) entre alturas y0 e y1 (versão limpa de extrude_y)."""
    m = extrude_polygon(shape2d, y1 - y0)            # vértices (x, z, h)
    v = m.vertices.copy()
    m.vertices = np.column_stack([v[:, 0], v[:, 2] + y0, v[:, 1]])   # (x, z, h) -> (x, y=h+y0, z)
    m.fix_normals()
    return m


def text_flat(txt, cap_height, height, max_width=None, fatten=0.20):
    tp = TextPath((0, 0), txt, size=10, prop=FONT)
    polys = [Polygon(p) for p in tp.to_polygons() if len(p) >= 3]
    polys.sort(key=lambda p: p.area, reverse=True)
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
    scale = cap_height / (maxy - miny)
    if max_width and (maxx - minx) * scale > max_width:
        scale = max_width / (maxx - minx)
    shape = affinity.scale(shape, scale, scale, origin=(0, 0)).buffer(fatten, join_style=1).simplify(0.02)
    geoms = list(shape.geoms) if hasattr(shape, "geoms") else [shape]
    m = trimesh.util.concatenate([extrude_polygon(g, height) for g in geoms])
    b = m.bounds
    m.apply_translation([-(b[0][0] + b[1][0]) / 2, -(b[0][1] + b[1][1]) / 2, 0])
    return m


def on_front(m, cx, cy):
    m.apply_translation([cx, cy, D - SINK])
    return m


def _lay_flat(m):
    """Deita a malha no plano da placa, com o relevo para cima."""
    m.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    return m


def lying_text(txt, cap, cz, max_width=72, height=1.5, back=False):
    """Texto deitado na placa, lido da frente (ou do fundo, com back=True)."""
    m = _lay_flat(text_flat(txt, cap, height, max_width=max_width))
    if back:
        m.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [0, 1, 0]))
    m.apply_translation([W / 2, -SINK, cz])
    return m


def lying_text_side(txt, cap, cx, cz, side, max_len=72, height=1.5):
    """Texto deitado na placa lendo ao longo da profundidade, na faixa lateral."""
    m = _lay_flat(text_flat(txt, cap, height, max_width=max_len))
    ang = -np.pi / 2 if side == "left" else np.pi / 2
    m.apply_transform(trimesh.transformations.rotation_matrix(ang, [0, 1, 0]))
    m.apply_translation([cx, -SINK, cz])
    return m


def lying_emblem(diam, cx, cz, height=1.5):
    """Emblema da ABEE-MT deitado na placa: raio dentro de um anel."""
    r_out = diam / 2
    ring = Point(0, 0).buffer(r_out, 64).difference(Point(0, 0).buffer(r_out - 0.9, 64))
    h = diam * 0.72
    bolt = Polygon([(0.55, 1.0), (0.10, 0.42), (0.42, 0.42), (0.30, 0.0),
                    (0.90, 0.58), (0.58, 0.58), (0.70, 1.0)])
    bolt = affinity.translate(affinity.scale(bolt, h, h, origin=(0, 0)), -0.5 * h, -0.5 * h)
    shape = unary_union([ring, bolt.buffer(0.05, join_style=2)])
    geoms = list(shape.geoms) if hasattr(shape, "geoms") else [shape]
    m = _lay_flat(trimesh.util.concatenate([extrude_polygon(g, height) for g in geoms]))
    m.apply_translation([cx, -SINK, cz])
    return m


# ---------- corpo: caixa oca com cantos arredondados, aberta em cima ----------
outer2d = rounded_rect(0, 0, W, D, R_CORNER)
inner2d = rounded_rect(WALL, WALL, W - WALL, D - WALL, max(R_CORNER - WALL, 1.0))
BODY_TOP = H - CAP_T
shell = profile_prism(outer2d, 0, BODY_TOP)
hollow = profile_prism(inner2d, FLOOR, BODY_TOP + 1)
body = shell.difference(hollow)

# Porta: sulco de contorno na frente
door_x0, door_x1, door_y0, door_y1 = 2.8, W - 2.8, BASE_BAND + 1.6, BODY_TOP - 1.6
door_outer = rbox(door_x1 - door_x0, door_y1 - door_y0, GROOVE, door_x0, door_y0, D - GROOVE)
door_inner = rbox(door_x1 - door_x0 - 2 * GROOVE, door_y1 - door_y0 - 2 * GROOVE, GROOVE + 1,
                  door_x0 + GROOVE, door_y0 + GROOVE, D - GROOVE - 0.5)
body = body.difference(door_outer.difference(door_inner))

# Grade hexagonal (furos rasos de 0,5 mm; passantes ficariam finos demais em 1:25)
# Termina em 79 e não em 83: acima dela fica a chapa da marca, que precisa de parede lisa
gx0, gx1, gy0, gy1 = 9.6, W - 9.6, 58.0, 79.0
pitch, r = 1.9, 0.62
holes = []
row, y = 0, gy0
while y <= gy1:
    x = gx0 + (pitch / 2 if row % 2 else 0)
    while x <= gx1:
        c = cylinder(radius=r, height=1.0, sections=6)               # furo hexagonal raso (0,5 mm)
        c.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 6, [0, 0, 1]))
        c.apply_translation([x, y, D])
        holes.append(c)
        x += pitch
    y += pitch * 0.866
    row += 1
body = body.difference(trimesh.util.concatenate(holes))

# Painel de venezianas atrás (trocador de calor): ranhuras horizontais rasas
lv_x0, lv_x1, lv_y0, lv_y1 = 5.6, W - 5.6, 45.0, 87.0
louvers = []
y = lv_y0
while y <= lv_y1:
    louvers.append(rbox(lv_x1 - lv_x0, 0.7, 0.5, lv_x0, y, -0.25))
    y += 2.0
body = body.difference(trimesh.util.concatenate(louvers))
lv_frame_o = rbox(lv_x1 - lv_x0 + 2, lv_y1 - lv_y0 + 2.4, GROOVE, lv_x0 - 1, lv_y0 - 1, -0.01)
lv_frame_i = rbox(lv_x1 - lv_x0 + 2 - 2 * GROOVE, lv_y1 - lv_y0 + 2.4 - 2 * GROOVE, 2,
                  lv_x0 - 1 + GROOVE, lv_y0 - 1 + GROOVE, -0.5)
body = body.difference(lv_frame_o.difference(lv_frame_i))

# Emenda vertical dos painéis laterais
for x in (0.0, W - GROOVE):
    body = body.difference(rbox(GROOVE + 0.01, BODY_TOP - BASE_BAND - 3.2, 0.6, x - 0.005, BASE_BAND + 1.6, D * 0.42))

# ---------- tampa escura com aba de encaixe ----------
cap_plate = profile_prism(outer2d, BODY_TOP, H)
lip2d = rounded_rect(WALL + CAP_CLEAR, WALL + CAP_CLEAR, W - WALL - CAP_CLEAR, D - WALL - CAP_CLEAR,
                     max(R_CORNER - WALL - CAP_CLEAR, 0.8))
lip_hollow2d = lip2d.buffer(-1.4, join_style=1)
cap_lip = profile_prism(lip2d, BODY_TOP - CAP_LIP, BODY_TOP + 0.01).difference(
    profile_prism(lip_hollow2d, BODY_TOP - CAP_LIP - 1, BODY_TOP + 0.02))
cap = cap_plate.union(cap_lip)
# barra de luz laranja: canal na face frontal da tampa + tira separada
# 1,4 x 0,8 e não 1,0 x 0,5: a 0,5 mm de profundidade a tira ficava com traço de 0,55 mm,
# abaixo do que o bico de 0,4 forma. Ela é embutida no canal, então em toda camada tem
# grafite dos dois lados — nunca é ilha solta, só precisava de corpo para o bico formar.
bar_w, bar_h, bar_d = W - 12.0, 1.4, 0.8
bar_cut = rbox(bar_w, bar_h, bar_d + 0.01, 6.0, BODY_TOP + 0.6, D - bar_d)
cap = cap.difference(bar_cut)
# a tira cresce SINK para cada lado e para dentro: encostada no canal ela teria
# faces exatamente coincidentes com a tampa, que é o que gera "região flutuante"
light_bar = rbox(bar_w + 2 * SINK, bar_h + 2 * SINK, bar_d + SINK,
                 6.0 - SINK, BODY_TOP + 0.6 - SINK, D - bar_d - SINK)

# ---------- frente: nada de segunda cor solta em parede vertical ----------
# A frente tinha SUNGROW em grafite, barra indicadora, alça, anel e botão, tudo em relevo
# de segunda cor na parede vertical — 135 camadas de grafite com seção média de 2,8 mm².
# É exatamente a condição que estragou o logo da CCR e o da WEG: cada camada é uma ilha
# solta depositada logo depois de uma troca de filamento. Três remédios, nesta ordem:
#
#   1. O que é fino e comprido (marca e barra indicadora) sai da parede e vai para uma
#      chapa à parte, impressa deitada e colada — como a chapa da WEG e o crachá da DCCO.
#   2. O que é volume e não cor (alça e anel do botão) fica na cor da própria carenagem:
#      quem desenha essas peças é a sombra, não o contraste.
#   3. O que precisa mesmo de cor e é pequeno (botão e ponto do rodapé) vira embutido:
#      o furo é aberto na parede e a peça colorida o preenche, então em toda camada ela
#      tem material da cor de baixo em volta e nunca fica solta.

# 1. chapa da marca, peça separada, deitada
CH_X0, CH_X1, CH_Y0, CH_Y1 = 7.0, 39.0, 82.0, 92.4
CH_T, CH_BOLSO, CH_FOLGA, CH_ARTE = 1.5, 0.8, 0.25, 0.6
body = body.difference(rbox(CH_X1 - CH_X0 + 2 * CH_FOLGA, CH_Y1 - CH_Y0 + 2 * CH_FOLGA,
                            CH_BOLSO + 0.5, CH_X0 - CH_FOLGA, CH_Y0 - CH_FOLGA, D - CH_BOLSO))
CHZ0, CHZ1 = D - CH_BOLSO, D - CH_BOLSO + CH_T
chapa = rbox(CH_X1 - CH_X0, CH_Y1 - CH_Y0, CH_T, CH_X0, CH_Y0, CHZ0)
marca = text_flat("SUNGROW", 4.0, CH_ARTE + SINK, max_width=26)
marca_bolso = text_flat("SUNGROW", 4.0, CH_ARTE + 0.5, max_width=26)
for m, dz in ((marca_bolso, 0.0), (marca, SINK)):
    m.apply_translation([W / 2, 89.15, CHZ1 - CH_ARTE - dz])
chapa = chapa.difference(marca_bolso)
IND_W, IND_H = 12.0, 1.8
chapa = chapa.difference(rbox(IND_W, IND_H, CH_ARTE + 0.5, W / 2 - IND_W / 2,
                              84.15 - IND_H / 2, CHZ1 - CH_ARTE))
indicador = rbox(IND_W, IND_H, CH_ARTE + SINK, W / 2 - IND_W / 2, 84.15 - IND_H / 2,
                 CHZ1 - CH_ARTE - SINK)

# 2. alça e anel do botão na cor da carenagem
BTN_CX, BTN_CY, BTN_R = W - 8.0, 47.0, 1.3
anel = cylinder(radius=2.3, height=0.6, sections=48).difference(
    cylinder(radius=BTN_R, height=0.8, sections=48))
anel.apply_translation([BTN_CX, BTN_CY, D - SINK + 0.3])
body = body.union(rbox(1.3, 16.0, 1.2, 4.4, 40.0, D - SINK)).union(anel)

# 3. botão e ponto do rodapé: rebaixo, não segunda cor. Um disco de 2,6 mm deitado na
#    parede vertical aparece em 14 camadas, e cada uma custa duas trocas de filamento —
#    56 trocas para 10 mm³ de laranja, o que não se paga nem em tempo nem em purga. Um
#    rebaixo de 0,8 mm dentro do anel branco lê escuro pela sombra, de graça, e o corpo
#    inteiro passa a ter uma troca de cor só: a linha do rodapé, na camada 36.
#    O laranja continua na peça onde sai barato: na chapa (arte deitada) e na barra de
#    luz da tampa (canal fechado, 7 camadas).
body = body.difference(cylinder(radius=BTN_R, height=1.6, sections=48).apply_translation(
    [BTN_CX, BTN_CY, D - 0.8 + 0.8]))
DOT_R = 1.4
body = body.difference(cylinder(radius=DOT_R, height=1.2, sections=32).apply_translation(
    [W / 2, BASE_BAND / 2, D - 0.5 + 0.6]))

# Rodapé escuro: mesma casca, cor separada (corte do corpo em y = BASE_BAND). Vem depois
# dos detalhes da frente, senão o bolso da chapa e os furos do botão não chegariam às duas
# metades — foi por isso que este corte desceu para cá.
base_part = body.intersection(rbox(W + 2, BASE_BAND + 1.05, D + 2, -1, -1, -1))     # y <= BASE_BAND + 0.05
body_white = body.difference(rbox(W + 2, BASE_BAND + 1, D + 2, -1, -1, -1))         # y >= BASE_BAND

# ---------- placa de base para a cúpula ----------
# 84 x 84 mm (cúpula tem 90 internos), 3 mm, com rebaixo de 0,6 mm onde o gabinete assenta e o
# nome do evento em relevo na frente. Gabinete centrado: fica 9,8 mm de faixa livre à frente.
px0, pz0 = (W - PLATE_S) / 2, (D - PLATE_S) / 2
plate2d = rounded_rect(px0, pz0, px0 + PLATE_S, pz0 + PLATE_S, 4.0)
plate = profile_prism(plate2d, -PLATE_T, 0)
# simplify tira o vértice colinear que o buffer deixa na parede do rebaixo
# (ele virava uma face de área zero na malha exportada)
seat = profile_prism(outer2d.buffer(0.2, join_style=1).simplify(0.001), -0.6, 0.01)
plate = plate.difference(seat)
# Textos da placa: uma linha por faixa, com a letra o maior que a faixa permite.
# O gabinete ocupa 64,4 dos 84 mm da placa, então as faixas da frente e do fundo
# têm só 9,6 mm úteis — cabe uma linha de 6 mm de letra em cada. As laterais têm
# 18,8 mm, e é onde entram o nome do equipamento e o emblema da associação.
PZ0, PZ1 = pz0, pz0 + PLATE_S                     # faixa da placa em Z
Z_MID = (PZ0 + PZ1) / 2
X_LEFT = (px0 - 0.2) / 2                          # centro da faixa lateral esquerda
X_RIGHT = (W + 0.2 + px0 + PLATE_S) / 2           # centro da faixa lateral direita
plate_text = trimesh.util.concatenate([
    # o Ó acentuado conta na altura total, então a letra sai menor que o número
    # pedido; aqui a largura de 72 mm é que manda, e a letra fica no máximo possível
    lying_text("FÓRUM BESS 2026", 7.0, D + (PZ1 - D) / 2),           # faixa da frente
    lying_text("ABEE-MT", 6.5, PZ0 / 2, back=True),                  # faixa do fundo
    # 62 mm de comprimento: as linhas da frente e do fundo são mais largas que o
    # gabinete e invadem a faixa lateral, então a lateral tem de parar antes delas
    lying_text_side("POWERSTACK 255CS", 5.4, X_LEFT, Z_MID, "left", max_len=62),
    lying_emblem(13.0, X_RIGHT, Z_MID),
])

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from bambu3mf import write_3mf, place_in_rows, clean_mesh

# ---------- exportação ----------
parts = {
    "corpo_branco": body_white,
    "rodape_escuro": base_part,
    "chapa_branca": chapa,
    "chapa_marca_grafite": marca,
    "chapa_indicador_laranja": indicador,
    "tampa_escura": cap,
    "barra_luz_laranja": light_bar,
    "placa_base": plate,
    "texto_placa": plate_text,
}
for name, m in parts.items():
    m.merge_vertices()
    m.fix_normals()
    print(f"{name:20s} watertight={m.is_watertight}  volume={m.volume:8.0f} mm³")

TO_Z_UP = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])   # Y -> Z, frente -> -Y

# STL 1: corpo completo (rodapé + embutidos fundidos), em pé
body_stl = body_white.union(base_part)
body_stl.apply_transform(TO_Z_UP)
body_stl = clean_mesh(body_stl)
print(f"{'stl_corpo':20s} watertight={body_stl.is_watertight}  volume={body_stl.volume:8.0f} mm³  extents={np.round(body_stl.extents, 1)}")
body_stl.export("miniatura_powerstack_corpo.stl")

# STL 2: tampa (com barra de luz fundida), virada de cabeça para baixo para imprimir sem suporte
cap_stl = cap.union(light_bar)
cap_stl.apply_transform(TO_Z_UP)
cap_stl.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0]))   # vira de cabeça para baixo
cap_stl.apply_translation([0, 0, -cap_stl.bounds[0][2]])
cap_stl.apply_translation([0, -cap_stl.bounds[0][1], 0])
cap_stl = clean_mesh(cap_stl)
print(f"{'stl_tampa':20s} watertight={cap_stl.is_watertight}  volume={cap_stl.volume:8.0f} mm³  extents={np.round(cap_stl.extents, 1)}")
cap_stl.export("miniatura_powerstack_tampa.stl")

# STL 3: placa de base com os textos, deitada
plate_stl = plate.union(plate_text)
plate_stl.apply_transform(TO_Z_UP)
plate_stl.apply_translation([0, 0, -plate_stl.bounds[0][2]])
plate_stl = clean_mesh(plate_stl)
print(f"{'stl_placa':20s} watertight={plate_stl.is_watertight}  volume={plate_stl.volume:8.0f} mm³  extents={np.round(plate_stl.extents, 1)}")
plate_stl.export("miniatura_powerstack_placa.stl")

# STL 4: chapa da marca, deitada, arte para cima — não leva TO_Z_UP nenhum
chapa_stl = chapa.union(marca).union(indicador)
chapa_stl.apply_translation([0, 0, -chapa_stl.bounds[0][2]])
chapa_stl = clean_mesh(chapa_stl)
print(f"{'stl_chapa':20s} watertight={chapa_stl.is_watertight}  volume={chapa_stl.volume:8.0f} mm³  extents={np.round(chapa_stl.extents, 1)}")
chapa_stl.export("miniatura_powerstack_chapa.stl")

# 3MF: quatro objetos, cada peça já no seu filamento (3 slots)
#   1 branco: corpo, chapa | 2 grafite: rodapé, SUNGROW, tampa, placa
#   3 laranja: barra de luz, indicador da chapa, texto da placa

COLOR_GROUPS = {
    "powerstack_corpo": {"1_branco": ["corpo_branco"], "2_cinza_escuro": ["rodape_escuro"]},
    "powerstack_chapa": {"1_branco": ["chapa_branca"], "2_cinza_escuro": ["chapa_marca_grafite"],
                         "3_laranja": ["chapa_indicador_laranja"]},
    "powerstack_tampa": {"2_cinza_escuro": ["tampa_escura"], "3_laranja": ["barra_luz_laranja"]},
    "placa_base":       {"2_cinza_escuro": ["placa_base"], "3_laranja": ["texto_placa"]},
}
# a ordem define o slot de filamento. O vermelho saiu: era um slot inteiro para o botão de
# emergência, numa cor que não está em estoque. O botão agora é laranja, que já existe na
# peça — e a maquete inteira cabe em três filamentos, como as outras duas.
PALETTE = [("1_branco", "Branco", "#EDEFEE"),
           ("2_cinza_escuro", "Grafite", "#33373B"),
           ("3_laranja", "Laranja", "#E8712B")]
flip = trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0])

def placed(name, obj):
    e = parts[name].copy()
    if obj == "powerstack_chapa":
        return e          # já está deitada, arte para cima: é o ponto da mudança
    e.apply_transform(TO_Z_UP)
    if obj == "powerstack_tampa":
        e.apply_transform(flip)
    return e

objects = []
for obj, groups in COLOR_GROUPS.items():
    color_parts = []
    for color, names in groups.items():
        color_parts.append((color, trimesh.util.concatenate([placed(n, obj) for n in names])))
    objects.append((obj, color_parts))

# placa numa fileira, corpo e tampa na outra: mesa compacta, longe da faixa
# reservada ao bico esquerdo nas impressoras de dois bicos
place_in_rows(objects, [["powerstack_corpo", "powerstack_tampa"],
                       ["placa_base", "powerstack_chapa"]])

slots = write_3mf("miniatura_powerstack_multicor.3mf", "Miniatura Sungrow PowerStack 1:25",
                  objects, PALETTE)
print("filamentos:", ", ".join(f"{k} = {v}" for k, v in slots.items()))

# dados para o visualizador (Y para cima, montado), agrupados nas 3 cores
import json
VIEW_GROUPS = {"branco": ["corpo_branco", "chapa_branca"],
               "cinza_escuro": ["rodape_escuro", "chapa_marca_grafite", "tampa_escura", "placa_base"],
               "laranja": ["chapa_indicador_laranja", "barra_luz_laranja", "texto_placa"]}
out = {}
for color, names in VIEW_GROUPS.items():
    m = trimesh.util.concatenate([parts[n] for n in names])
    out[color] = {"v": np.round(m.vertices, 2).flatten().tolist(), "f": m.faces.flatten().tolist()}
open("mesh_data_mini.js", "w").write("const MESH_DATA=" + json.dumps(out, separators=(",", ":")) + ";")
print("arquivos gravados")
