"""Miniatura do Sungrow PowerStack ST255CS-2H em escala 1:25, para cúpula de acrílico de 90 x 90 x 110 mm internos.

Real: 1150 (L) x 2450 (A) x 1610 (P) mm, <= 3000 kg, 125 kW / 257 kWh, refrigeração a líquido.
Aparência (foto de referência): gabinete branco de cantos verticais arredondados, tampa escura
com barra de luz laranja na frente, porta com grade hexagonal perfurada na parte superior,
marca SUNGROW acima da grade, indicador luminoso, botão de emergência vermelho à direita,
alça vertical à esquerda e rodapé escuro. Atrás: painel de venezianas do trocador de calor.

Peças (impressão em pé, sem suporte):
  corpo   - caixa oca aberta em cima, parede 1,6 mm, fundo 2,4 mm (branco; rodapé escuro em cor separada)
  tampa   - placa escura com aba que encaixa no corpo (imprime de cabeça para baixo)
  detalhes - relevos: texto, alça, indicador, botão (cores separadas no 3MF)

Eixos de construção: X = largura, Y = altura, Z = profundidade (frente em +Z). Exporta com Z para cima.
"""
import numpy as np
import trimesh
from trimesh.creation import box, cylinder, extrude_polygon
from shapely.geometry import Polygon, Point, box as sbox
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
gx0, gx1, gy0, gy1 = 9.6, W - 9.6, 60.0, 83.0
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

# Rodapé escuro: mesma casca, cor separada (corte do corpo em y = BASE_BAND)
base_part = body.intersection(rbox(W + 2, BASE_BAND + 1.05, D + 2, -1, -1, -1))     # y <= BASE_BAND + 0.05
body_white = body.difference(rbox(W + 2, BASE_BAND + 1, D + 2, -1, -1, -1))         # y >= BASE_BAND

# ---------- tampa escura com aba de encaixe ----------
cap_plate = profile_prism(outer2d, BODY_TOP, H)
lip2d = rounded_rect(WALL + CAP_CLEAR, WALL + CAP_CLEAR, W - WALL - CAP_CLEAR, D - WALL - CAP_CLEAR,
                     max(R_CORNER - WALL - CAP_CLEAR, 0.8))
lip_hollow2d = lip2d.buffer(-1.4, join_style=1)
cap_lip = profile_prism(lip2d, BODY_TOP - CAP_LIP, BODY_TOP + 0.01).difference(
    profile_prism(lip_hollow2d, BODY_TOP - CAP_LIP - 1, BODY_TOP + 0.02))
cap = cap_plate.union(cap_lip)
# barra de luz laranja: canal na face frontal da tampa + tira separada
bar_w, bar_h, bar_d = W - 12.0, 0.8, 0.5
bar_cut = rbox(bar_w, bar_h, bar_d + 0.01, 6.0, BODY_TOP + 0.85, D - bar_d)
cap = cap.difference(bar_cut)
# a tira cresce SINK para cada lado e para dentro: encostada no canal ela teria
# faces exatamente coincidentes com a tampa, que é o que gera "região flutuante"
light_bar = rbox(bar_w + 2 * SINK, bar_h + 2 * SINK, bar_d + SINK,
                 6.0 - SINK, BODY_TOP + 0.85 - SINK, D - bar_d - SINK)

# ---------- detalhes em relevo na frente ----------
gray, red, blue = [], [], []
gray.append(on_front(text_flat("SUNGROW", 3.4, RELIEF, max_width=32), W / 2, 89.5))        # marca
blue.append(rbox(8.0, 0.8, 0.5, W / 2 - 4, 85.5, D - SINK))                                 # indicador
gray.append(rbox(1.3, 16.0, 1.2, 4.4, 40.0, D - SINK))                                       # alça
ring = cylinder(radius=1.8, height=0.6, sections=32).difference(cylinder(radius=1.1, height=0.8, sections=32))
ring.apply_translation([W - 8.0, 47.0, D - SINK + 0.3])
gray.append(ring)                                                                             # anel do botão
btn = cylinder(radius=1.1, height=1.4, sections=32)
btn.apply_translation([W - 8.0, 47.0, D - SINK + 0.7])
red.append(btn)                                                                               # botão de emergência
logo_dot = cylinder(radius=1.1, height=0.4, sections=24)
logo_dot.apply_translation([W / 2, BASE_BAND / 2, D - SINK + 0.2])
blue.append(logo_dot)                                                                         # logo no rodapé
details_gray = trimesh.util.concatenate(gray)
details_red = trimesh.util.concatenate(red)
details_blue = trimesh.util.concatenate(blue)

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
plate_text = text_flat("FÓRUM BESS 2026 ABEE-MT", 3.5, 1.5, max_width=76)
plate_text.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))  # deita no plano XZ, relevo em +Y
plate_text.apply_translation([W / 2, -0.05, D + (pz0 + PLATE_S - D) / 2])
plate_text2 = text_flat("POWERSTACK 255CS 1:25", 3.6, 1.5, max_width=76)
plate_text2.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
plate_text2.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [0, 1, 0]))     # lê-se por trás
plate_text2.apply_translation([W / 2, -0.05, pz0 / 2])

# ---------- exportação ----------
parts = {
    "corpo_branco": body_white,
    "rodape_escuro": base_part,
    "tampa_escura": cap,
    "barra_luz_laranja": light_bar,
    "detalhes_cinza": details_gray,
    "botao_vermelho": details_red,
    "detalhes_azuis": details_blue,
    "placa_base": plate,
    "texto_placa": trimesh.util.concatenate([plate_text, plate_text2]),
}
for name, m in parts.items():
    m.merge_vertices()
    m.fix_normals()
    print(f"{name:20s} watertight={m.is_watertight}  volume={m.volume:8.0f} mm³")

TO_Z_UP = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])   # Y -> Z, frente -> -Y

# STL 1: corpo completo (rodapé + relevos fundidos), em pé
body_stl = body_white.union(base_part).union(details_gray).union(details_red).union(details_blue)
body_stl.apply_transform(TO_Z_UP)
body_stl.merge_vertices()
print(f"{'stl_corpo':20s} watertight={body_stl.is_watertight}  volume={body_stl.volume:8.0f} mm³  extents={np.round(body_stl.extents, 1)}")
body_stl.export("miniatura_powerstack_corpo.stl")

# STL 2: tampa (com barra de luz fundida), virada de cabeça para baixo para imprimir sem suporte
cap_stl = cap.union(light_bar)
cap_stl.apply_transform(TO_Z_UP)
cap_stl.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0]))   # vira de cabeça para baixo
cap_stl.apply_translation([0, 0, -cap_stl.bounds[0][2]])
cap_stl.apply_translation([0, -cap_stl.bounds[0][1], 0])
cap_stl.merge_vertices()
print(f"{'stl_tampa':20s} watertight={cap_stl.is_watertight}  volume={cap_stl.volume:8.0f} mm³  extents={np.round(cap_stl.extents, 1)}")
cap_stl.export("miniatura_powerstack_tampa.stl")

# STL 3: placa de base com os textos, deitada
plate_stl = plate.union(trimesh.util.concatenate([plate_text, plate_text2]))
plate_stl.apply_transform(TO_Z_UP)
plate_stl.apply_translation([0, 0, -plate_stl.bounds[0][2]])
plate_stl.merge_vertices()
print(f"{'stl_placa':20s} watertight={plate_stl.is_watertight}  volume={plate_stl.volume:8.0f} mm³  extents={np.round(plate_stl.extents, 1)}")
plate_stl.export("miniatura_powerstack_placa.stl")

# 3MF: três objetos, cada peça já no seu filamento (4 slots)
#   1 branco: corpo | 2 grafite: rodapé, marca, alça, anel, tampa, placa
#   3 laranja: barra de luz, indicador, logo do rodapé, texto da placa | 4 vermelho: botão
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from bambu3mf import write_3mf, place_in_rows

COLOR_GROUPS = {
    "powerstack_corpo": {"1_branco": ["corpo_branco"], "2_cinza_escuro": ["rodape_escuro", "detalhes_cinza"],
                         "3_laranja": ["detalhes_azuis"], "4_vermelho": ["botao_vermelho"]},
    "powerstack_tampa": {"2_cinza_escuro": ["tampa_escura"], "3_laranja": ["barra_luz_laranja"]},
    "placa_base":       {"2_cinza_escuro": ["placa_base"], "3_laranja": ["texto_placa"]},
}
# a ordem define o slot de filamento
PALETTE = [("1_branco", "Branco", "#EDEFEE"),
           ("2_cinza_escuro", "Grafite", "#33373B"),
           ("3_laranja", "Laranja", "#E8712B"),
           ("4_vermelho", "Vermelho", "#C9312E")]
flip = trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0])

def placed(name, obj):
    e = parts[name].copy()
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
place_in_rows(objects, [["powerstack_corpo", "powerstack_tampa"], ["placa_base"]])

slots = write_3mf("miniatura_powerstack_multicor.3mf", "Miniatura Sungrow PowerStack 1:25",
                  objects, PALETTE)
print("filamentos:", ", ".join(f"{k} = {v}" for k, v in slots.items()))

# dados para o visualizador (Y para cima, montado), agrupados nas 4 cores
import json
VIEW_GROUPS = {"branco": ["corpo_branco"], "cinza_escuro": ["rodape_escuro", "detalhes_cinza", "tampa_escura", "placa_base"],
               "laranja": ["detalhes_azuis", "barra_luz_laranja", "texto_placa"], "vermelho": ["botao_vermelho"]}
out = {}
for color, names in VIEW_GROUPS.items():
    m = trimesh.util.concatenate([parts[n] for n in names])
    out[color] = {"v": np.round(m.vertices, 2).flatten().tolist(), "f": m.faces.flatten().tolist()}
open("mesh_data_mini.js", "w").write("const MESH_DATA=" + json.dumps(out, separators=(",", ":")) + ";")
print("arquivos gravados")
