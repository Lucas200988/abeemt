"""Chaveiro em formato de painel elétrico auto-sustentado - CCR Engenharia.

Referência real: quadro auto-sustentado padrão de 800 (L) x 2000 (A) x 600 (P) mm,
com rodapé de 100 mm. Escala 1:37 -> 21,6 x 54,1 x 16,2 mm (mesma altura do chaveiro BESS,
que está em 1:41, para os dois formarem par).

Frente: porta com rasgo de contorno, dobradiças à esquerda, maçaneta escamoteável à direita,
símbolo "ccr" em relevo (vetorizado do arquivo oficial), visor do amperímetro, sinaleiros,
botão de emergência e área de venezianas de ventilação. Rodapé e teto escuros, argola no topo.

Eixos de construção: X = largura, Y = altura, Z = profundidade (frente em +Z).
Exporta com Z para cima. Impressão em pé, sem suportes.
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
SCALE = 37.0
W, H, D = 800 / SCALE, 2000 / SCALE, 600 / SCALE      # 21,6 x 54,1 x 16,2
PLINTH = 100 / SCALE                                   # rodapé de 100 mm -> 2,7
ROOF = 2.0                                             # teto escuro
RELIEF = 0.8                                           # relevo dos detalhes
SINK = 0.05                                            # penetração do relevo na parede
GROOVE = 0.4                                           # profundidade dos rasgos
FONT = FontProperties(fname="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
LOGO_PNG = "/home/user/abeemt/nl/ccr.png"


def rbox(w, h, d, x=0, y=0, z=0):
    b = box(extents=[w, h, d])
    b.apply_translation([x + w / 2, y + h / 2, z + d / 2])
    return b


# ---------- símbolo "ccr" vetorizado do arquivo oficial ----------
def ccr_shape(cache="ccr_shape.pkl"):
    if os.path.exists(cache):
        return pickle.load(open(cache, "rb"))
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from PIL import Image
    a = np.array(Image.open(LOGO_PNG).convert("RGBA"))
    mask = (a[:, :, 3] > 110).astype(float)[:, :460]      # recorta só o símbolo
    ys, xs = np.nonzero(mask > 0.5)
    mask = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    segs = plt.contour(np.pad(mask, 2), levels=[0.5]).allsegs[0]
    polys = sorted((Polygon(s).buffer(0) for s in segs if len(s) >= 4),
                   key=lambda p: p.area, reverse=True)[:3]   # as três letras; o resto é "eng.br"
    shape = unary_union([p.simplify(1.5) for p in polys])
    shape = affinity.scale(shape, 1, -1, origin="center")     # imagem tem Y para baixo
    assert len(shape.geoms) == 3, f"esperava 3 letras, achei {len(shape.geoms)}"
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


# ---------- texto ----------
def text_flat(txt, cap_height, height, max_width=None, fatten=0.15):
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


def on_back(m, cx, cy):
    m.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [0, 1, 0]))
    m.apply_translation([cx, cy, SINK])
    return m


def text_side_vertical(txt, cap, cy, side, max_len=None):
    """Texto em relevo na lateral, lido de baixo para cima."""
    m = text_flat(txt, cap, RELIEF, max_width=max_len)
    m.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0, 0, 1]))
    if side == "right":
        m.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0]))
        m.apply_translation([W - SINK, cy, D / 2])
    else:
        m.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [0, 1, 0]))
        m.apply_translation([SINK, cy, D / 2])
    return m


# ---------- corpo do painel ----------
body = rbox(W, H - ROOF - PLINTH, D, 0, PLINTH, 0)

# Porta: rasgo de contorno
DX0, DX1 = 1.2, W - 1.2
DY0, DY1 = PLINTH + 1.2, H - ROOF - 1.2
door_o = rbox(DX1 - DX0, DY1 - DY0, GROOVE, DX0, DY0, D - GROOVE)
door_i = rbox(DX1 - DX0 - 2 * GROOVE, DY1 - DY0 - 2 * GROOVE, GROOVE + 1,
              DX0 + GROOVE, DY0 + GROOVE, D - GROOVE - 0.5)
body = body.difference(door_o.difference(door_i))

# Venezianas de ventilação (parte baixa da porta)
LV_X0, LV_X1, LV_Y0, LV_Y1 = 4.0, W - 4.6, 9.5, 18.0
louvers = []
y = LV_Y0
while y <= LV_Y1:
    louvers.append(rbox(LV_X1 - LV_X0, 0.75, 0.5, LV_X0, y, D - 0.5))
    y += 1.7
body = body.difference(trimesh.util.concatenate(louvers))

# Visor do amperímetro: bolso retangular
VIS_X0, VIS_X1, VIS_Y0, VIS_Y1 = 4.6, W - 4.6, 36.5, 41.5
body = body.difference(rbox(VIS_X1 - VIS_X0, VIS_Y1 - VIS_Y0, 0.7, VIS_X0, VIS_Y0, D - 0.7))

# Maçaneta escamoteável: bolso vertical à direita
HAN_X0, HAN_Y0, HAN_W, HAN_H = W - 3.9, 21.0, 2.4, 8.0
body = body.difference(rbox(HAN_W, HAN_H, 0.8, HAN_X0, HAN_Y0, D - 0.8))

# Emenda dos painéis laterais e do fundo
for x in (0.0, W - GROOVE):
    body = body.difference(rbox(GROOVE + 0.01, H - ROOF - PLINTH - 4, 0.6, x - 0.005, PLINTH + 2, D * 0.45))

# ---------- rodapé, teto e argola (escuros) ----------
plinth = rbox(W, PLINTH, D, 0, 0, 0)
roof = rbox(W, ROOF, D, 0, H - ROOF, 0)
RING_RO, RING_RI, RING_T = 4.5, 2.2, 3.0
ring = cylinder(radius=RING_RO, height=RING_T, sections=48).difference(
    cylinder(radius=RING_RI, height=RING_T + 2, sections=48))
ring.apply_translation([W / 2, H + RING_RO - 1.5, D / 2])
dark_struct = plinth.union(roof).union(ring)

# ---------- detalhes ----------
blue, dark, red = [], [], []

# símbolo ccr em relevo na porta
logo = ccr_mesh(width=15.0, height_relief=RELIEF + SINK)
blue.append(on_front(logo, W / 2, 46.3))

# placa do visor (azul, encaixada no bolso)
blue.append(rbox(VIS_X1 - VIS_X0 - 0.8, VIS_Y1 - VIS_Y0 - 0.8, 0.5,
                 VIS_X0 + 0.4, VIS_Y0 + 0.4, D - 0.7))

# alavanca da maçaneta
dark.append(rbox(1.1, HAN_H - 1.6, 0.7, HAN_X0 + 0.65, HAN_Y0 + 0.8, D - 0.8))

# dobradiças na aresta esquerda da porta
for cy in (12.0, 27.5, 43.0):
    dark.append(rbox(1.6, 3.0, 0.7, 0.9, cy - 1.5, D - SINK))

# sinaleiros e botão de emergência
for i, cx in enumerate((5.6, 7.8, 10.0)):
    lamp = cylinder(radius=0.75, height=0.6, sections=24)
    lamp.apply_translation([cx, 32.5, D - SINK + 0.3])
    (red if i == 0 else dark).append(lamp)
stop = cylinder(radius=1.35, height=1.0, sections=32)
stop.apply_translation([W - 4.6, 32.3, D - SINK + 0.5])
red.append(stop)
stop_ring = cylinder(radius=1.9, height=0.5, sections=32).difference(
    cylinder(radius=1.35, height=0.8, sections=32))
stop_ring.apply_translation([W - 4.6, 32.3, D - SINK + 0.25])
dark.append(stop_ring)

# textos: laterais com a atuação da CCR, fundo com o evento
dark.append(text_side_vertical("PAINÉIS ELÉTRICOS", 4.2, 30.0, "right", max_len=H - 14))
dark.append(text_side_vertical("MONTAGENS INDUSTRIAIS", 4.2, 30.0, "left", max_len=H - 14))
dark.append(on_back(text_flat("FÓRUM BESS", 3.2, RELIEF + SINK, max_width=W - 4), W / 2, 33.0))
dark.append(on_back(text_flat("2026", 6.0, RELIEF + SINK, max_width=W - 6), W / 2, 25.0))

detail_blue = trimesh.util.concatenate(blue)
detail_dark = trimesh.util.concatenate(dark)
detail_red = trimesh.util.concatenate(red)

# ---------- exportação ----------
parts = {
    "1_cinza_claro_corpo": body,
    "2_cinza_escuro": dark_struct.union(detail_dark),
    "3_azul_ccr": detail_blue,
    "4_vermelho": detail_red,
}
for name, m in parts.items():
    m.merge_vertices()
    m.fix_normals()
    print(f"{name:22s} watertight={m.is_watertight}  volume={m.volume:7.0f} mm³")

TO_Z_UP = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])
export_parts = {}
for name, m in parts.items():
    e = m.copy()
    e.apply_transform(TO_Z_UP)
    export_parts[name] = e

single = parts["1_cinza_claro_corpo"].union(parts["2_cinza_escuro"]).union(
    parts["3_azul_ccr"]).union(parts["4_vermelho"])
single.apply_transform(TO_Z_UP)
single.merge_vertices()
print(f"{'stl_uma_cor':22s} watertight={single.is_watertight}  volume={single.volume:7.0f} mm³"
      f"  medidas={np.round(single.extents, 1)}")
single.export("chaveiro_painel_ccr.stl")

import zipfile
from xml.sax.saxutils import escape


import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import bambu3mf

# a ordem define o slot de filamento; mesmas 4 cores das maquetes
PALETTE = [("cinza_claro", "Branco", "#EDEFEE"),
           ("cinza_escuro", "Grafite", "#33373B"),
           ("laranja", "Laranja", "#E8712B"),
           ("vermelho", "Vermelho", "#C9312E")]


def write_3mf(filename, part_dict, title, colors):
    """`colors` dá a cor de cada peça, na mesma ordem de part_dict."""
    assert len(colors) == len(part_dict)
    objects = [("chaveiro_painel_ccr", list(zip(colors, part_dict.values())))]
    return bambu3mf.write_3mf(filename, title, objects, PALETTE, precision=4)


# mesmas 4 cores de filamento das maquetes, para comprar um jogo só
write_3mf("chaveiro_painel_ccr_4cores.3mf", export_parts, "Chaveiro Painel CCR",
          ["cinza_claro", "cinza_escuro", "laranja", "vermelho"])
two = {
    "1_cinza_claro_corpo_e_detalhes": trimesh.util.concatenate(
        [export_parts["1_cinza_claro_corpo"], export_parts["3_azul_ccr"], export_parts["4_vermelho"]]),
    "2_cinza_escuro": export_parts["2_cinza_escuro"],
}
write_3mf("chaveiro_painel_ccr_2cores.3mf", two, "Chaveiro Painel CCR (2 cores)",
          ["cinza_claro", "cinza_escuro"])

import json
out = {}
for name, m in parts.items():
    out[name] = {"v": np.round(m.vertices, 3).flatten().tolist(), "f": m.faces.flatten().tolist()}
open("mesh_data_painel.js", "w").write("const MESH_DATA=" + json.dumps(out, separators=(",", ":")) + ";")
print("arquivos gravados")
