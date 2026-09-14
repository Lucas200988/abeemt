"""Chaveiro em formato de gabinete BESS - Fórum BESS 2026.

Eixos (orientação de impressão, deitado de costas na mesa):
  X = largura, Y = altura do gabinete, Z = profundidade (frente para cima).
Unidades: milímetros.
"""
import numpy as np
import trimesh
from trimesh.creation import box, cylinder, extrude_polygon
from shapely.geometry import Polygon
from shapely.ops import unary_union
from matplotlib.textpath import TextPath
from matplotlib.font_manager import FontProperties

# ---------- parâmetros ----------
W, H, D = 30.0, 54.0, 7.0        # largura, altura, profundidade do gabinete
TOP_BAND, BASE_BAND = 3.0, 4.0   # faixas escuras (topo e base)
RELIEF = 0.8                     # altura do relevo (texto, botão, alça)
GROOVE = 0.4                     # profundidade dos sulcos (porta, grade)
FONT = FontProperties(fname="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")


def rbox(w, h, d, x=0, y=0, z=0):
    """Caixa com canto inferior-esquerdo-traseiro em (x, y, z)."""
    b = box(extents=[w, h, d])
    b.apply_translation([x + w / 2, y + h / 2, z + d / 2])
    return b


def text_mesh(txt, cap_height, cx, cy, z0, height, max_width=None):
    """Texto extrudado, centralizado em (cx, cy), base em z0."""
    tp = TextPath((0, 0), txt, size=10, prop=FONT)
    polys = []
    for poly in tp.to_polygons():
        if len(poly) >= 3:
            polys.append(Polygon(poly))
    # Une contornos externos e subtrai furos (letras como O, R, 6...)
    outer = [p for p in polys if p.area > 0]
    outer.sort(key=lambda p: p.area, reverse=True)
    shape = None
    for p in outer:
        p = p.buffer(0)
        if shape is None:
            shape = p
        elif shape.contains(p.representative_point()):
            shape = shape.difference(p)
        else:
            shape = shape.union(p)
    minx, miny, maxx, maxy = shape.bounds
    # Escala pela altura de "caixa alta" (usa a altura real do texto)
    scale = cap_height / (maxy - miny)
    if max_width and (maxx - minx) * scale > max_width:
        scale = max_width / (maxx - minx)
    geoms = list(shape.geoms) if hasattr(shape, "geoms") else [shape]
    m = trimesh.util.concatenate([extrude_polygon(g, height) for g in geoms])
    m.apply_scale([scale, scale, 1.0])
    b = m.bounds
    m.apply_translation([cx - (b[0][0] + b[1][0]) / 2, cy - (b[0][1] + b[1][1]) / 2, z0])
    return m


# ---------- corpo principal (branco) ----------
body = rbox(W, H - TOP_BAND - BASE_BAND, D, 0, BASE_BAND, 0)

# Sulco da porta (contorno)
door_x0, door_x1 = 2.0, W - 2.0
door_y0, door_y1 = BASE_BAND + 2.0, H - TOP_BAND - 1.5
outer = rbox(door_x1 - door_x0, door_y1 - door_y0, GROOVE, door_x0, door_y0, D - GROOVE)
inner = rbox(door_x1 - door_x0 - 1.0, door_y1 - door_y0 - 1.0, GROOVE + 1,
             door_x0 + 0.5, door_y0 + 0.5, D - GROOVE - 0.5)
door_groove = outer.difference(inner)

# Grade de ventilação hexagonal (furos rasos)
holes = []
pitch, r = 1.9, 0.65
gx0, gx1 = 6.0, W - 6.0
gy0, gy1 = 28.0, 42.0
row = 0
y = gy0
while y <= gy1:
    xoff = pitch / 2 if row % 2 else 0
    x = gx0 + xoff
    while x <= gx1:
        c = cylinder(radius=r, height=GROOVE * 2, sections=12)
        c.apply_translation([x, y, D])
        holes.append(c)
        x += pitch
    y += pitch * 0.866
    row += 1
grille = trimesh.util.concatenate(holes)

body = body.difference(door_groove)
body = body.difference(grille)

# ---------- faixas escuras (topo e base) ----------
top_band = rbox(W, TOP_BAND, D, 0, H - TOP_BAND, 0)
base_band = rbox(W, BASE_BAND, D, 0, 0, 0)

# Argola do chaveiro (integrada à faixa do topo)
ring_r_out, ring_r_in, ring_t = 4.5, 2.2, 3.0
ring = cylinder(radius=ring_r_out, height=ring_t, sections=48)
ring = ring.difference(cylinder(radius=ring_r_in, height=ring_t + 2, sections=48))
ring.apply_translation([W / 2, H + ring_r_out - 1.5, D / 2])
top_band = top_band.union(ring)

# ---------- detalhes em relevo (cor de destaque) ----------
details = []
# Nome do evento (etiqueta superior, no lugar da marca)
details.append(text_mesh("FÓRUM BESS", 3.4, W / 2, 46.0, D, RELIEF, max_width=W - 6))
# Ano em destaque na parte inferior da porta
details.append(text_mesh("2026", 8.0, W / 2, 16.0, D, RELIEF, max_width=W - 7))
# Botão de emergência (ponto redondo)
btn = cylinder(radius=1.1, height=RELIEF, sections=24)
btn.apply_translation([W - 6.0, 24.5, D + RELIEF / 2])
details.append(btn)
# Alça da porta (barra vertical à esquerda)
details.append(rbox(1.2, 6.0, RELIEF, 3.2, 21.5, D))
details_mesh = trimesh.util.concatenate(details)

# ---------- exportação ----------
parts = {
    "corpo_branco": body,
    "faixas_escuras": top_band.union(base_band),
    "detalhes_relevo": details_mesh,
}
for name, m in parts.items():
    m.merge_vertices()
    m.fix_normals()
    print(f"{name:18s} watertight={m.is_watertight}  volume={m.volume:.0f} mm³")

full = body.union(top_band).union(base_band).union(details_mesh)
full.merge_vertices()
print(f"{'chaveiro_completo':18s} watertight={full.is_watertight}  volume={full.volume:.0f} mm³")
print("dimensões (mm):", np.round(full.extents, 1))

full.export("chaveiro_forum_bess_2026.stl")

scene = trimesh.Scene()
for name, m in parts.items():
    scene.add_geometry(m, node_name=name, geom_name=name)
scene.export("chaveiro_forum_bess_2026_multicor.3mf")
print("arquivos gravados")
