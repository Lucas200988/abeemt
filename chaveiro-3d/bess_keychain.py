"""Chaveiro em formato de gabinete BESS - Fórum BESS 2026 (versão 2, bloco proporcional).

Proporções baseadas no WEG BSCW400 T100 B215 (1040 x 2200 x 1500 mm, L x A x P)
e no Sungrow PowerStack ST255CS-2H (1150 x 2450 x 1610 mm). Escala aproximada 1:41.
Frente no estilo WEG: duas portas, grade hexagonal na porta inferior, alças à esquerda,
botão de emergência à direita, base escura e tampa escura fina.

Eixos: X = largura, Y = altura, Z = profundidade (frente em +Z). Unidades: mm.
Impressão: em pé, apoiado na base. Sem suportes.
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
    m.apply_translation([cx, cy, D])
    return m


def text_side(txt, cap, cy, cz, side, max_width=None):
    """Texto em relevo na lateral. side='right' (x=W) ou 'left' (x=0)."""
    m = text_flat(txt, cap, RELIEF, max_width)
    if side == "right":
        rot = trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0])   # X->-Z, Z->+X
        m.apply_transform(rot)
        m.apply_translation([W, cy, cz])
    else:
        rot = trimesh.transformations.rotation_matrix(-np.pi / 2, [0, 1, 0])  # X->+Z, Z->-X
        m.apply_transform(rot)
        m.apply_translation([0, cy, cz])
    return m


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
side_y_top, side_y_year = 35.5, 20.0
side_texts = []
for side in ("right", "left"):
    side_texts.append(text_side("FÓRUM BESS", 5.2, side_y_top, D / 2, side, max_width=D - 4))
    side_texts.append(text_side("2026", 10.0, side_y_year, D / 2, side, max_width=D - 6))
side_text_mesh = trimesh.util.concatenate(side_texts)

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
btn.apply_translation([W - 4.4, 26.5, D + RELIEF / 2])
details.append(btn)                                                          # botão de emergência
details.append(rbox(1.2, 5.0, RELIEF, 3.2, 25.0, D))                         # alça da porta superior
details.append(rbox(1.2, 6.0, RELIEF, 3.2, 10.0, D))                         # alça da porta inferior
details_mesh = trimesh.util.concatenate(details)

# ---------- exportação ----------
parts = {"corpo_branco": body, "faixas_escuras": bands, "detalhes_relevo": details_mesh}
for name, m in parts.items():
    m.merge_vertices()
    m.fix_normals()
    print(f"{name:18s} watertight={m.is_watertight}  volume={m.volume:.0f} mm³")

single = body.union(bands).union(details_mesh)
single.merge_vertices()
print(f"{'stl_uma_cor':18s} watertight={single.is_watertight}  volume={single.volume:.0f} mm³")
print("dimensões (mm):", np.round(single.extents, 1))
single.export("chaveiro_forum_bess_2026.stl")

scene = trimesh.Scene()
for name, m in parts.items():
    scene.add_geometry(m, node_name=name, geom_name=name)
scene.export("chaveiro_forum_bess_2026_multicor.3mf")

# Reestrutura o 3MF: um único objeto "chaveiro" composto pelas três malhas
import zipfile, re, shutil
src = "chaveiro_forum_bess_2026_multicor.3mf"
tmp = src + ".tmp"
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename.endswith("3dmodel.model"):
            xml = data.decode("utf-8")
            ids = re.findall(r'<object id="(\d+)"[^>]*type="model"', xml)
            if not ids:
                ids = re.findall(r'<object id="(\d+)"', xml)
            import uuid
            new_id = str(max(int(i) for i in ids) + 1)
            comps = "".join(f'<component objectid="{i}" p:UUID="{uuid.uuid4()}" />' for i in ids)
            assembly = (f'<object id="{new_id}" name="chaveiro_forum_bess_2026" type="model" p:UUID="{uuid.uuid4()}">'
                        f'<components>{comps}</components></object>')
            xml = xml.replace("</resources>", assembly + "</resources>")
            xml = re.sub(r"<build[^>]*>.*?</build>",
                         f'<build p:UUID="{uuid.uuid4()}"><item objectid="{new_id}" p:UUID="{uuid.uuid4()}" /></build>',
                         xml, flags=re.S)
            assert f'objectid="{new_id}"' in xml
            data = xml.encode("utf-8")
        zout.writestr(item, data)
shutil.move(tmp, src)

import json
out = {}
for name, m in parts.items():
    out[name] = {"v": np.round(m.vertices, 3).flatten().tolist(), "f": m.faces.flatten().tolist()}
open("mesh_data.js", "w").write("const MESH_DATA=" + json.dumps(out, separators=(",", ":")) + ";")
print("arquivos gravados")
