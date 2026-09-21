"""Miniatura de mesa do WEG BESS em contêiner, escala 1:80, para cúpula de acrílico
de 90 x 90 x 110 mm internos.

Referência: o catálogo BESS da WEG (WEG-ESSW-50100618) descreve a solução integrada como
"optimized for space efficiency within a 20-foot e-house", e a foto oficial mostra um
contêiner ISO de 20 pés claro, uniforme. Medidas externas ISO: 6058 x 2438 x 2591 mm.
Em 1:80 -> 75,7 x 30,5 x 32,4 mm; com a placa de 3 mm, 35,4 mm de altura.

Diferente das outras duas maquetes de propósito: aquelas são gabinetes verticais, esta é
o contêiner deitado, e o corpo inteiro sai numa cor só de cinza, como no material da WEG.
Três cores ao todo: cinza no contêiner, preto na placa e no logo, laranja nas letras e
no emblema da placa — a mesma letra laranja das outras três maquetes.

Lado longo, da esquerda para a direita (conforme a foto oficial): montante de canto,
painel alto de venezianas, painel com o logo weg + BESS, seis folhas de porta com haste
vertical de fechamento, montante de canto. Cantoneiras ISO nos oito cantos, longarina de
base com bolsos de empilhadeira e teto com nervuras transversais.

O painel do logo é peça à parte, impressa deitada e colada no bolso do costado. Na
primeira impressão o logo era relevo de segunda cor direto na parede vertical, e saiu
ilegível: em parede vertical cada camada do logo é uma ilha solta depositada logo depois
de uma troca de filamento, e em 1:80 essas ilhas têm menos de um milímetro. Deitada, a
mesma arte vira mancha plana sobre superfície horizontal e a troca de cor acontece em
três camadas no total.

Peças (impressão sem suporte):
  corpo - casca oca aberta em cima, parede 1,6 mm, fundo 2,0 mm; imprime apoiado na base
  teto  - tampa com aba de encaixe; imprime de cabeça para baixo
  chapa - painel do logo, 19 x 20,4 x 1,6 mm; imprime deitado, arte para cima, e vai colado
  placa - base de 84 x 84 x 3 mm; o contêiner é comprido, então as faixas livres da placa
          ficam na frente e no fundo, com 26,8 mm cada — as maiores letras do conjunto

Eixos de construção: X = comprimento, Y = altura, Z = profundidade (lado do logo em +Z).
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
SCALE = 80.0
W, H, D = 6058 / SCALE, 2591 / SCALE, 2438 / SCALE       # 75,7 x 32,4 x 30,5
R_CORNER = 0.4                                            # contêiner tem canto vivo
WALL, FLOOR = 1.6, 2.0
CAP_T, CAP_LIP, CAP_CLEAR = 2.2, 3.0, 0.25
BODY_TOP = H - CAP_T
POST = 2.2                                                # montante de canto
BASE_RAIL = 3.8                                           # longarina de base
TOP_RAIL = 1.6
RELIEF, SINK = 0.6, 0.05
GROOVE = 0.4
PLATE_S, PLATE_T = 84.0, 3.0
FONT = FontProperties(fname="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
LOGO_PNG = "/home/user/abeemt/nl/weg.png"


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


# ---------- logo da WEG vetorizado do arquivo oficial ----------
def weg_shape(cache="weg_shape.pkl"):
    """Moldura e letras do logo. Os vãos ficam vazados: o cinza do corpo aparece por
    eles, que é a relação de figura e fundo do logo real."""
    if os.path.exists(cache):
        return pickle.load(open(cache, "rb"))
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from PIL import Image
    a = np.array(Image.open(LOGO_PNG).convert("RGB")).astype(float)
    mask = ((a[:, :, 2] > 110) & (a[:, :, 0] < 160)).astype(float)       # azul WEG #005CA5
    ys, xs = np.nonzero(mask > 0.5)
    mask = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    segs = plt.contour(np.pad(mask, 2), levels=[0.5]).allsegs[0]
    polys = sorted((Polygon(s).buffer(0) for s in segs if len(s) >= 4),
                   key=lambda p: p.area, reverse=True)
    shape = None
    for p in polys:
        p = p.simplify(1.2)
        if shape is None:
            shape = p
        elif shape.contains(p.representative_point()):
            shape = shape.difference(p)
        else:
            shape = shape.union(p)
    shape = affinity.scale(shape, 1, -1, origin="center")
    assert len(shape.geoms) == 3
    pickle.dump(shape, open(cache, "wb"))
    return shape


def weg_mesh(width, height_relief):
    s = weg_shape()
    minx, miny, maxx, maxy = s.bounds
    k = width / (maxx - minx)
    s = affinity.scale(s, k, k, origin=(minx, miny))
    m = trimesh.util.concatenate([extrude_polygon(g, height_relief) for g in s.geoms])
    b = m.bounds
    m.apply_translation([-(b[0][0] + b[1][0]) / 2, -(b[0][1] + b[1][1]) / 2, 0])
    return m


# ---------- texto ----------
def text_flat(txt, cap_height, height, max_width=None, fatten=0.20):
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


def _lay_flat(m):
    m.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    return m


def lying_text(txt, cap, cz, max_width=72, height=1.5, back=False):
    m = _lay_flat(text_flat(txt, cap, height, max_width=max_width))
    if back:
        m.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [0, 1, 0]))
    m.apply_translation([W / 2, -SINK, cz])
    return m


def lying_emblem(diam, cx, cz, height=1.5):
    r_out = diam / 2
    ring = Point(0, 0).buffer(r_out, 64).difference(Point(0, 0).buffer(r_out - 0.9, 64))
    h = diam * 0.72
    bolt = Polygon([(0.55, 1.0), (0.10, 0.42), (0.42, 0.42), (0.30, 0.0),
                    (0.90, 0.58), (0.58, 0.58), (0.70, 1.0)])
    bolt = affinity.translate(affinity.scale(bolt, h, h, origin=(0, 0)), -0.5 * h, -0.5 * h)
    shape = unary_union([ring, bolt.buffer(0.05, join_style=2)])
    geoms = list(shape.geoms) if hasattr(shape, "geoms") else [shape]
    m = _lay_flat(trimesh.util.concatenate([extrude_polygon(g, height) for g in geoms]))
    m.apply_translation([cx, -SINK, cz])
    return m


# ---------- corpo: casca oca aberta em cima ----------
outer2d = rounded_rect(0, 0, W, D, R_CORNER)
inner2d = rounded_rect(WALL, WALL, W - WALL, D - WALL, 0.4)
body = profile_prism(outer2d, 0, BODY_TOP).difference(profile_prism(inner2d, FLOOR, BODY_TOP + 1))

PANEL_Y0, PANEL_Y1 = BASE_RAIL, BODY_TOP - TOP_RAIL       # faixa útil do costado


def louver_panel(x0, x1, y0, y1, face):
    """Painel de venezianas: ranhuras horizontais rasas, no costado da frente ou do fundo.
    Passo de 1,8 mm em vez do passo real: em 1:80 as lâminas reais dariam 1,0 mm de
    material entre ranhuras, abaixo do que o bico de 0,4 mm forma."""
    z = D - 0.5 if face == "front" else -0.01
    cortes, y = [], y0 + 0.6
    while y <= y1 - 0.9:
        cortes.append(rbox(x1 - x0, 0.8, 0.51, x0, y, z))
        y += 1.8
    # A moldura tem de romper a superfície externa, e a externa de cada costado está em
    # lado oposto: no fundo, um rasgo começando em z = +0,09 ficava enterrado na parede e
    # virava vazio fechado dentro dela, invisível por fora.
    zo = z + 0.1 if face == "front" else z - 0.1
    moldura_o = rbox(x1 - x0 + 1.2, y1 - y0, GROOVE, x0 - 0.6, y0, zo)
    moldura_i = rbox(x1 - x0 + 1.2 - 2 * GROOVE, y1 - y0 - 2 * GROOVE, GROOVE + 1,
                     x0 - 0.6 + GROOVE, y0 + GROOVE, z - 0.4)
    return trimesh.util.concatenate(cortes + [moldura_o.difference(moldura_i)])


def door_leaf(x0, x1, y0, y1, face):
    """Rasgo de contorno de uma folha de porta."""
    z = D - GROOVE if face == "front" else -0.01
    o = rbox(x1 - x0, y1 - y0, GROOVE, x0, y0, z)
    i = rbox(x1 - x0 - 2 * GROOVE, y1 - y0 - 2 * GROOVE, GROOVE + 1,
             x0 + GROOVE, y0 + GROOVE, z - 0.4 if face == "front" else z + 0.4)
    return o.difference(i)


# Costado da frente: venezianas, painel do logo, seis folhas de porta
# O vão do logo abriu de 14 para 19 mm: com o logo impresso deitado dá para usá-lo maior,
# e traço maior é o segundo remédio para o que saiu ilegível na primeira impressão.
LV_X0, LV_X1 = POST + 1.2, POST + 7.6
LOGO_X0, LOGO_X1 = LV_X1 + 2.0, LV_X1 + 21.0
DOOR_X0, DOOR_X1 = LOGO_X1 + 2.0, W - POST - 1.2
cortes = [louver_panel(LV_X0, LV_X1, PANEL_Y0 + 1.0, PANEL_Y1 - 1.0, "front")]
n_folhas = 6
passo = (DOOR_X1 - DOOR_X0) / n_folhas
for i in range(n_folhas):
    cortes.append(door_leaf(DOOR_X0 + i * passo + 0.25, DOOR_X0 + (i + 1) * passo - 0.25,
                            PANEL_Y0 + 0.8, PANEL_Y1 - 0.8, "front"))
# Costado do fundo: venezianas longas do sistema de refrigeração
cortes.append(louver_panel(POST + 3.0, W - POST - 3.0, PANEL_Y0 + 1.2, PANEL_Y1 - 1.2, "back"))
body = body.difference(trimesh.util.concatenate(cortes))

# Longarina de base com bolsos de empilhadeira, nos dois costados
for z in (D - 0.6, -0.01):
    for cx in (W * 0.30, W * 0.70):
        body = body.difference(rbox(7.0, 2.0, 0.61, cx - 3.5, 0.7, z))
for z in (D - GROOVE, -0.01):
    body = body.difference(rbox(W - 2 * POST, GROOVE, 0.41, POST, BASE_RAIL - GROOVE, z))

# Porta de pessoal na cabeceira esquerda (face -X)
body = body.difference(
    rbox(0.41, PANEL_Y1 - PANEL_Y0 - 1.6, 9.0, -0.01, PANEL_Y0 + 0.8, D / 2 - 4.5).difference(
        rbox(1.0, PANEL_Y1 - PANEL_Y0 - 1.6 - 2 * GROOVE, 9.0 - 2 * GROOVE,
             0.3, PANEL_Y0 + 0.8 + GROOVE, D / 2 - 4.5 + GROOVE)))

# Cantoneiras ISO: blocos salientes nos oito cantos. A de cima tem 2,4 mm e a linha de
# corte entre corpo e teto passa a 30,2, dentro dela; a fatia de baixo é do corpo e a de
# cima é do teto. Mandar a cantoneira inteira para o teto fazia a tampa assentar 0,2 mm
# alta, porque essa fatia disputava espaço com a parede do corpo.
castings_corpo, castings_teto = [], []
for cx in (0.0, W - POST):
    for cz in (0.0, D - POST):
        castings_corpo.append(rbox(POST, 2.4, POST, cx, 0.0, cz))
        castings_corpo.append(rbox(POST, BODY_TOP - (H - 2.4), POST, cx, H - 2.4, cz))
        castings_teto.append(rbox(POST, H - BODY_TOP, POST, cx, BODY_TOP, cz))
# União direta, sem recortar pelo perfil: cantoneira ISO real é saliente mesmo, e
# recortá-la pelo canto arredondado gerava slivers finos demais para gravar em 3 casas
body = body.union(trimesh.util.concatenate(castings_corpo)).difference(
    profile_prism(inner2d, FLOOR, BODY_TOP + 1))     # cantoneira não invade o vão da aba

# ---------- teto: tampa com aba e nervuras transversais ----------
cap_plate = profile_prism(outer2d, BODY_TOP, H)
lip2d = rounded_rect(WALL + CAP_CLEAR, WALL + CAP_CLEAR, W - WALL - CAP_CLEAR, D - WALL - CAP_CLEAR, 0.4)
cap_lip = profile_prism(lip2d, BODY_TOP - CAP_LIP, BODY_TOP + 0.01).difference(
    profile_prism(lip2d.buffer(-1.2, join_style=1), BODY_TOP - CAP_LIP - 1, BODY_TOP + 0.02))
cap = cap_plate.union(cap_lip)
ribs, x = [], POST + 2.0
while x <= W - POST - 2.0:
    ribs.append(rbox(0.5, 0.31, D - 2 * POST - 1.0, x, H - 0.3, POST + 0.5))
    x += 2.4
cap = cap.difference(trimesh.util.concatenate(ribs))
cap = cap.union(trimesh.util.concatenate(castings_teto))

# ---------- painel do logo: peça separada, impressa deitada e colada ----------
# Nada de relevo de segunda cor em parede vertical. A arte fica embutida rente à face
# da chapa, como no painel da CCR: o bolso na chapa é recortado com a própria silhueta
# e a peça preta o preenche, então a superfície sai lisa e a troca de cor dura três
# camadas. A fresta de 0,25 mm em volta da chapa lê como junta de painel, que o contêiner
# de verdade tem em toda a volta.
PLAQ_X0, PLAQ_X1 = LOGO_X0, LOGO_X1
PLAQ_Y0, PLAQ_Y1 = 5.6, 26.0
PLAQ_T, BOLSO_PROF, PLAQ_FOLGA = 1.6, 1.6, 0.25
PLAQ_CX = (PLAQ_X0 + PLAQ_X1) / 2

# Reforço atrás da chapa: o bolso consome a parede inteira de 1,6 mm, então o costado é
# engrossado por dentro. Vai do piso até 26,8 para não fazer aba em balanço lá embaixo e
# para não bater na aba do teto, que desce até y = 27,2.
body = body.union(rbox(PLAQ_X1 - PLAQ_X0 + 3.0, 26.8, BOLSO_PROF,
                       PLAQ_X0 - 1.5, 0.0, D - WALL - BOLSO_PROF))
body = body.difference(rbox(PLAQ_X1 - PLAQ_X0 + 2 * PLAQ_FOLGA, PLAQ_Y1 - PLAQ_Y0 + 2 * PLAQ_FOLGA,
                            BOLSO_PROF + 0.5, PLAQ_X0 - PLAQ_FOLGA, PLAQ_Y0 - PLAQ_FOLGA,
                            D - BOLSO_PROF))

CHZ0, CHZ1 = D - BOLSO_PROF, D - BOLSO_PROF + PLAQ_T      # chapa fica rente ao costado
plaq = rbox(PLAQ_X1 - PLAQ_X0, PLAQ_Y1 - PLAQ_Y0, PLAQ_T, PLAQ_X0, PLAQ_Y0, CHZ0)

LOGO_W, LOGO_PROF = 15.0, 0.6
arte = []
for cy, arte_mesh in ((19.05, lambda h: weg_mesh(width=LOGO_W, height_relief=h)),
                      (9.65, lambda h: text_flat("BESS", 4.2, h, max_width=LOGO_W))):
    bolso = arte_mesh(LOGO_PROF + 0.5)
    bolso.apply_translation([PLAQ_CX, cy, CHZ1 - LOGO_PROF])
    plaq = plaq.difference(bolso)
    cheio = arte_mesh(LOGO_PROF + SINK)
    cheio.apply_translation([PLAQ_CX, cy, CHZ1 - LOGO_PROF - SINK])
    arte.append(cheio)
logo_preto = trimesh.util.concatenate(arte)

# ---------- placa de base para a cúpula ----------
px0, pz0 = (W - PLATE_S) / 2, (D - PLATE_S) / 2
plate = profile_prism(rounded_rect(px0, pz0, px0 + PLATE_S, pz0 + PLATE_S, 4.0), -PLATE_T, 0)
plate = plate.difference(profile_prism(outer2d.buffer(0.2, join_style=1).simplify(0.001), -0.8, 0.01))

# O contêiner é comprido e raso: sobram 26,8 mm de faixa livre na frente e no fundo,
# e quase nada nas laterais. As letras aqui são as maiores das três maquetes.
PZ0, PZ1 = pz0, pz0 + PLATE_S
# Posições medidas a partir das bordas úteis de cada faixa: a da frente vai de
# D + 0,2 (borda do rebaixo) a PZ1, a do fundo de PZ0 a -0,2. Cada bloco fica com
# no mínimo 1,4 mm de folga da borda da placa, do rebaixo e do bloco vizinho.
plate_marks = trimesh.util.concatenate([
    lying_text("FMEES 2026", 9.0, D + 8.2),
    lying_text("WEG BESS", 6.0, D + 19.2),
    lying_text("ABEE-MT", 9.0, PZ0 + 20.5, back=True),
    lying_emblem(13.0, W / 2, PZ0 + 7.9),
])

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from bambu3mf import write_3mf, place_in_rows, clean_mesh

# ---------- exportação ----------
parts = {
    "corpo_cinza": body,
    "chapa_cinza": plaq,
    "chapa_logo_preto": logo_preto,
    "teto_cinza": cap,
    "placa_base": plate,
    "emblema_e_textos": plate_marks,
}
for name, m in parts.items():
    m.merge_vertices()
    m.fix_normals()
    print(f"{name:20s} watertight={m.is_watertight}  volume={m.volume:8.0f} mm³")

TO_Z_UP = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])

body_stl = body.copy()
body_stl.apply_transform(TO_Z_UP)
body_stl = clean_mesh(body_stl)
print(f"{'stl_corpo':20s} watertight={body_stl.is_watertight}  volume={body_stl.volume:8.0f} mm³"
      f"  medidas={np.round(body_stl.extents, 1)}")
body_stl.export("miniatura_weg_corpo.stl")

# a chapa sai deitada, com a arte para cima: não leva TO_Z_UP nenhum
chapa_stl = plaq.union(logo_preto)
chapa_stl.apply_translation([0, 0, -chapa_stl.bounds[0][2]])
chapa_stl = clean_mesh(chapa_stl)
print(f"{'stl_chapa':20s} watertight={chapa_stl.is_watertight}  volume={chapa_stl.volume:8.0f} mm³"
      f"  medidas={np.round(chapa_stl.extents, 1)}")
chapa_stl.export("miniatura_weg_chapa_logo.stl")

cap_stl = cap.copy()
cap_stl.apply_transform(TO_Z_UP)
cap_stl.apply_translation([0, 0, -cap_stl.bounds[0][2]])
cap_stl = clean_mesh(cap_stl)
print(f"{'stl_teto':20s} watertight={cap_stl.is_watertight}  volume={cap_stl.volume:8.0f} mm³"
      f"  medidas={np.round(cap_stl.extents, 1)}")
cap_stl.export("miniatura_weg_teto.stl")

plate_stl = plate.union(plate_marks)
plate_stl.apply_transform(TO_Z_UP)
plate_stl.apply_translation([0, 0, -plate_stl.bounds[0][2]])
plate_stl = clean_mesh(plate_stl)
print(f"{'stl_placa':20s} watertight={plate_stl.is_watertight}  volume={plate_stl.volume:8.0f} mm³"
      f"  medidas={np.round(plate_stl.extents, 1)}")
plate_stl.export("miniatura_weg_placa.stl")

# ---------- 3MF ----------

COLOR_GROUPS = {
    "weg_conteiner":  {"1_cinza": ["corpo_cinza"]},
    "weg_chapa_logo": {"1_cinza": ["chapa_cinza"], "2_preto": ["chapa_logo_preto"]},
    "weg_teto":       {"1_cinza": ["teto_cinza"]},
    "placa_base":     {"2_preto": ["placa_base"], "3_laranja": ["emblema_e_textos"]},
}
# Contêiner da WEG é uniforme, por isso corpo e teto saem na mesma cor. A placa vai em
# preto com letra laranja, igual às outras três maquetes: com as quatro placas na mesma
# dupla de cores dá para imprimir todas num trabalho só.
# ATENÇÃO: nesta maquete o filamento 1 é o CINZA, não o branco das outras duas.
PALETTE = [("1_cinza", "Cinza", "#C9CDCB"),
           ("2_preto", "Preto", "#1A1A1A"),
           ("3_laranja", "Laranja", "#E8712B")]
flip = trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0])


def placed(name, obj):
    e = parts[name].copy()
    if obj == "weg_chapa_logo":
        return e          # já está deitada, arte para cima: é o ponto da mudança
    e.apply_transform(TO_Z_UP)
    if obj == "weg_teto":
        e.apply_transform(flip)
    return e




def monta(nomes):
    return [(obj, [(cor, trimesh.util.concatenate([placed(n, obj) for n in ns]))
                   for cor, ns in COLOR_GROUPS[obj].items()]) for obj in nomes]


# Mesas agrupadas por qual cor está embaixo em cada peça — é isso que decide a purga.
# Numa mesa só, o fatiador troca de filamento DENTRO de cada camada sempre que dois objetos
# pedem cores diferentes na mesma altura, e são dezenas de camadas assim. Separando as peças
# que começam com a mesma cor, a troca vira uma por peça, sequencial em Z, e a torre encolhe.
#
# A placa de base saiu destas mesas: com as letras das quatro maquetes em laranja sobre
# preto, as quatro placas viraram a mesma dupla de cores e vão juntas em placas-base/,
# numa troca só para as quatro. Tirá-la daqui economiza mais sete trocas nesta mesa, porque
# o laranja dela convivia com as cores do modelo camada a camada.
# O arquivo "multicor" continua com tudo, para quem preferir um trabalho só.
PREFIXO, TITULO, PRECISAO = "miniatura_weg", "Miniatura WEG BESS contêiner 1:80", 3
MESAS = [
    ("multicor", list(COLOR_GROUPS),
     [["weg_conteiner"], ["weg_teto", "weg_chapa_logo"], ["placa_base"]]),
    ("mesa_conteiner", ["weg_conteiner", "weg_teto", "weg_chapa_logo"],
     [["weg_conteiner"], ["weg_teto", "weg_chapa_logo"]]),
]
for sufixo, nomes, fileiras in MESAS:
    objs = monta(nomes)
    place_in_rows(objs, fileiras)
    slots = write_3mf(f"{PREFIXO}_{sufixo}.3mf", TITULO, objs, PALETTE, precision=PRECISAO)
    print(f"{'3mf_' + sufixo:22s} {len(objs)} objetos, filamentos: "
          + ", ".join(f"{k} = {v}" for k, v in slots.items()))
print("arquivos gravados")
