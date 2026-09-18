"""Suporte de celular do Fórum BESS 2026, inspirado em gabinete de baterias.

Frente com cinco indicadores de carga, raio e os dizeres do evento; laterais com
venezianas; passagem de cabo no rodapé; encosto inclinado a 60 graus com canaleta para
a borda do aparelho. Corpo numa cor, detalhes na outra.

Peça oca de casca fina e fundo aberto: o que decide quantas unidades saem das sobras é a
massa, e a versão maciça pesaria mais de 150 g. Com casca de 2,2 mm ela cai para a faixa
dos 40 g, ainda assim umas seis vezes o chaveiro — este é brinde de destaque, não de todos.

Perfil lateral, em (z, y): sobe a frente, volta pelo topo da parede frontal, desce na
canaleta, corre o piso da canaleta, sobe o encosto a 60 graus, atravessa a espessura do
encosto e desce pelo fundo. Todas as faces inclinadas ficam acima de 60 graus da
horizontal, então imprime em pé sem suporte nenhum.

Eixos: X = largura, Y = altura, Z = profundidade (face dos dizeres em z = 0).
Exporta com Z para cima.
"""
import os
import numpy as np
import trimesh
from trimesh.creation import extrude_polygon
from shapely.geometry import Polygon, box as sbox
from shapely.ops import unary_union
from shapely import affinity
from matplotlib.textpath import TextPath
from matplotlib.font_manager import FontProperties

# ---------- parâmetros ----------
W, D, H = 70.0, 80.0, 60.0
PAREDE = 2.2                    # casca
FRENTE_T = 12.0                 # espessura da parede frontal
FRENTE_H = 44.0                 # altura da face dos dizeres
CANAL_Z0, CANAL_Z1 = 12.0, 22.0  # canaleta onde a borda do celular apoia
CANAL_Y = 14.0
ANGULO = 60.0                   # inclinação do encosto
ENCOSTO_T = 10.0
RELIEF, SINK = 0.7, 0.05
CABO_L, CABO_A = 18.0, 7.5      # passagem de cabo
DENSIDADE = 1.24
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
    p = Polygon([(0.55, 1.0), (0.10, 0.42), (0.42, 0.42), (0.30, 0.0),
                 (0.90, 0.58), (0.58, 0.58), (0.70, 1.0)])
    p = affinity.scale(p, altura, altura, origin=(0, 0))
    minx, miny, maxx, maxy = p.bounds
    return affinity.translate(p, -(minx + maxx) / 2, -(miny + maxy) / 2)


def pilha_shape(larg, alt):
    """Indicador de carga: corpo de bateria com o poninho em cima."""
    corpo = sbox(-larg / 2, -alt / 2, larg / 2, alt / 2 - 0.9)
    corpo = corpo.buffer(-0.5, join_style=1).buffer(0.5, join_style=1)
    polo = sbox(-larg * 0.30, alt / 2 - 1.1, larg * 0.30, alt / 2)
    return unary_union([corpo, polo])


def prisma_x(shape_zy, x0, x1):
    """Prisma com perfil no plano (z, y), extrudado ao longo de X."""
    m = extrude_polygon(shape_zy, x1 - x0)
    v = m.vertices.copy()
    m.vertices = np.column_stack([v[:, 2] + x0, v[:, 1], v[:, 0]])
    m.fix_normals()
    return m


def na_frente(shape_xy, altura):
    """Relevo na face frontal (z = 0), saindo para -Z."""
    geoms = list(shape_xy.geoms) if hasattr(shape_xy, "geoms") else [shape_xy]
    m = trimesh.util.concatenate([extrude_polygon(g, altura) for g in geoms])
    m.apply_translation([-W / 2, 0, 0])
    m.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [0, 1, 0]))
    m.apply_translation([W / 2, 0, SINK])
    return m


# ---------- perfil lateral ----------
tg = np.tan(np.radians(ANGULO))
ENC_Z0, ENC_Y0 = CANAL_Z1, CANAL_Y
ENC_Z1 = ENC_Z0 + (H - ENC_Y0) / tg                       # topo da face frontal do encosto
perfil = Polygon([
    (0.0, 0.0), (0.0, FRENTE_H), (FRENTE_T, FRENTE_H), (FRENTE_T, CANAL_Y),
    (CANAL_Z1, CANAL_Y), (ENC_Z1, H), (ENC_Z1 + ENCOSTO_T, H), (D, 10.0), (D, 0.0),
])
assert perfil.is_valid
corpo = prisma_x(perfil, 0.0, W)

# casca: cavidade com o mesmo perfil recuado, aberta no fundo
corpo = corpo.difference(prisma_x(perfil.buffer(-PAREDE, join_style=2), PAREDE, W - PAREDE))
# fundo aberto: a peça apoia no perímetro da casca e economiza uns 15 g de piso
corpo = corpo.difference(trimesh.creation.box(extents=[W - 2 * PAREDE, PAREDE + 1.0, D - 2 * PAREDE])
                         .apply_translation([W / 2, (PAREDE + 1.0) / 2 - 1.0, D / 2]))

# passagem de cabo, no rodapé da frente
cabo = sbox(W / 2 - CABO_L / 2, -1.0, W / 2 + CABO_L / 2, CABO_A)
cabo = cabo.buffer(-3.0, join_style=1).buffer(3.0, join_style=1)
corpo = corpo.difference(na_frente(cabo, FRENTE_T + 2.0))

# venezianas nas duas laterais, dentro da espessura da parede frontal (z de 3 a 10)
vent = []
for z0 in (0.0, W - 1.2):
    y = 17.0
    while y <= 34.0:
        vent.append(trimesh.creation.box(extents=[1.3, 1.6, 7.0]).apply_translation(
            [z0 + 0.65, y, 3.0 + 7.0 / 2]))
        y += 3.6
corpo = corpo.difference(trimesh.util.concatenate(vent))

# ---------- detalhes da frente (segunda cor) ----------
# Alturas medidas para não colidirem: indicadores 32,5..41,5; raio 21..31;
# título 13,3..19,7; subtítulo 8,7..12,3; passagem de cabo 0..7,5.
detalhes2d = []
for i in range(5):                                         # cinco indicadores de carga
    detalhes2d.append(affinity.translate(pilha_shape(5.4, 9.0), W / 2 + (i - 2) * 9.0, 37.0))
detalhes2d.append(affinity.translate(raio_shape(10.0), W / 2, 26.0))
detalhes2d.append(affinity.translate(text_shape("FÓRUM BESS 2026", 6.0, max_width=54.0),
                                     W / 2, 16.5))
detalhes2d.append(affinity.translate(text_shape("ENGENHARIA · ENERGIA · FUTURO", 3.2,
                                                max_width=54.0), W / 2, 10.5))
detalhes = na_frente(unary_union(detalhes2d), RELIEF + SINK)

# ---------- verificação e exportação ----------
for nome, m in [("corpo", corpo), ("detalhes", detalhes)]:
    m.merge_vertices()
    m.fix_normals()
    print(f"{nome:10s} fechada={m.is_watertight}  volume={m.volume:9.1f} mm³  "
          f"massa={m.volume / 1000 * DENSIDADE:6.2f} g")
total_g = (corpo.volume + detalhes.volume) / 1000 * DENSIDADE
print(f"{'peça':10s} {W:.0f} x {D:.0f} x {H:.0f} mm   massa da casca {total_g:.1f} g "
      f"(sem contar o preenchimento, que é vazio aqui)")

TO_Z_UP = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])
uma_cor = corpo.union(detalhes)
uma_cor.apply_transform(TO_Z_UP)
uma_cor.apply_translation([0, 0, -uma_cor.bounds[0][2]])
uma_cor.merge_vertices()
print(f"{'stl':10s} fechada={uma_cor.is_watertight}  medidas={np.round(uma_cor.extents, 1)}")
uma_cor.export("suporte_celular.stl")

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from bambu3mf import write_3mf, place_in_rows

PALETTE = [("1_corpo", "Laranja", "#E8712B"), ("2_detalhes", "Preto", "#1A1A1A")]
pecas = []
for cor, m in [("1_corpo", corpo), ("2_detalhes", detalhes)]:
    e = m.copy()
    e.apply_transform(TO_Z_UP)
    pecas.append((cor, e))
objects = [("suporte_celular", pecas)]
place_in_rows(objects, [["suporte_celular"]])
# precision=4: o subtítulo tem letra de 3,2 mm, e arredondar para 3 casas colapsa
# quatro faces do relevo e abre a malha — a trava do bambu3mf pega isso.
slots = write_3mf("suporte_celular.3mf", "Suporte de celular Fórum BESS 2026",
                  objects, PALETTE, precision=4)
print("filamentos:", ", ".join(f"{k} = {v}" for k, v in slots.items()))
print("arquivos gravados")
