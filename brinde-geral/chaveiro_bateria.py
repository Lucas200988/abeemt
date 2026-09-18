"""Brinde de massa do Fórum BESS 2026: chaveiro no formato do símbolo da bateria.

A versão anterior era um retângulo com o emblema carimbado. Aqui a peça inteira é o
símbolo: a silhueta é o ícone de bateria, com o polo virando a argola do chaveiro, e o
raio é vazado de lado a lado. Silhueta recortada lê como objeto; logo impresso lê como
etiqueta — e vazar o raio ainda tira massa em vez de acrescentar.

O que veio do objetivo de aproveitar as sobras das cinco bobinas de 1 kg:

1. Peça chata, não volumétrica. O chaveiro do gabinete BESS, que já existe, pesa uns 53 g
   e serve como brinde de destaque; a 6 g esta aqui rende oito vezes mais unidades.
2. A troca de cor acontece só nos últimos 0,8 mm: base numa cor, dizeres na outra. O
   fatiador troca de filamento nas últimas camadas, em vez de trocar camada sim camada não.
3. Cor do corpo trocável sem mexer na geometria: a mesma peça sai em laranja, verde, cinza,
   branco ou preto, e é assim que as cinco bobinas baixam juntas.

Eixos: X = comprimento, Y = altura da peça deitada, Z = espessura. Já sai deitada.
"""
import os
import numpy as np
import trimesh
from trimesh.creation import cylinder, extrude_polygon
from shapely.geometry import Polygon, box as sbox
from shapely.ops import unary_union
from shapely import affinity
from matplotlib.textpath import TextPath
from matplotlib.font_manager import FontProperties

# ---------- parâmetros ----------
L, A = 62.0, 32.0              # corpo da bateria
POLO_L, POLO_A = 8.0, 14.0     # polo, que também é o pegador da argola
BASE_T = 2.4                   # espessura da base (cor 1)
RELIEF = 0.8                   # relevo dos dizeres (cor 2)
R_CANTO, R_POLO = 5.0, 2.0
FURO_D = 4.6                   # passa anel de chaveiro de 25 mm
BORDA = 1.2                    # rebaixo de contorno, na cor da base
DENSIDADE = 1.24               # g/cm³, PLA
FONT = FontProperties(fname="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")


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


def raio_shape(altura):
    """O mesmo raio do emblema da ABEE-MT, escalado pela altura."""
    p = Polygon([(0.55, 1.0), (0.10, 0.42), (0.42, 0.42), (0.30, 0.0),
                 (0.90, 0.58), (0.58, 0.58), (0.70, 1.0)])
    p = affinity.scale(p, altura, altura, origin=(0, 0))
    minx, miny, maxx, maxy = p.bounds
    return affinity.translate(p, -(minx + maxx) / 2, -(miny + maxy) / 2)


def extrude(shape, h, z=0.0):
    geoms = list(shape.geoms) if hasattr(shape, "geoms") else [shape]
    m = trimesh.util.concatenate([extrude_polygon(g, h) for g in geoms])
    m.apply_translation([0, 0, z])
    return m


# ---------- silhueta: corpo da bateria + polo ----------
corpo = sbox(0, 0, L, A).buffer(-R_CANTO, join_style=1).buffer(R_CANTO, join_style=1)
polo = sbox(L - R_POLO, (A - POLO_A) / 2, L + POLO_L, (A + POLO_A) / 2)
polo = polo.buffer(-R_POLO, join_style=1).buffer(R_POLO, join_style=1)
contorno = unary_union([corpo, polo])
base = extrude(contorno, BASE_T)

# argola no próprio polo
FURO_CX = L + POLO_L - 4.0
furo = cylinder(radius=FURO_D / 2, height=BASE_T * 3, sections=48)
furo.apply_translation([FURO_CX, A / 2, BASE_T / 2])
base = base.difference(furo)

# raio vazado de lado a lado: é o que faz a peça ser o símbolo, e ainda tira massa
RAIO_H, RAIO_CX = 23.0, 15.5
raio = affinity.translate(raio_shape(RAIO_H), RAIO_CX, A / 2)
base = base.difference(extrude(raio, BASE_T * 3, -BASE_T))

# rebaixo de contorno, na cor da base (acabamento que não gasta a segunda cor)
moldura = corpo.buffer(-1.6).difference(corpo.buffer(-1.6 - BORDA))
moldura = moldura.difference(raio.buffer(1.8))
base = base.difference(extrude(moldura, 0.5, BASE_T - 0.5))

# ---------- relevo: dizeres na segunda cor ----------
# "FÓRUM BESS" numa linha só ficaria com 3,4 mm de letra no espaço ao lado do raio;
# em três linhas curtas a letra sobe para 6,2 mm.
TXT_CX, TXT_W = 41.0, 28.0
linhas = [("FÓRUM", 6.2, A / 2 + 7.2), ("BESS", 6.2, A / 2), ("2026", 6.2, A / 2 - 7.2)]
relevo2d = unary_union([affinity.translate(text_shape(t, c, max_width=TXT_W), TXT_CX, y)
                        for t, c, y in linhas])
relevo = extrude(relevo2d, RELIEF + 0.05, BASE_T - 0.05)

# ---------- verso: ABEE-MT em baixo-relevo, sem troca de cor ----------
verso = affinity.translate(text_shape("ABEE-MT  ·  MATO GROSSO", 4.0, max_width=34.0),
                           TXT_CX, A / 2)
base = base.difference(extrude(affinity.scale(verso, -1, 1, origin=(TXT_CX, A / 2)), 0.6, -0.01))

# ---------- verificação e exportação ----------
for nome, m in [("base", base), ("relevo", relevo)]:
    m.merge_vertices()
    m.fix_normals()
    print(f"{nome:10s} fechada={m.is_watertight}  volume={m.volume:8.1f} mm³  "
          f"massa={m.volume / 1000 * DENSIDADE:5.2f} g")
total_g = (base.volume + relevo.volume) / 1000 * DENSIDADE
print(f"{'peça':10s} {L + POLO_L:.0f} x {A:.0f} x {BASE_T + RELIEF:.1f} mm   "
      f"massa total {total_g:.2f} g")

uma_cor = base.union(relevo)
uma_cor.merge_vertices()
print(f"{'stl':10s} fechada={uma_cor.is_watertight}  medidas={np.round(uma_cor.extents, 1)}")
uma_cor.export("chaveiro_bateria.stl")

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from bambu3mf import write_3mf

# A cor do corpo é a que roda entre as cinco bobinas; gravo laranja porque é a mais cheia.
PALETTE = [("1_corpo", "Laranja", "#E8712B"),
           ("2_relevo", "Preto", "#1A1A1A")]
objects = [("chaveiro_bateria", [("1_corpo", base), ("2_relevo", relevo)])]
slots = write_3mf("chaveiro_bateria.3mf", "Chaveiro bateria Fórum BESS 2026", objects, PALETTE)
print("filamentos:", ", ".join(f"{k} = {v}" for k, v in slots.items()))
print("arquivos gravados")
