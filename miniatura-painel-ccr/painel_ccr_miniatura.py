"""Miniatura de mesa: painel elétrico auto-sustentado CCR, escala 1:20, para cúpula de acrílico
de 90 x 90 x 110 mm internos.

Referência real: quadro auto-sustentado de 800 (L) x 2000 (A) x 600 (P) mm com rodapé de 100 mm.
Em 1:20 -> 40 x 100 x 30 mm. Com a placa de base de 3 mm, o conjunto tem 103 mm de altura,
praticamente a mesma da miniatura do PowerStack, para as duas formarem par.

Porta limpa: só o símbolo da CCR. Três filamentos, os mesmos da maquete do BESS.

Peças (impressão sem suporte):
  corpo  - casca oca aberta em cima, parede 1,6 mm, fundo 2,0 mm; imprime em pé
  tampa  - teto com aba de encaixe; imprime de cabeça para baixo
  placa  - base de 84 x 84 x 3 mm; textos com 1,5 mm de relevo para ler mesmo em uma cor

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
SCALE = 20.0
W, H, D = 800 / SCALE, 2000 / SCALE, 600 / SCALE     # 40 x 100 x 30
PLINTH = 100 / SCALE                                  # rodapé de 100 mm -> 5,0
R_CORNER = 1.2
WALL, FLOOR = 1.6, 2.0
CAP_T, CAP_LIP, CAP_CLEAR = 3.0, 4.0, 0.25
BODY_TOP = H - CAP_T
RELIEF, SINK = 1.0, 0.05
GROOVE = 0.5
PLATE_S, PLATE_T = 84.0, 3.0
FONT = FontProperties(fname="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
LOGO_PNG = "/home/user/abeemt/nl/ccr.png"


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


# ---------- símbolo "ccr" vetorizado do arquivo oficial ----------
def ccr_shape(cache="ccr_shape.pkl"):
    if os.path.exists(cache):
        return pickle.load(open(cache, "rb"))
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from PIL import Image
    a = np.array(Image.open(LOGO_PNG).convert("RGBA"))
    mask = (a[:, :, 3] > 110).astype(float)[:, :460]
    ys, xs = np.nonzero(mask > 0.5)
    mask = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    segs = plt.contour(np.pad(mask, 2), levels=[0.5]).allsegs[0]
    polys = sorted((Polygon(s).buffer(0) for s in segs if len(s) >= 4),
                   key=lambda p: p.area, reverse=True)[:3]
    shape = unary_union([p.simplify(1.5) for p in polys])
    shape = affinity.scale(shape, 1, -1, origin="center")
    assert len(shape.geoms) == 3
    pickle.dump(shape, open(cache, "wb"))
    return shape


def ccr_mesh(width, height_relief):
    s = ccr_shape()
    minx, miny, maxx, maxy = s.bounds
    k = width / (maxx - minx)
    s = affinity.scale(s, k, k, origin=(minx, miny))
    m = trimesh.util.concatenate([extrude_polygon(g, height_relief) for g in s.geoms])
    b = m.bounds
    m.apply_translation([-(b[0][0] + b[1][0]) / 2, -(b[0][1] + b[1][1]) / 2, 0])
    return m


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


def lying_emblem(diam, cz, height=1.5):
    """Emblema da ABEE-MT deitado na placa: raio dentro de um anel."""
    r_out = diam / 2
    ring = Point(0, 0).buffer(r_out, 64).difference(Point(0, 0).buffer(r_out - 0.9, 64))
    h = diam * 0.72
    bolt = Polygon([(0.55, 1.0), (0.10, 0.42), (0.42, 0.42), (0.30, 0.0),
                    (0.90, 0.58), (0.58, 0.58), (0.70, 1.0)])
    bolt = affinity.translate(affinity.scale(bolt, h, h, origin=(0, 0)), -0.5 * h, -0.5 * h)
    shape = unary_union([ring, bolt.buffer(0.05, join_style=2)])
    geoms = list(shape.geoms) if hasattr(shape, "geoms") else [shape]
    m = trimesh.util.concatenate([extrude_polygon(g, height) for g in geoms])
    m.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    m.apply_translation([W / 2, -0.05, cz])
    return m


def lying_text(txt, cap, cz, max_width, height=1.5, back=False):
    """Texto deitado na placa de base, relevo para cima."""
    m = text_flat(txt, cap, height, max_width=max_width)
    m.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    if back:
        m.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [0, 1, 0]))
    m.apply_translation([W / 2, -0.05, cz])
    return m


# ---------- corpo: casca oca aberta em cima ----------
outer2d = rounded_rect(0, 0, W, D, R_CORNER)
inner2d = rounded_rect(WALL, WALL, W - WALL, D - WALL, max(R_CORNER - WALL, 0.6))
body = profile_prism(outer2d, 0, BODY_TOP).difference(profile_prism(inner2d, FLOOR, BODY_TOP + 1))

# ---------- porta como peça separada, impressa deitada ----------
# O símbolo numa parede vertical obrigava a impressora a depositar, camada após
# camada, uma ilha solta de segunda cor logo depois de uma troca de filamento —
# quase 100 camadas, duas trocas em cada. Com a porta deitada, o símbolo vira uma
# mancha plana numa superfície horizontal, que é a melhor superfície que a máquina
# tem, e a troca de cor acontece em cinco camadas no total. A fresta em volta da
# porta é realista: painel de verdade tem.
DX0, DX1, DY0, DY1 = 2.0, W - 2.0, PLINTH + 1.5, BODY_TOP - 2.0
PORTA_T, BOLSO_PROF, PORTA_FOLGA = 2.0, 1.0, 0.25

# reforço atrás da porta, para o bolso não afinar a parede de 1,6 mm
body = body.union(rbox(DX1 - DX0 + 3.0, DY1 - DY0 + 3.0, BOLSO_PROF,
                       DX0 - 1.5, DY0 - 1.5, D - WALL - BOLSO_PROF))
# bolso onde a porta encaixa
body = body.difference(rbox(DX1 - DX0 + 2 * PORTA_FOLGA, DY1 - DY0 + 2 * PORTA_FOLGA,
                            BOLSO_PROF + 0.5, DX0 - PORTA_FOLGA, DY0 - PORTA_FOLGA,
                            D - BOLSO_PROF))

# chapa da porta: fica 1,0 mm saliente, como a folha de um quadro real
PZ0, PZ1 = D - BOLSO_PROF, D - BOLSO_PROF + PORTA_T
porta = rbox(DX1 - DX0, DY1 - DY0, PORTA_T, DX0, DY0, PZ0)

# Maçaneta escamoteável: bolso vertical à direita, com a alavanca dentro
HAN_X0, HAN_Y0, HAN_W, HAN_H = W - 7.0, 30.0, 4.5, 16.0
porta = porta.difference(rbox(HAN_W, HAN_H, 0.9, HAN_X0, HAN_Y0, PZ1 - 0.9))
porta = porta.union(rbox(2.0, HAN_H - 3.0, 0.7, HAN_X0 + 1.25, HAN_Y0 + 1.5, PZ1 - 0.9))

# Venezianas de ventilação na parte baixa
LV_X0, LV_X1, LV_Y0, LV_Y1 = 6.0, W - 10.0, 10.0, 27.0
louvers = []
y = LV_Y0
while y <= LV_Y1:
    louvers.append(rbox(LV_X1 - LV_X0, 1.3, 0.6, LV_X0, y, PZ1 - 0.6))
    y += 2.6
porta = porta.difference(trimesh.util.concatenate(louvers))

# Dobradiças em relevo, na cor da própria porta: quem as desenha é a sombra
for cy in (16.0, 52.0, 86.0):
    porta = porta.union(rbox(2.4, 6.0, 1.0, DX0 - 0.6, cy - 3.0, PZ1 - SINK))

# Símbolo da CCR rente à face da porta: bolso de 1,0 mm preenchido pela peça grafite
LOGO_W, LOGO_PROF, LOGO_CY = 28.0, 1.0, 80.0
bolso_logo = ccr_mesh(width=LOGO_W, height_relief=LOGO_PROF + 0.5)
bolso_logo.apply_translation([W / 2, LOGO_CY, PZ1 - LOGO_PROF])
porta = porta.difference(bolso_logo)
porta_logo = ccr_mesh(width=LOGO_W, height_relief=LOGO_PROF + SINK)
porta_logo.apply_translation([W / 2, LOGO_CY, PZ1 - LOGO_PROF - SINK])

# Fundo: contorno da chapa de fecho traseira e parafusos nos cantos
BK = 3.0
back_o = rbox(W - 2 * BK, BODY_TOP - PLINTH - 2 * BK, GROOVE, BK, PLINTH + BK, -0.005)
back_i = rbox(W - 2 * BK - 2 * GROOVE, BODY_TOP - PLINTH - 2 * BK - 2 * GROOVE, GROOVE + 1,
              BK + GROOVE, PLINTH + BK + GROOVE, -0.5)
body = body.difference(back_o.difference(back_i))
for sx in (BK + 2.2, W - BK - 2.2):
    for sy in (PLINTH + BK + 2.2, BODY_TOP - BK - 2.2):
        s = cylinder(radius=0.7, height=1.0, sections=20)   # eixo em Z, fura a face traseira
        s.apply_translation([sx, sy, 0.0])
        body = body.difference(s)

# Emenda dos painéis laterais
for x in (0.0, W - GROOVE):
    body = body.difference(rbox(GROOVE + 0.01, BODY_TOP - PLINTH - 6, 1.2,
                                x - 0.005, PLINTH + 3, D * 0.45))

# Rodapé escuro: mesma casca, cor separada
plinth = body.intersection(rbox(W + 2, PLINTH + 1.05, D + 2, -1, -1, -1))
body_light = body.difference(rbox(W + 2, PLINTH + 1, D + 2, -1, -1, -1))

# ---------- tampa com aba de encaixe ----------
cap = profile_prism(outer2d, BODY_TOP, H)
lip2d = rounded_rect(WALL + CAP_CLEAR, WALL + CAP_CLEAR, W - WALL - CAP_CLEAR, D - WALL - CAP_CLEAR,
                     max(R_CORNER - WALL - CAP_CLEAR, 0.6))
cap = cap.union(profile_prism(lip2d, BODY_TOP - CAP_LIP, BODY_TOP + 0.01).difference(
    profile_prism(lip2d.buffer(-1.6, join_style=1), BODY_TOP - CAP_LIP - 1, BODY_TOP + 0.02)))
# apoios dos olhais de içamento: rebaixos rasos nos quatro cantos do teto
for ex in (5.0, W - 5.0):
    for ez in (5.0, D - 5.0):
        eye = cylinder(radius=1.6, height=1.2, sections=28)
        eye.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
        eye.apply_translation([ex, H - 0.5, ez])
        cap = cap.difference(eye)

# ---------- placa de base para a cúpula ----------
px0, pz0 = (W - PLATE_S) / 2, (D - PLATE_S) / 2
plate = profile_prism(rounded_rect(px0, pz0, px0 + PLATE_S, pz0 + PLATE_S, 4.0), -PLATE_T, 0)
# simplify tira o vértice colinear que o buffer deixa na parede do rebaixo
# (ele virava uma face de área zero na malha exportada)
plate = plate.difference(profile_prism(outer2d.buffer(0.2, join_style=1).simplify(0.001), -0.8, 0.01))
# Menos palavras, letras maiores: o que deixava a escrita ilegível era a altura
# de letra apertada por muitas linhas, não o relevo. A faixa de trás passou de
# três linhas de 3,2/3,4 mm para uma única linha bem maior.
plate_marks = trimesh.util.concatenate([
    # faixa da frente: o homenageado
    lying_text("CCR MONTAGENS INDUSTRIAIS", 4.0, 38.5, 72),
    lying_text("FÓRUM BESS 2026", 5.2, 47.0, 72),
    # faixa de trás: quem homenageia. Duas linhas curtas em vez de uma longa:
    # numa linha só, "HOMENAGEM ABEE-MT" bate no limite de largura da placa e a
    # letra cai para 4,7 mm; quebrada em duas, sobe para 6 mm.
    lying_emblem(9.0, -21.3),
    lying_text("ABEE-MT", 6.5, -12.05, 72, back=True),
    lying_text("HOMENAGEM", 5.5, -4.55, 72, back=True),
])

# ---------- exportação ----------
parts = {
    "corpo_branco": body_light,
    "rodape_grafite": plinth,
    "tampa_grafite": cap,
    "porta_branca": porta,
    "porta_logo_grafite": porta_logo,
    "placa_base": plate,
    "emblema_e_textos": plate_marks,
}
for name, m in parts.items():
    m.merge_vertices()
    m.fix_normals()
    print(f"{name:20s} watertight={m.is_watertight}  volume={m.volume:8.0f} mm³")

TO_Z_UP = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])

body_stl = body_light.union(plinth)
body_stl.apply_transform(TO_Z_UP)
body_stl.merge_vertices()
print(f"{'stl_corpo':20s} watertight={body_stl.is_watertight}  volume={body_stl.volume:8.0f} mm³"
      f"  medidas={np.round(body_stl.extents, 1)}")
body_stl.export("miniatura_painel_ccr_corpo.stl")

# a porta sai deitada, com a face do símbolo para cima
porta_stl = porta.union(porta_logo)
porta_stl.apply_translation([0, 0, -porta_stl.bounds[0][2]])
porta_stl.merge_vertices()
print(f"{'stl_porta':20s} watertight={porta_stl.is_watertight}  volume={porta_stl.volume:8.0f} mm³"
      f"  medidas={np.round(porta_stl.extents, 1)}")
porta_stl.export("miniatura_painel_ccr_porta.stl")

cap_stl = cap.copy()
cap_stl.apply_transform(TO_Z_UP)
cap_stl.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0]))
cap_stl.apply_translation([0, -cap_stl.bounds[0][1], -cap_stl.bounds[0][2]])
cap_stl.merge_vertices()
print(f"{'stl_tampa':20s} watertight={cap_stl.is_watertight}  volume={cap_stl.volume:8.0f} mm³"
      f"  medidas={np.round(cap_stl.extents, 1)}")
cap_stl.export("miniatura_painel_ccr_tampa.stl")

plate_stl = plate.union(plate_marks)
plate_stl.apply_transform(TO_Z_UP)
plate_stl.apply_translation([0, 0, -plate_stl.bounds[0][2]])
plate_stl.merge_vertices()
print(f"{'stl_placa':20s} watertight={plate_stl.is_watertight}  volume={plate_stl.volume:8.0f} mm³"
      f"  medidas={np.round(plate_stl.extents, 1)}")
plate_stl.export("miniatura_painel_ccr_placa.stl")

# ---------- 3MF: três objetos, cada peça já no seu filamento ----------
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from bambu3mf import write_3mf, place_in_rows

COLOR_GROUPS = {
    "painel_corpo": {"1_branco": ["corpo_branco"], "2_grafite": ["rodape_grafite"]},
    "painel_porta": {"1_branco": ["porta_branca"], "2_grafite": ["porta_logo_grafite"]},
    "painel_tampa": {"2_grafite": ["tampa_grafite"]},
    "placa_base":   {"2_grafite": ["placa_base"], "3_laranja": ["emblema_e_textos"]},
}
# a ordem define o slot de filamento: branco = 1, grafite = 2, laranja = 3
PALETTE = [("1_branco", "Branco", "#EDEFEE"),
           ("2_grafite", "Grafite", "#33373B"),
           ("3_laranja", "Laranja", "#E8712B")]
flip = trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0])


def placed(name, obj):
    e = parts[name].copy()
    if obj == "painel_porta":
        return e          # já está deitada, símbolo para cima: é o ponto da mudança
    e.apply_transform(TO_Z_UP)
    if obj == "painel_tampa":
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
place_in_rows(objects, [["painel_corpo", "painel_tampa"], ["painel_porta"], ["placa_base"]])

slots = write_3mf("miniatura_painel_ccr_multicor.3mf", "Miniatura Painel CCR 1:20",
                  objects, PALETTE)
print("filamentos:", ", ".join(f"{k} = {v}" for k, v in slots.items()))

# ---------- dados para o visualizador (Y para cima, montado) ----------
import json
VIEW_GROUPS = {
    "branco": ["corpo_branco", "porta_branca"],
    "grafite": ["rodape_grafite", "tampa_grafite", "porta_logo_grafite", "placa_base"],
    "laranja": ["emblema_e_textos"],
}
out = {}
for color, names in VIEW_GROUPS.items():
    m = trimesh.util.concatenate([parts[n] for n in names])
    out[color] = {"v": np.round(m.vertices, 2).flatten().tolist(), "f": m.faces.flatten().tolist()}
open("mesh_data_painel_mini.js", "w").write("const MESH_DATA=" + json.dumps(out, separators=(",", ":")) + ";")
print("arquivos gravados")
