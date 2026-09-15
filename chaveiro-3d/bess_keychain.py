"""Chaveiro em formato de gabinete BESS - Fórum BESS 2026 (versão 2, bloco proporcional).

Proporções baseadas no WEG BSCW400 T100 B215 (1040 x 2200 x 1500 mm, L x A x P)
e no Sungrow PowerStack ST255CS-2H (1150 x 2450 x 1610 mm). Escala aproximada 1:41.
Frente no estilo WEG: duas portas, grade hexagonal na porta inferior, alças à esquerda,
botão de emergência à direita, base escura e tampa escura fina.

Eixos: X = largura, Y = altura, Z = profundidade (frente em +Z). Unidades: mm.
Impressão: em pé, apoiado na base. Sem suportes.
Abridor de garrafa embutido na face de trás: boca de 21 x 7,5 mm numa parede de 1,6 mm, cavidade de 8 mm atrás.
"""
import numpy as np
import trimesh
from trimesh.creation import box, cylinder, extrude_polygon
from shapely.geometry import Polygon
from matplotlib.textpath import TextPath
from matplotlib.font_manager import FontProperties

# ---------- parâmetros ----------
W, H, D = 26.0, 54.0, 34.0       # largura, altura, profundidade do gabinete
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
    return to_side(trimesh.util.concatenate(parts), side, cy, cz)


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
    text_side("FÓRUM BESS", 5.2, 36.0, D / 2, "right", max_width=D - 4),
    text_side("2026", 10.0, 21.0, D / 2, "right", max_width=D - 6),
    emblem_side(12.0, 40.0, D / 2, "left"),
    text_side("ABEE-MT", 4.8, 26.0, D / 2, "left", max_width=D - 6),
    text_side("CUIABÁ", 4.8, 17.0, D / 2, "left", max_width=D - 6),
]
side_text_mesh = trimesh.util.concatenate(side_texts)

# ---------- abridor de garrafa embutido na face de trás ----------
# Lógica de abridor de parede: a tampa (26,6 mm) é mais larga que a boca, então ela entra só
# de lado, uns 3 a 5 mm. Com a parede de 1,6 mm, a aba engancha com 3,1 mm de penetração,
# onde a corda da tampa mede 17,6 mm (a boca tem 21). A borda de baixo da boca é o gancho sob a
# aba; a borda de cima apoia no topo da tampa. Segura-se o gabinete pelo topo e inclina-se para fora.
WALL = 1.6                                  # espessura da parede em volta da boca
HOLE_X0, HOLE_X1 = 2.5, W - 2.5             # boca com 21 mm de largura
HOLE_Y0, HOLE_Y1 = 12.0, 19.5               # boca com 7,5 mm de altura (tampa tem 6,3)
CAV_X0, CAV_X1 = 2.0, W - 2.0               # cavidade interna 22 mm de largura
CAV_Y0, CAV_Y1 = HOLE_Y0 - 2.0, HOLE_Y1 + 4.0   # folga para a aba embaixo e para o topo da tampa em cima
CAV_D = 8.0                                 # profundidade da cavidade atrás da parede (tampa entra até 5 mm)
from shapely.geometry import Point, box as sbox
hole2d = sbox(HOLE_X0, HOLE_Y0, HOLE_X1, HOLE_Y1).buffer(-2, join_style=1).buffer(2, join_style=1)
hole = extrude_polygon(hole2d, WALL + 0.02)
hole.apply_translation([0, 0, -0.01])
# cavidade com teto inclinado a 45° para imprimir sem suporte (perfil no plano YZ)
cav2d = Polygon([(WALL, CAV_Y0), (WALL + CAV_D, CAV_Y0), (WALL + CAV_D, CAV_Y1 + CAV_D), (WALL, CAV_Y1)])
cavity = extrude_polygon(cav2d, CAV_X1 - CAV_X0)
cavity.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [0, 1, 0]))  # X->+Z, Z->-X
cavity.apply_translation([CAV_X1, 0, 0])
body = body.difference(hole).difference(cavity)

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
single.export("chaveiro_forum_bess_2026.stl")

# 3MF básico (núcleo da especificação, sem extensões): três malhas e um objeto que as reúne
# como componentes. É o formato que o Bambu Studio importa como um objeto com três partes.
import zipfile
from xml.sax.saxutils import escape

def mesh_xml(obj_id, name, m):
    v = "".join(f'<vertex x="{x:.4f}" y="{y:.4f}" z="{z:.4f}"/>' for x, y, z in m.vertices)
    t = "".join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in m.faces)
    return (f'<object id="{obj_id}" name="{escape(name)}" type="model">'
            f'<mesh><vertices>{v}</vertices><triangles>{t}</triangles></mesh></object>')

objs = "".join(mesh_xml(i + 1, name, m) for i, (name, m) in enumerate(export_parts.items()))
comps = "".join(f'<component objectid="{i + 1}"/>' for i in range(len(parts)))
assembly_id = len(parts) + 1
model_xml = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
    '<metadata name="Title">Chaveiro Fórum BESS 2026</metadata>'
    f'<resources>{objs}'
    f'<object id="{assembly_id}" name="chaveiro_forum_bess_2026" type="model"><components>{comps}</components></object>'
    f'</resources><build><item objectid="{assembly_id}"/></build></model>'
)
content_types = ('<?xml version="1.0" encoding="UTF-8"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')
rels = ('<?xml version="1.0" encoding="UTF-8"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
with zipfile.ZipFile("chaveiro_forum_bess_2026_multicor.3mf", "w", zipfile.ZIP_DEFLATED) as zf:
    zf.writestr("[Content_Types].xml", content_types)
    zf.writestr("_rels/.rels", rels)
    zf.writestr("3D/3dmodel.model", model_xml)

import json
out = {}
for name, m in parts.items():
    out[name] = {"v": np.round(m.vertices, 3).flatten().tolist(), "f": m.faces.flatten().tolist()}
open("mesh_data.js", "w").write("const MESH_DATA=" + json.dumps(out, separators=(",", ":")) + ";")
print("arquivos gravados")
