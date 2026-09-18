"""Brinde de massa do Fórum BESS 2026: chaveiro chato de duas cores.

Pensado para consumir as sobras dos cinco filamentos de 1 kg comprados para as maquetes.
Três decisões que vêm daí:

1. Peça chata, não volumétrica. O chaveiro do gabinete BESS, que já existe, pesa uns 53 g
   e serve como brinde de destaque; a 4 g por unidade esta aqui rende mais de dez vezes
   mais peças com o mesmo filamento.
2. A troca de cor acontece só nos últimos 0,8 mm: base de 2,4 mm numa cor, relevo do
   emblema e dos dizeres na outra. O fatiador só troca de filamento nas últimas camadas,
   em vez de trocar camada sim camada não.
3. Cor do corpo trocável sem mexer na geometria: a mesma peça sai em laranja, verde,
   cinza, branco ou preto, e é assim que as cinco bobinas baixam juntas.

Eixos: X = comprimento, Y = altura da peça deitada, Z = espessura. A peça já é gerada
deitada, pronta para a mesa.
"""
import os
import pickle
import numpy as np
import trimesh
from trimesh.creation import cylinder, extrude_polygon
from shapely.geometry import Polygon, Point, box as sbox
from shapely.ops import unary_union
from shapely import affinity
from matplotlib.textpath import TextPath
from matplotlib.font_manager import FontProperties

# ---------- parâmetros ----------
L, A = 70.0, 30.0              # comprimento e altura da etiqueta
BASE_T = 2.4                   # espessura da base (cor 1)
RELIEF = 0.8                   # relevo dos dizeres (cor 2)
R_CANTO = 5.0
FURO_D = 4.6                   # passa anel de chaveiro de 25 mm
FURO_CX = 7.5
BORDA = 1.2                    # rebaixo de contorno, na cor da base
DENSIDADE = 1.24               # g/cm³, PLA
FONT = FontProperties(fname="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
EMBLEMA_PNG = "/home/user/abeemt/nl/abee.png"


def text_shape(txt, cap, max_width=None, fatten=0.18):
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
    k = cap / (maxy - miny)
    if max_width and (maxx - minx) * k > max_width:
        k = max_width / (maxx - minx)
    shape = affinity.scale(shape, k, k, origin=(0, 0)).buffer(fatten, join_style=1).simplify(0.02)
    minx, miny, maxx, maxy = shape.bounds
    return affinity.translate(shape, -(minx + maxx) / 2, -(miny + maxy) / 2)


def emblema_shape(diam):
    """Raio dentro de um anel, o mesmo emblema usado nas placas das maquetes."""
    r = diam / 2
    anel = Point(0, 0).buffer(r, 96).difference(Point(0, 0).buffer(r - 1.1, 96))
    h = diam * 0.72
    raio = Polygon([(0.55, 1.0), (0.10, 0.42), (0.42, 0.42), (0.30, 0.0),
                    (0.90, 0.58), (0.58, 0.58), (0.70, 1.0)])
    raio = affinity.translate(affinity.scale(raio, h, h, origin=(0, 0)), -0.5 * h, -0.5 * h)
    return unary_union([anel, raio.buffer(0.08, join_style=2)])


def extrude(shape, h, z=0.0):
    geoms = list(shape.geoms) if hasattr(shape, "geoms") else [shape]
    m = trimesh.util.concatenate([extrude_polygon(g, h) for g in geoms])
    m.apply_translation([0, 0, z])
    return m


# ---------- corpo da etiqueta ----------
contorno = sbox(0, 0, L, A).buffer(-R_CANTO, join_style=1).buffer(R_CANTO, join_style=1)
base = extrude(contorno, BASE_T)
furo = cylinder(radius=FURO_D / 2, height=BASE_T * 3, sections=48)
furo.apply_translation([FURO_CX, A / 2, BASE_T / 2])
base = base.difference(furo)

# rebaixo de contorno: dá acabamento sem gastar cor nenhuma
moldura = contorno.buffer(-1.6).difference(contorno.buffer(-1.6 - BORDA))
base = base.difference(extrude(moldura, 0.5, BASE_T - 0.5))

# ---------- relevo: emblema e dizeres (segunda cor) ----------
# "FÓRUM BESS" numa linha só ficaria com 3,4 mm de letra no espaço que sobra ao lado
# do emblema. Em três linhas curtas, a letra sobe para 6,2 mm.
EMB_D = 19.0
EMB_CX = 22.0
emb = affinity.translate(emblema_shape(EMB_D), EMB_CX, A / 2)

TXT_CX, TXT_W = 48.5, 30.0
linhas = [("FÓRUM", 6.2, A / 2 + 7.2), ("BESS", 6.2, A / 2), ("2026", 6.2, A / 2 - 7.2)]
relevo2d = unary_union([emb] + [affinity.translate(text_shape(t, c, max_width=TXT_W), TXT_CX, y)
                                for t, c, y in linhas])
relevo = extrude(relevo2d, RELIEF + 0.05, BASE_T - 0.05)     # penetra 0,05 na base

# ---------- verso: ABEE-MT em baixo-relevo, sem troca de cor ----------
verso = affinity.translate(text_shape("ABEE-MT  ·  MATO GROSSO", 4.4, max_width=56.0), L / 2, A / 2)
base = base.difference(extrude(affinity.scale(verso, -1, 1, origin=(L / 2, A / 2)), 0.6, -0.01))

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from bambu3mf import write_3mf, place_in_rows, clean_mesh

# ---------- verificação e exportação ----------
for nome, m in [("base", base), ("relevo", relevo)]:
    m.merge_vertices()
    m.fix_normals()
    print(f"{nome:10s} fechada={m.is_watertight}  volume={m.volume:8.1f} mm³  "
          f"massa={m.volume / 1000 * DENSIDADE:5.2f} g")

total_g = (base.volume + relevo.volume) / 1000 * DENSIDADE
print(f"{'peça':10s} {L:.0f} x {A:.0f} x {BASE_T + RELIEF:.1f} mm   massa total {total_g:.2f} g")

uma_cor = base.union(relevo)
uma_cor = clean_mesh(uma_cor)
print(f"{'stl':10s} fechada={uma_cor.is_watertight}  medidas={np.round(uma_cor.extents, 1)}")
uma_cor.export("tag_forum_bess.stl")


# Uma peça só; a cor do corpo é a que roda entre as cinco bobinas. Gravo a laranja
# como corpo porque é a bobina mais cheia, e preto no relevo.
PALETTE = [("1_corpo", "Laranja", "#E8712B"),
           ("2_relevo", "Preto", "#1A1A1A")]
objects = [("tag_forum_bess", [("1_corpo", base), ("2_relevo", relevo)])]
slots = write_3mf("tag_forum_bess.3mf", "Chaveiro Fórum BESS 2026", objects, PALETTE)
print("filamentos:", ", ".join(f"{k} = {v}" for k, v in slots.items()))
print("arquivos gravados")
