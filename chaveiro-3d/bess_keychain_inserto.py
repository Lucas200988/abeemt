"""Chaveiro em formato de gabinete BESS - Fórum BESS 2026 (versão com inserto de inox).

Proporções baseadas no WEG BSCW400 T100 B215 (1040 x 2200 x 1500 mm, L x A x P)
e no Sungrow PowerStack ST255CS-2H (1150 x 2450 x 1610 mm). Escala aproximada 1:41.
Frente no estilo WEG: duas portas, grade hexagonal na porta inferior, alças à esquerda,
botão de emergência à direita, base escura e tampa escura fina.

Eixos: X = largura, Y = altura, Z = profundidade (frente em +Z). Unidades: mm.
Impressão: em pé, apoiado na base. Sem suportes.
Abridor: inserto de inox de 36 mm (furos de fixação a 30 mm) embutido na lateral esquerda, com
cavidade em gota atrás do furo dele. Profundidade do gabinete aumentada de 34 para 44 mm para caber.
"""
import numpy as np
import trimesh
from trimesh.creation import box, cylinder, extrude_polygon
from shapely.geometry import Polygon
from matplotlib.textpath import TextPath
from matplotlib.font_manager import FontProperties

# ---------- parâmetros ----------
W, H, D = 26.0, 54.0, 44.0       # largura, altura, profundidade (44 para caber o inserto de 36 mm)
TOP_BAND, BASE_BAND = 2.0, 4.0   # faixas escuras (topo e base)
RELIEF = 0.8                     # relevo dos detalhes da frente
SINK = 0.05                      # quanto cada relevo penetra na parede, para a união ser real
GROOVE = 0.4                     # sulcos (contorno da porta, grade)
FONT = FontProperties(fname="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")


def rbox(w, h, d, x=0, y=0, z=0):
    b = box(extents=[w, h, d])
    b.apply_translation([x + w / 2, y + h / 2, z + d / 2])
    return b


def text_shape(txt):
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
    return shape


def text_flat(txt, cap_height, height, max_width=None, fatten=0.15):
    """Texto extrudado em Z (0..height), centrado na origem em XY.
    Engorda os traços em `fatten` mm por lado para nunca ficar mais fino que o bico."""
    from shapely import affinity
    shape = text_shape(txt)
    minx, miny, maxx, maxy = shape.bounds
    scale = cap_height / (maxy - miny)
    if max_width and (maxx - minx) * scale > max_width:
        scale = max_width / (maxx - minx)
    shape = affinity.scale(shape, scale, scale, origin=(0, 0))
    shape = shape.buffer(fatten, join_style=1).simplify(0.02)
    geoms = list(shape.geoms) if hasattr(shape, "geoms") else [shape]
    m = trimesh.util.concatenate([extrude_polygon(g, height) for g in geoms])
    b = m.bounds
    m.apply_translation([-(b[0][0] + b[1][0]) / 2, -(b[0][1] + b[1][1]) / 2, 0])
    return m


def text_front(txt, cap, cx, cy, max_width=None):
    m = text_flat(txt, cap, RELIEF, max_width)
    m.apply_translation([cx, cy, D - SINK])
    return m


def to_side(m, side, cy, cz):
    """Leva uma malha extrudada em Z (0..h, centrada em XY) para a lateral direita (x=W) ou esquerda (x=0)."""
    if side == "right":
        m.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0]))   # X->-Z, Z->+X
        m.apply_translation([W - SINK, cy, cz])
    else:
        m.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [0, 1, 0]))  # X->+Z, Z->-X
        m.apply_translation([SINK, cy, cz])
    return m


def to_back(m, cy):
    """Leva uma malha extrudada em Z (0..h, centrada em XY) para a face de trás (z=0), lida por trás."""
    m.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [0, 1, 0]))   # X->-X, Z->-Z
    m.apply_translation([W / 2, cy, SINK])
    return m


def text_back(txt, cap, cy, max_width=None):
    return to_back(text_flat(txt, cap, RELIEF, max_width), cy)


def text_side(txt, cap, cy, cz, side, max_width=None):
    """Texto em relevo na lateral."""
    return to_side(text_flat(txt, cap, RELIEF, max_width), side, cy, cz)


def emblem_side(height, cy, cz, side):
    """Emblema simples: raio dentro de um anel (referência ao logo da ABEE-MT)."""
    from shapely.geometry import Point
    from shapely import affinity
    bolt = Polygon([(0.55, 1.0), (0.10, 0.42), (0.42, 0.42), (0.30, 0.0),
                    (0.90, 0.58), (0.58, 0.58), (0.70, 1.0)])
    assert bolt.is_valid
    bolt = affinity.scale(bolt, height, height, origin=(0, 0))
    bolt = affinity.translate(bolt, -0.5 * height, -0.5 * height)
    r_out = height * 0.72
    ring = Point(0, 0).buffer(r_out, 64).difference(Point(0, 0).buffer(r_out - 0.9, 64))
    parts = [extrude_polygon(bolt.buffer(0.05, join_style=2), RELIEF), extrude_polygon(ring, RELIEF)]
    m = trimesh.util.concatenate(parts)
    return to_back(m, cy) if side == "back" else to_side(m, side, cy, cz)


# ---------- corpo principal (branco) ----------
body = rbox(W, H - TOP_BAND - BASE_BAND, D, 0, BASE_BAND, 0)

# Duas portas (sulcos na frente): inferior com a grade, superior com o texto
SPLIT = 23.0
def door_groove(y0, y1):
    outer = rbox(W - 3.6, y1 - y0, GROOVE, 1.8, y0, D - GROOVE)
    inner = rbox(W - 4.6, y1 - y0 - 1.0, GROOVE + 1, 2.3, y0 + 0.5, D - GROOVE - 0.5)
    return outer.difference(inner)
body = body.difference(door_groove(BASE_BAND + 1.5, SPLIT - 0.5))
body = body.difference(door_groove(SPLIT + 0.5, H - TOP_BAND - 1.5))

# Grade de ventilação hexagonal (porta inferior, deixando espaço para a alça)
holes = []
pitch, r = 1.9, 0.65
gx0, gx1 = 6.2, W - 3.8
gy0, gy1 = BASE_BAND + 3.6, SPLIT - 2.6
row, y = 0, gy0
while y <= gy1:
    x = gx0 + (pitch / 2 if row % 2 else 0)
    while x <= gx1:
        c = cylinder(radius=r, height=GROOVE * 2, sections=12)
        c.apply_translation([x, y, D])
        holes.append(c)
        x += pitch
    y += pitch * 0.866
    row += 1
body = body.difference(trimesh.util.concatenate(holes))

# ---------- texto em relevo nas laterais ----------
side_texts = [
    text_side("FÓRUM BESS", 5.2, 36.0, D / 2, "right", max_width=D - 6),
    text_side("2026", 10.0, 21.0, D / 2, "right", max_width=D - 8),
    emblem_side(12.0, 41.0, 0, "back"),
    text_back("ABEE-MT", 4.6, 26.5, max_width=W - 4),
    text_back("CUIABÁ", 4.6, 17.5, max_width=W - 4),
]
side_text_mesh = trimesh.util.concatenate(side_texts)

# ---------- abridor: inserto de inox embutido na lateral esquerda (x = 0) ----------
# Inserto: anel de 36 mm com furo em coração (~26 x 18 mm) e dois furos de fixação a 30 mm.
# Bolso raso para o anel ficar nivelado com a lateral; atrás do furo, cavidade em gota (teto a 45°,
# imprime sem suporte) para a aba da tampa entrar; furos para parafuso ou pino de fixação.
INS_D, INS_T = 36.0, 2.0                     # diâmetro e espessura do inserto (confirmar a espessura)
INS_CLEAR = 0.3                              # folga no diâmetro
INS_CY, INS_CZ = 28.0, D / 2                 # centro do inserto na lateral
SCREW_D, SCREW_SPACING, SCREW_DEPTH = 2.4, 30.0, 8.0
CAV_D, CAV_DEPTH = 30.0, 8.0                 # cavidade atrás do furo do inserto
from shapely.geometry import Point, box as sbox
pocket2d = Point(INS_CZ, INS_CY).buffer((INS_D + INS_CLEAR) / 2, 96)        # perfil no plano (z, y)
def side_cut(shape2d, x0, x1):
    """Perfil (z, y) extrudado em X, de x0 a x1."""
    m = extrude_polygon(shape2d, x1 - x0)                                     # vértices (z, y, h)
    v = m.vertices.copy()
    m.vertices = np.column_stack([v[:, 2] + x0, v[:, 1], v[:, 0]])
    m.fix_normals()
    return m
pocket = side_cut(pocket2d, -0.01, INS_T + 0.2)
# cavidade em gota: círculo + triângulo de 45° no topo
r = CAV_D / 2
teardrop2d = Point(INS_CZ, INS_CY).buffer(r, 96).union(
    Polygon([(INS_CZ - r * 0.7071, INS_CY + r * 0.7071), (INS_CZ + r * 0.7071, INS_CY + r * 0.7071), (INS_CZ, INS_CY + r * 1.4142)]))
cavity = side_cut(teardrop2d, INS_T, INS_T + CAV_DEPTH)
screws = []
for dy in (-SCREW_SPACING / 2, SCREW_SPACING / 2):
    sc = cylinder(radius=SCREW_D / 2, height=SCREW_DEPTH + 0.2, sections=24)
    sc.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0]))   # eixo em X
    sc.apply_translation([INS_T + SCREW_DEPTH / 2, INS_CY + dy, INS_CZ])
    screws.append(sc)
body = body.difference(pocket).difference(cavity).difference(trimesh.util.concatenate(screws))
assert INS_CY - (INS_D + INS_CLEAR) / 2 > 4.0 and INS_CY + (INS_D + INS_CLEAR) / 2 < H - 2.0

# ---------- faixas escuras (topo e base) + argola ----------
top_band = rbox(W, TOP_BAND, D, 0, H - TOP_BAND, 0)
base_band = rbox(W, BASE_BAND, D, 0, 0, 0)
ring_r_out, ring_r_in, ring_t = 4.5, 2.2, 3.0
ring = cylinder(radius=ring_r_out, height=ring_t, sections=48)
ring = ring.difference(cylinder(radius=ring_r_in, height=ring_t + 2, sections=48))
ring.apply_translation([W / 2, H + ring_r_out - 1.5, D / 2])   # plano XY, virada para a frente
top_band = top_band.union(ring)
bands = top_band.union(base_band)

# ---------- detalhes em relevo na frente (cor de destaque) ----------
details = [side_text_mesh]
details.append(text_front("FÓRUM", 4.5, W / 2, 47.0, max_width=W - 6))       # no lugar do logo
details.append(text_front("BESS", 4.5, W / 2, 41.0, max_width=W - 6))
details.append(text_front("2026", 7.0, W / 2, 33.0, max_width=W - 8))         # ano na porta superior
btn = cylinder(radius=1.1, height=RELIEF, sections=24)
btn.apply_translation([W - 4.4, 26.5, D - SINK + RELIEF / 2])
details.append(btn)                                                          # botão de emergência
details.append(rbox(1.2, 5.0, RELIEF, 3.2, 25.0, D - SINK))                         # alça da porta superior
details.append(rbox(1.2, 6.0, RELIEF, 3.2, 10.0, D - SINK))                         # alça da porta inferior
details_mesh = trimesh.util.concatenate(details)

# ---------- exportação ----------
parts = {"corpo_branco": body, "faixas_escuras": bands, "detalhes_relevo": details_mesh}
for name, m in parts.items():
    m.merge_vertices()
    m.fix_normals()
    print(f"{name:18s} watertight={m.is_watertight}  volume={m.volume:.0f} mm³")

# Fatiadores usam Z como vertical; o modelo foi construído com Y para cima.
# Na exportação, gira 90° em X: Y -> Z (altura), frente (+Z) -> -Y (frente da mesa).
TO_Z_UP = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])
export_parts = {}
for name, m in parts.items():
    e = m.copy()
    e.apply_transform(TO_Z_UP)
    export_parts[name] = e

single = body.union(bands).union(details_mesh)
single.apply_transform(TO_Z_UP)
single.merge_vertices()
print(f"{'stl_uma_cor':18s} watertight={single.is_watertight}  volume={single.volume:.0f} mm³")
print("dimensões (mm):", np.round(single.extents, 1))
single.export("chaveiro_forum_bess_2026_inserto.stl")

# 3MF básico (núcleo da especificação, sem extensões): três malhas e um objeto que as reúne
# como componentes. É o formato que o Bambu Studio importa como um objeto com três partes.
import zipfile
from xml.sax.saxutils import escape

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import bambu3mf

# a ordem define o slot de filamento: branco = 1, cinza escuro = 2, laranja = 3
PALETTE = [("branco", "Branco", "#EDEFEE"),
           ("cinza_escuro", "Grafite", "#33373B"),
           ("laranja", "Laranja", "#E8712B")]


def write_3mf(filename, part_dict, title, colors):
    """Um objeto com uma peça por entrada de part_dict (malhas já com Z para cima).
    `colors` dá a cor de cada peça, na mesma ordem de part_dict."""
    assert len(colors) == len(part_dict)
    objects = [("chaveiro_forum_bess_2026", list(zip(colors, part_dict.values())))]
    return bambu3mf.write_3mf(filename, title, objects, PALETTE, precision=4)

# 3 cores: corpo, faixas, detalhes (troca de filamento em quase todas as camadas)
write_3mf("chaveiro_forum_bess_2026_inserto_multicor.3mf", export_parts,
          "Chaveiro Fórum BESS 2026 inserto", ["branco", "cinza_escuro", "laranja"])
# 2 cores: textos e detalhes na cor do corpo -> só duas trocas de filamento (base e topo)
two_color = {
    "1_branco_corpo_e_textos": trimesh.util.concatenate([export_parts["corpo_branco"], export_parts["detalhes_relevo"]]),
    "2_cinza_escuro_faixas": export_parts["faixas_escuras"],
}
write_3mf("chaveiro_forum_bess_2026_inserto_2cores.3mf", two_color,
          "Chaveiro Fórum BESS 2026 inserto (2 cores)", ["branco", "cinza_escuro"])

import json
out = {}
for name, m in parts.items():
    out[name] = {"v": np.round(m.vertices, 3).flatten().tolist(), "f": m.faces.flatten().tolist()}
# inserto na posição de uso (só para o visualizador): anel com furo em coração aproximado
ring2d = Point(0, 0).buffer(INS_D / 2, 96).difference(
    Point(0, 4).buffer(9.0, 64).union(sbox(-13, -5, 13, 4)).union(Point(-6.5, 4).buffer(6.5, 64)).union(Point(6.5, 4).buffer(6.5, 64)))
ins = extrude_polygon(ring2d, INS_T)                       # (u, v, h) -> (x=h, y=v, z=u)
v = ins.vertices.copy(); ins.vertices = np.column_stack([v[:, 2] + 0.1, v[:, 1] + INS_CY, v[:, 0] + INS_CZ]); ins.fix_normals()
out["inserto"] = {"v": np.round(ins.vertices, 3).flatten().tolist(), "f": ins.faces.flatten().tolist()}
open("mesh_data_inserto.js", "w").write("const MESH_DATA=" + json.dumps(out, separators=(",", ":")) + ";")
print("arquivos gravados")
