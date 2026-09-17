"""Miniatura de mesa: painel elétrico auto-sustentado CCR, escala 1:20, para cúpula de acrílico
de 90 x 90 x 110 mm internos.

Referência real: quadro auto-sustentado de 800 (L) x 2000 (A) x 600 (P) mm com rodapé de 100 mm.
Em 1:20 -> 40 x 100 x 30 mm. Com a placa de base de 3 mm, o conjunto tem 103 mm de altura,
praticamente a mesma da miniatura do PowerStack, para as duas formarem par.

Peças (impressão sem suporte):
  corpo  - casca oca aberta em cima, parede 1,6 mm, fundo 2,0 mm; imprime em pé
  tampa  - teto com aba de encaixe; imprime de cabeça para baixo
  placa  - base de 84 x 84 x 3 mm com rebaixo e textos; imprime deitada

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


def lying_text(txt, cap, cz, max_width, height=0.6, back=False):
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

# Porta: rasgo de contorno
DX0, DX1, DY0, DY1 = 2.0, W - 2.0, PLINTH + 1.5, BODY_TOP - 2.0
door_o = rbox(DX1 - DX0, DY1 - DY0, GROOVE, DX0, DY0, D - GROOVE)
door_i = rbox(DX1 - DX0 - 2 * GROOVE, DY1 - DY0 - 2 * GROOVE, GROOVE + 1,
              DX0 + GROOVE, DY0 + GROOVE, D - GROOVE - 0.5)
body = body.difference(door_o.difference(door_i))

# Visor do amperímetro / IHM: bolso na porta
VIS_X0, VIS_X1, VIS_Y0, VIS_Y1 = 8.0, 32.0, 62.0, 75.0
body = body.difference(rbox(VIS_X1 - VIS_X0, VIS_Y1 - VIS_Y0, 0.8, VIS_X0, VIS_Y0, D - 0.8))

# Maçaneta escamoteável: bolso vertical à direita
HAN_X0, HAN_Y0, HAN_W, HAN_H = W - 7.0, 30.0, 4.5, 16.0
body = body.difference(rbox(HAN_W, HAN_H, 0.9, HAN_X0, HAN_Y0, D - 0.9))

# Venezianas de ventilação na parte baixa da porta
LV_X0, LV_X1, LV_Y0, LV_Y1 = 6.0, W - 10.0, 10.0, 27.0
louvers = []
y = LV_Y0
while y <= LV_Y1:
    louvers.append(rbox(LV_X1 - LV_X0, 1.3, 0.6, LV_X0, y, D - 0.6))
    y += 2.6
body = body.difference(trimesh.util.concatenate(louvers))

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

# ---------- detalhes ----------
blue, dark, red = [], [], []

# símbolo ccr na porta
blue.append(on_front(ccr_mesh(width=28.0, height_relief=RELIEF + SINK), W / 2, 86.0))

# placa do visor
blue.append(rbox(VIS_X1 - VIS_X0 - 1.6, VIS_Y1 - VIS_Y0 - 1.6, 1.0,
                 VIS_X0 + 0.8, VIS_Y0 + 0.8, D - 0.8))

# alavanca da maçaneta
dark.append(rbox(2.0, HAN_H - 3.0, 0.8, HAN_X0 + 1.25, HAN_Y0 + 1.5, D - 0.9))

# dobradiças na aresta esquerda
for cy in (16.0, 52.0, 86.0):
    h = rbox(2.4, 6.0, 1.2, 1.4, cy - 3.0, D - SINK)
    dark.append(h)

# sinaleiros com aro, chave seletora e botão de emergência
for i, cx in enumerate((9.0, 14.0, 19.0)):
    bez = cylinder(radius=1.8, height=0.6, sections=28).difference(
        cylinder(radius=1.25, height=1.0, sections=28))
    bez.apply_translation([cx, 53.0, D - SINK + 0.3])
    dark.append(bez)
    lamp = cylinder(radius=1.25, height=0.9, sections=28)
    lamp.apply_translation([cx, 53.0, D - SINK + 0.45])
    (red if i == 0 else dark).append(lamp)
sel = cylinder(radius=1.6, height=1.2, sections=28)
sel.apply_translation([25.0, 53.0, D - SINK + 0.6])
dark.append(sel)
stop_base = cylinder(radius=3.2, height=0.6, sections=36)
stop_base.apply_translation([W - 8.0, 53.0, D - SINK + 0.3])
dark.append(stop_base)
stop = cylinder(radius=2.6, height=1.8, sections=36)
stop.apply_translation([W - 8.0, 53.0, D - SINK + 0.9])
red.append(stop)

detail_blue = trimesh.util.concatenate(blue)
detail_dark = trimesh.util.concatenate(dark)
detail_red = trimesh.util.concatenate(red)

# ---------- placa de base para a cúpula ----------
px0, pz0 = (W - PLATE_S) / 2, (D - PLATE_S) / 2
plate = profile_prism(rounded_rect(px0, pz0, px0 + PLATE_S, pz0 + PLATE_S, 4.0), -PLATE_T, 0)
plate = plate.difference(profile_prism(outer2d.buffer(0.2, join_style=1), -0.8, 0.01))
plate_txt = trimesh.util.concatenate([
    lying_text("CCR ENGENHARIA", 5.0, D + 8.0, PLATE_S - 12),
    lying_text("PAINÉIS ELÉTRICOS · AUTOMAÇÃO E CONTROLE", 2.6, D + 16.5, PLATE_S - 12),
    lying_text("FÓRUM BESS 2026 · ABEE-MT", 2.6, pz0 + 9.0, PLATE_S - 12, back=True),
])

# ---------- exportação ----------
parts = {
    "corpo_cinza_claro": body_light,
    "rodape_escuro": plinth,
    "tampa_escura": cap,
    "detalhes_escuros": detail_dark,
    "detalhes_azuis": detail_blue,
    "botao_vermelho": detail_red,
    "placa_base": plate,
    "texto_placa": plate_txt,
}
for name, m in parts.items():
    m.merge_vertices()
    m.fix_normals()
    print(f"{name:20s} watertight={m.is_watertight}  volume={m.volume:8.0f} mm³")

TO_Z_UP = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])

body_stl = body_light.union(plinth).union(detail_dark).union(detail_blue).union(detail_red)
body_stl.apply_transform(TO_Z_UP)
body_stl.merge_vertices()
print(f"{'stl_corpo':20s} watertight={body_stl.is_watertight}  volume={body_stl.volume:8.0f} mm³"
      f"  medidas={np.round(body_stl.extents, 1)}")
body_stl.export("miniatura_painel_ccr_corpo.stl")

cap_stl = cap.copy()
cap_stl.apply_transform(TO_Z_UP)
cap_stl.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0]))
cap_stl.apply_translation([0, -cap_stl.bounds[0][1], -cap_stl.bounds[0][2]])
cap_stl.merge_vertices()
print(f"{'stl_tampa':20s} watertight={cap_stl.is_watertight}  volume={cap_stl.volume:8.0f} mm³"
      f"  medidas={np.round(cap_stl.extents, 1)}")
cap_stl.export("miniatura_painel_ccr_tampa.stl")

plate_stl = plate.union(plate_txt)
plate_stl.apply_transform(TO_Z_UP)
plate_stl.apply_translation([0, 0, -plate_stl.bounds[0][2]])
plate_stl.merge_vertices()
print(f"{'stl_placa':20s} watertight={plate_stl.is_watertight}  volume={plate_stl.volume:8.0f} mm³"
      f"  medidas={np.round(plate_stl.extents, 1)}")
plate_stl.export("miniatura_painel_ccr_placa.stl")

# ---------- 3MF: três objetos, cada um agrupado em 4 cores ----------
import zipfile
from xml.sax.saxutils import escape

COLOR_GROUPS = {
    "painel_corpo": {"1_cinza_claro": ["corpo_cinza_claro"],
                     "2_cinza_escuro": ["rodape_escuro", "detalhes_escuros"],
                     "3_azul_ccr": ["detalhes_azuis"],
                     "4_vermelho": ["botao_vermelho"]},
    "painel_tampa": {"2_cinza_escuro": ["tampa_escura"]},
    "placa_base":   {"2_cinza_escuro": ["placa_base"], "3_azul_ccr": ["texto_placa"]},
}
flip = trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0])


def mesh_xml(obj_id, name, m):
    v = "".join(f'<vertex x="{x:.3f}" y="{y:.3f}" z="{z:.3f}"/>' for x, y, z in m.vertices)
    t = "".join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in m.faces)
    return (f'<object id="{obj_id}" name="{escape(name)}" type="model">'
            f'<mesh><vertices>{v}</vertices><triangles>{t}</triangles></mesh></object>')


def placed(name, obj):
    e = parts[name].copy()
    e.apply_transform(TO_Z_UP)
    if obj == "painel_tampa":
        e.apply_transform(flip)
    return e


cb = trimesh.util.concatenate([placed(n, "painel_tampa")
                               for g in COLOR_GROUPS["painel_tampa"].values() for n in g]).bounds
OBJ_XFORM = {"painel_corpo": (0, 0, 0),
             "painel_tampa": (W + 25, -cb[0][1], -cb[0][2]),
             "placa_base": (-(PLATE_S + 25), 0, PLATE_T)}

objs, next_id, assemblies, items = "", 1, "", ""
for obj, groups in COLOR_GROUPS.items():
    comp_ids = []
    for color, names in groups.items():
        m = trimesh.util.concatenate([placed(n, obj) for n in names])
        objs += mesh_xml(next_id, f"{obj}__{color}", m)
        comp_ids.append(next_id)
        next_id += 1
    tx, ty, tz = OBJ_XFORM[obj]
    comps = "".join(
        f'<component objectid="{i}" transform="1 0 0 0 1 0 0 0 1 {tx:.3f} {ty:.3f} {tz:.3f}"/>'
        for i in comp_ids)
    assemblies += (f'<object id="{next_id}" name="{obj}" type="model">'
                   f'<components>{comps}</components></object>')
    items += f'<item objectid="{next_id}"/>'
    next_id += 1

model_xml = ('<?xml version="1.0" encoding="UTF-8"?>'
             '<model unit="millimeter" xml:lang="en-US" '
             'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
             '<metadata name="Title">Miniatura Painel CCR 1:20</metadata>'
             f'<resources>{objs}{assemblies}</resources><build>{items}</build></model>')
content_types = ('<?xml version="1.0" encoding="UTF-8"?>'
                 '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                 '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                 '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')
rels = ('<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Target="/3D/3dmodel.model" Id="rel0" '
        'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
with zipfile.ZipFile("miniatura_painel_ccr_multicor.3mf", "w", zipfile.ZIP_DEFLATED) as zf:
    zf.writestr("[Content_Types].xml", content_types)
    zf.writestr("_rels/.rels", rels)
    zf.writestr("3D/3dmodel.model", model_xml)

# ---------- dados para o visualizador (Y para cima, montado) ----------
import json
VIEW_GROUPS = {
    "cinza_claro": ["corpo_cinza_claro"],
    "cinza_escuro": ["rodape_escuro", "tampa_escura", "detalhes_escuros", "placa_base"],
    "azul_ccr": ["detalhes_azuis", "texto_placa"],
    "vermelho": ["botao_vermelho"],
}
out = {}
for color, names in VIEW_GROUPS.items():
    m = trimesh.util.concatenate([parts[n] for n in names])
    out[color] = {"v": np.round(m.vertices, 2).flatten().tolist(), "f": m.faces.flatten().tolist()}
open("mesh_data_painel_mini.js", "w").write("const MESH_DATA=" + json.dumps(out, separators=(",", ":")) + ";")
print("arquivos gravados")
