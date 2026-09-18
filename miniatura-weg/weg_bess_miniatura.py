"""Miniatura de mesa do BESS da WEG em escala 1:25, para cúpula de acrílico de 90 x 90 x 110 mm.

A peça representa o BESS da WEG em formato de armário, sem reproduzir um modelo
específico: a placa diz "WEG BESS" e não traz número de modelo. As proporções vêm do
datasheet do BSCW400 T100 B215 (1040 x 2200 x 1500 mm, L x A x P), que é um gabinete
WEG real; a pesquisa indica que esse código pode ser o armário de conversão e não o de
baterias, e como a maquete não se apresenta como ele, isso não gera contradição.

Em 1:25 -> 41,6 x 88 x 60 mm. Com a placa de 3 mm, 91 mm de altura.

A escala é a mesma da miniatura do Sungrow PowerStack de propósito: as duas ficam
diretamente comparáveis em tamanho, que é a graça de ter as duas na mesa.

Frente no estilo WEG: duas portas sobrepostas, grade de ventilação na porta inferior,
logo da WEG em relevo na superior (vetorizado do arquivo oficial; os vãos das letras
deixam aparecer o branco do corpo, como no logo real), alças à esquerda, botão de
emergência à direita, rodapé e teto escuros.

Peças (impressão sem suporte):
  corpo  - casca oca aberta em cima, parede 1,6 mm, fundo 2,0 mm; imprime em pé
  tampa  - teto com aba de encaixe; imprime de cabeça para baixo
  placa  - base de 84 x 84 x 3 mm, com texto nas quatro faixas

Eixos de construção: X = largura, Y = altura, Z = profundidade (frente em +Z).
Exporta com Z para cima.
"""
import os
import pickle
import numpy as np
import trimesh
from trimesh.creation import box, cylinder, extrude_polygon
from shapely.geometry import Polygon, Point, box as sbox
from shapely.ops import unary_union
from shapely import affinity
from matplotlib.textpath import TextPath
from matplotlib.font_manager import FontProperties

# ---------- parâmetros ----------
SCALE = 25.0
W, H, D = 1040 / SCALE, 2200 / SCALE, 1500 / SCALE      # 41,6 x 88,0 x 60,0
R_CORNER = 2.0
WALL, FLOOR = 1.6, 2.0
CAP_T, CAP_LIP, CAP_CLEAR = 3.0, 4.0, 0.25
BODY_TOP = H - CAP_T
PLINTH = 150 / SCALE                                     # rodapé de 150 mm -> 6,0
RELIEF, SINK = 0.8, 0.05
GROOVE = 0.5
PLATE_S, PLATE_T = 84.0, 3.0
FONT = FontProperties(fname="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
LOGO_PNG = "/home/user/abeemt/nl/weg.png"


def rbox(w, h, d, x=0, y=0, z=0):
    b = box(extents=[w, h, d])
    b.apply_translation([x + w / 2, y + h / 2, z + d / 2])
    return b


def rounded_rect(x0, z0, x1, z1, r):
    return sbox(x0, z0, x1, z1).buffer(-r, join_style=1).buffer(r, join_style=1)


def profile_prism(shape2d, y0, y1):
    """Prisma com perfil (x, z) entre as alturas y0 e y1."""
    m = extrude_polygon(shape2d, y1 - y0)
    v = m.vertices.copy()
    m.vertices = np.column_stack([v[:, 0], v[:, 2] + y0, v[:, 1]])
    m.fix_normals()
    return m


# ---------- logo da WEG vetorizado do arquivo oficial ----------
def weg_shape(cache="weg_shape.pkl"):
    """Moldura e letras do logo. Os vãos ficam vazados: o branco do corpo aparece
    por eles, que é a relação de figura e fundo do logo real."""
    if os.path.exists(cache):
        return pickle.load(open(cache, "rb"))
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from PIL import Image
    a = np.array(Image.open(LOGO_PNG).convert("RGB")).astype(float)
    mask = ((a[:, :, 2] > 110) & (a[:, :, 0] < 160)).astype(float)       # azul WEG #005CA5
    ys, xs = np.nonzero(mask > 0.5)
    mask = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    segs = plt.contour(np.pad(mask, 2), levels=[0.5]).allsegs[0]
    polys = sorted((Polygon(s).buffer(0) for s in segs if len(s) >= 4),
                   key=lambda p: p.area, reverse=True)
    shape = None
    for p in polys:
        p = p.simplify(1.2)
        if shape is None:
            shape = p
        elif shape.contains(p.representative_point()):
            shape = shape.difference(p)
        else:
            shape = shape.union(p)
    shape = affinity.scale(shape, 1, -1, origin="center")                # imagem tem Y para baixo
    assert len(shape.geoms) == 3, f"esperava moldura + 2 blocos, achei {len(shape.geoms)}"
    pickle.dump(shape, open(cache, "wb"))
    return shape


def weg_mesh(width, height_relief):
    s = weg_shape()
    minx, miny, maxx, maxy = s.bounds
    k = width / (maxx - minx)
    s = affinity.scale(s, k, k, origin=(minx, miny))
    m = trimesh.util.concatenate([extrude_polygon(g, height_relief) for g in s.geoms])
    b = m.bounds
    m.apply_translation([-(b[0][0] + b[1][0]) / 2, -(b[0][1] + b[1][1]) / 2, 0])
    return m


# ---------- texto ----------
def text_flat(txt, cap_height, height, max_width=None, fatten=0.20):
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
    k = cap_height / (maxy - miny)
    if max_width and (maxx - minx) * k > max_width:
        k = max_width / (maxx - minx)
    shape = affinity.scale(shape, k, k, origin=(0, 0)).buffer(fatten, join_style=1).simplify(0.02)
    geoms = list(shape.geoms) if hasattr(shape, "geoms") else [shape]
    m = trimesh.util.concatenate([extrude_polygon(g, height) for g in geoms])
    b = m.bounds
    m.apply_translation([-(b[0][0] + b[1][0]) / 2, -(b[0][1] + b[1][1]) / 2, 0])
    return m


def on_front(m, cx, cy):
    m.apply_translation([cx, cy, D - SINK])
    return m


def _lay_flat(m):
    m.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    return m


def lying_text(txt, cap, cz, max_width=72, height=1.5, back=False):
    m = _lay_flat(text_flat(txt, cap, height, max_width=max_width))
    if back:
        m.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [0, 1, 0]))
    m.apply_translation([W / 2, -SINK, cz])
    return m


def lying_text_side(txt, cap, cx, cz, side, max_len=72, height=1.5):
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


# ---------- corpo: casca oca aberta em cima ----------
outer2d = rounded_rect(0, 0, W, D, R_CORNER)
inner2d = rounded_rect(WALL, WALL, W - WALL, D - WALL, max(R_CORNER - WALL, 0.6))
body = profile_prism(outer2d, 0, BODY_TOP).difference(profile_prism(inner2d, FLOOR, BODY_TOP + 1))

# Duas portas sobrepostas, cada uma com rasgo de contorno
DOOR_X0, DOOR_X1 = 1.8, W - 1.8
LO_Y0, LO_Y1 = PLINTH + 1.2, 43.5
UP_Y0, UP_Y1 = 44.5, BODY_TOP - 1.5


def door_groove(y0, y1):
    o = rbox(DOOR_X1 - DOOR_X0, y1 - y0, GROOVE, DOOR_X0, y0, D - GROOVE)
    i = rbox(DOOR_X1 - DOOR_X0 - 2 * GROOVE, y1 - y0 - 2 * GROOVE, GROOVE + 1,
             DOOR_X0 + GROOVE, y0 + GROOVE, D - GROOVE - 0.5)
    return o.difference(i)


body = body.difference(door_groove(LO_Y0, LO_Y1))
body = body.difference(door_groove(UP_Y0, UP_Y1))

# Grade de ventilação da porta inferior (furos rasos; passantes ficariam finos em 1:25)
gx0, gx1, gy0, gy1 = 6.4, W - 6.4, 12.0, 39.0
pitch, r = 2.0, 0.66
holes, row, y = [], 0, gy0
while y <= gy1:
    x = gx0 + (pitch / 2 if row % 2 else 0)
    while x <= gx1:
        c = cylinder(radius=r, height=1.0, sections=6)
        c.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 6, [0, 0, 1]))
        c.apply_translation([x, y, D])
        holes.append(c)
        x += pitch
    y += pitch * 0.866
    row += 1
body = body.difference(trimesh.util.concatenate(holes))

# Venezianas do trocador de calor, atrás
lv_x0, lv_x1, lv_y0, lv_y1 = 5.0, W - 5.0, 20.0, 74.0
louvers, y = [], lv_y0
while y <= lv_y1:
    louvers.append(rbox(lv_x1 - lv_x0, 0.8, 0.5, lv_x0, y, -0.25))
    y += 2.2
body = body.difference(trimesh.util.concatenate(louvers))
lvf_o = rbox(lv_x1 - lv_x0 + 2.4, lv_y1 - lv_y0 + 2.8, GROOVE, lv_x0 - 1.2, lv_y0 - 1.2, -0.01)
lvf_i = rbox(lv_x1 - lv_x0 + 2.4 - 2 * GROOVE, lv_y1 - lv_y0 + 2.8 - 2 * GROOVE, 2,
             lv_x0 - 1.2 + GROOVE, lv_y0 - 1.2 + GROOVE, -0.5)
body = body.difference(lvf_o.difference(lvf_i))

# Emenda vertical dos painéis laterais
for x in (0.0, W - GROOVE):
    body = body.difference(rbox(GROOVE + 0.01, BODY_TOP - PLINTH - 4, 0.6,
                                x - 0.005, PLINTH + 2, D * 0.45))

# Rodapé escuro: mesma casca, cor separada (corte em y = PLINTH)
plinth_part = body.intersection(rbox(W + 2, PLINTH + 1.05, D + 2, -1, -1, -1))   # y <= PLINTH + 0,05
body_white = body.difference(rbox(W + 2, PLINTH + 1, D + 2, -1, -1, -1))         # y >= PLINTH

# ---------- tampa escura com aba de encaixe ----------
cap_plate = profile_prism(outer2d, BODY_TOP, H)
lip2d = rounded_rect(WALL + CAP_CLEAR, WALL + CAP_CLEAR, W - WALL - CAP_CLEAR, D - WALL - CAP_CLEAR,
                     max(R_CORNER - WALL - CAP_CLEAR, 0.6))
cap_lip = profile_prism(lip2d, BODY_TOP - CAP_LIP, BODY_TOP + 0.01).difference(
    profile_prism(lip2d.buffer(-1.4, join_style=1), BODY_TOP - CAP_LIP - 1, BODY_TOP + 0.02))
cap = cap_plate.union(cap_lip)

# ---------- detalhes em relevo na frente ----------
dark, orange, red = [], [], []

# logo da WEG na porta superior; os vãos das letras deixam ver o branco do corpo
dark.append(on_front(weg_mesh(width=24.0, height_relief=RELIEF + SINK), W / 2, 68.0))

# faixa indicadora sob o logo
orange.append(rbox(12.0, 1.0, 0.5, W / 2 - 6.0, 57.0, D - SINK))

# alças verticais, uma por porta
for cy in (18.0, 55.0):
    dark.append(rbox(1.4, 14.0, 1.2, 2.8, cy, D - SINK))

# botão de emergência com anel, à direita da porta superior
ring = cylinder(radius=2.1, height=0.6, sections=32).difference(
    cylinder(radius=1.1, height=0.8, sections=32))
ring.apply_translation([W - 6.5, 50.0, D - SINK + 0.3])
dark.append(ring)
btn = cylinder(radius=1.1 + SINK, height=1.4, sections=32)
btn.apply_translation([W - 6.5, 50.0, D - SINK + 0.7])
red.append(btn)

# dobradiças na aresta direita das portas
for cy in (14.0, 30.0, 50.0, 72.0):
    dark.append(rbox(1.6, 3.2, 0.8, W - 2.6, cy - 1.6, D - SINK))

details_dark = trimesh.util.concatenate(dark)
details_orange = trimesh.util.concatenate(orange)
details_red = trimesh.util.concatenate(red)

# ---------- placa de base para a cúpula ----------
px0, pz0 = (W - PLATE_S) / 2, (D - PLATE_S) / 2
plate = profile_prism(rounded_rect(px0, pz0, px0 + PLATE_S, pz0 + PLATE_S, 4.0), -PLATE_T, 0)
# simplify tira o vértice colinear que o buffer deixa na parede do rebaixo
plate = plate.difference(profile_prism(outer2d.buffer(0.2, join_style=1).simplify(0.001), -0.8, 0.01))

# O gabinete ocupa 60 dos 84 mm da placa, então as faixas da frente e do fundo têm
# 11,8 mm úteis e as laterais 21,0 mm. Uma linha por faixa, letra o maior possível.
PZ0, PZ1 = pz0, pz0 + PLATE_S
Z_MID = (PZ0 + PZ1) / 2
X_LEFT = (px0 - 0.2) / 2
X_RIGHT = (W + 0.2 + px0 + PLATE_S) / 2
plate_marks = trimesh.util.concatenate([
    lying_text("FÓRUM BESS 2026", 7.5, D + (PZ1 - D) / 2),            # faixa da frente
    lying_text("ABEE-MT", 7.5, PZ0 / 2, back=True),                   # faixa do fundo
    # as linhas da frente e do fundo são mais largas que o gabinete e invadem a faixa
    # lateral, então a lateral para antes delas
    lying_text_side("WEG BESS", 6.5, X_LEFT, Z_MID, "left", max_len=52),
    lying_emblem(14.0, X_RIGHT, Z_MID),
])

# ---------- exportação ----------
parts = {
    "corpo_branco": body_white,
    "rodape_grafite": plinth_part,
    "tampa_grafite": cap,
    "detalhes_grafite": details_dark,
    "faixa_laranja": details_orange,
    "botao_vermelho": details_red,
    "placa_base": plate,
    "emblema_e_textos": plate_marks,
}
for name, m in parts.items():
    m.merge_vertices()
    m.fix_normals()
    print(f"{name:20s} watertight={m.is_watertight}  volume={m.volume:8.0f} mm³")

TO_Z_UP = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])

# STLs de uma cor, para quem quiser imprimir sem AMS
body_stl = body_white.union(plinth_part).union(details_dark).union(details_orange).union(details_red)
body_stl.apply_transform(TO_Z_UP)
body_stl.merge_vertices()
print(f"{'stl_corpo':20s} watertight={body_stl.is_watertight}  volume={body_stl.volume:8.0f} mm³"
      f"  medidas={np.round(body_stl.extents, 1)}")
body_stl.export("miniatura_weg_corpo.stl")

cap_stl = cap.copy()
cap_stl.apply_transform(TO_Z_UP)
cap_stl.apply_translation([0, 0, -cap_stl.bounds[0][2]])
cap_stl.merge_vertices()
print(f"{'stl_tampa':20s} watertight={cap_stl.is_watertight}  volume={cap_stl.volume:8.0f} mm³"
      f"  medidas={np.round(cap_stl.extents, 1)}")
cap_stl.export("miniatura_weg_tampa.stl")

plate_stl = plate.union(plate_marks)
plate_stl.apply_transform(TO_Z_UP)
plate_stl.apply_translation([0, 0, -plate_stl.bounds[0][2]])
plate_stl.merge_vertices()
print(f"{'stl_placa':20s} watertight={plate_stl.is_watertight}  volume={plate_stl.volume:8.0f} mm³"
      f"  medidas={np.round(plate_stl.extents, 1)}")
plate_stl.export("miniatura_weg_placa.stl")

# ---------- 3MF: três objetos, cada peça já no seu filamento ----------
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from bambu3mf import write_3mf, place_in_rows

COLOR_GROUPS = {
    "weg_corpo": {"1_branco": ["corpo_branco"],
                  "2_grafite": ["rodape_grafite", "detalhes_grafite"],
                  "3_laranja": ["faixa_laranja"],
                  "4_vermelho": ["botao_vermelho"]},
    "weg_tampa": {"2_grafite": ["tampa_grafite"]},
    "placa_base": {"2_grafite": ["placa_base"], "3_laranja": ["emblema_e_textos"]},
}
# a ordem define o slot de filamento; mesmas cores das outras duas maquetes
PALETTE = [("1_branco", "Branco", "#EDEFEE"),
           ("2_grafite", "Grafite", "#33373B"),
           ("3_laranja", "Laranja", "#E8712B"),
           ("4_vermelho", "Vermelho", "#C9312E")]
flip = trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0])


def placed(name, obj):
    e = parts[name].copy()
    e.apply_transform(TO_Z_UP)
    if obj == "weg_tampa":
        e.apply_transform(flip)
    return e


objects = []
for obj, groups in COLOR_GROUPS.items():
    objects.append((obj, [(color, trimesh.util.concatenate([placed(n, obj) for n in names]))
                          for color, names in groups.items()]))

# placa numa fileira, corpo e tampa na outra: mesa compacta, longe da faixa
# reservada ao bico esquerdo nas impressoras de dois bicos
place_in_rows(objects, [["weg_corpo", "weg_tampa"], ["placa_base"]])

slots = write_3mf("miniatura_weg_multicor.3mf", "Miniatura WEG BESS 1:25", objects, PALETTE)
print("filamentos:", ", ".join(f"{k} = {v}" for k, v in slots.items()))
print("arquivos gravados")
