"""Miniatura de mesa de grupo gerador diesel Cummins carenado, escala 1:50, para cúpula
de acrílico de 90 x 90 x 110 mm internos. Brinde da DCCO.

Referência: ficha do Cummins C150D6D com cabine acústica nível 2 — 3621 mm de comprimento
e 1836 mm de altura. A largura publicada nessa ficha (1016 mm) é a do chassi, não a da
cabine, então a carenagem foi desenhada com 1250 mm, largura típica de cabine para essa
faixa de potência. Em 1:50 -> 72,4 x 25,0 x 36,7 mm; com a placa de 3 mm, 39,7 mm.

Carenagem verde com chassi preto, como o gerador real. Três filamentos: verde na cabine e
no teto, preto no chassi, na placa e no escapamento, branco no logo da DCCO e nas letras da
placa — o logo branco sobre o verde é como a máquina real. A linha entre chassi e cabine é a própria troca de cor.

Costado, da esquerda para a direita: grade do radiador, porta de acesso com visor do painel
de controle, painel fixo com o crachá da DCCO, segunda porta de acesso, maçanetas. Chassi com
bolsos de empilhadeira. O teto imprime de cabeça para baixo, então tudo nele é corte e nunca
saliência: a saída do escapamento é um rebaixo com furo, e as nervuras são ranhuras.

Nenhuma segunda cor em parede vertical, que foi o que estragou o logo do contêiner da WEG
na impressão: em parede vertical cada camada do logo é uma ilha solta depositada logo depois
de uma troca de filamento. O logo saiu do costado e virou crachá à parte, impresso deitado e
colado no rebaixo; as maçanetas passaram para a cor da própria carenagem, que é como as
dobradiças do painel da CCR — quem as desenha é a sombra, não a cor.

Peças (impressão sem suporte):
  corpo  - casca oca aberta em cima, parede 1,6 mm, fundo 2,0 mm; imprime apoiado no chassi
  teto   - tampa com aba de encaixe; imprime de cabeça para baixo
  cracha - 20 x 10 x 1,5 mm; imprime deitado, logo para cima, e vai colado no painel fixo
  escap. - chaminé de 5,1 x 7,7 mm; imprime em pé e encaixa no rebaixo do teto
  placa  - base de 84 x 84 x 3 mm; o gerador é comprido e estreito, então as faixas livres
           ficam na frente e no fundo, com 29,5 mm cada

Eixos de construção: X = comprimento, Y = altura, Z = profundidade (costado do logo em +Z).
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
SCALE = 50.0
W, H, D = 3621 / SCALE, 1836 / SCALE, 1250 / SCALE        # 72,4 x 36,7 x 25,0
R_CORNER = 1.2
WALL, FLOOR = 1.6, 2.0
CAP_T, CAP_LIP, CAP_CLEAR = 2.5, 3.5, 0.25
BODY_TOP = H - CAP_T
CHASSI = 6.0                                              # altura do chassi (preto)
TOP_RAIL = 1.4
RELIEF, SINK = 0.7, 0.05
GROOVE = 0.45
PLATE_S, PLATE_T = 84.0, 3.0
FONT = FontProperties(fname="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
LOGO_PNG = "/home/user/abeemt/nl/dcco.png"


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


# ---------- logo da DCCO vetorizado do arquivo oficial ----------
def dcco_shape(cache="dcco_shape.pkl"):
    if os.path.exists(cache):
        return pickle.load(open(cache, "rb"))
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from PIL import Image
    a = np.array(Image.open(LOGO_PNG).convert("RGB")).astype(float)
    mask = (a.sum(2) < 380).astype(float)                 # logo quase preto sobre branco
    ys, xs = np.nonzero(mask > 0.5)
    mask = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    segs = plt.contour(np.pad(mask, 2), levels=[0.5]).allsegs[0]
    polys = sorted((Polygon(s).buffer(0) for s in segs if len(s) >= 4),
                   key=lambda p: p.area, reverse=True)
    shape = None
    for p in polys:
        p = p.simplify(0.8)
        if shape is None:
            shape = p
        elif shape.contains(p.representative_point()):
            shape = shape.difference(p)
        else:
            shape = shape.union(p)
    shape = affinity.scale(shape, 1, -1, origin="center")  # imagem tem Y para baixo
    pickle.dump(shape, open(cache, "wb"))
    return shape


def dcco_mesh(width, height_relief, fatten=0.06):
    """Engorda de 0,06 mm por lado: no tamanho usado, o traço mais fino do símbolo
    ficava em 0,76 mm, logo abaixo do que o bico de 0,4 mm consegue formar."""
    s = dcco_shape()
    minx, miny, maxx, maxy = s.bounds
    k = width / (maxx - minx)
    s = affinity.scale(s, k, k, origin=(minx, miny)).buffer(fatten, join_style=1).simplify(0.01)
    geoms = list(s.geoms) if hasattr(s, "geoms") else [s]
    m = trimesh.util.concatenate([extrude_polygon(g, height_relief) for g in geoms])
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


# ---------- corpo: carenagem oca aberta em cima ----------
outer2d = rounded_rect(0, 0, W, D, R_CORNER)
inner2d = rounded_rect(WALL, WALL, W - WALL, D - WALL, 0.6)
body = profile_prism(outer2d, 0, BODY_TOP).difference(profile_prism(inner2d, FLOOR, BODY_TOP + 1))

PANEL_Y0, PANEL_Y1 = CHASSI + 1.4, BODY_TOP - TOP_RAIL


def louver(x0, x1, y0, y1, face, passo=1.9):
    """Grade de venezianas: ranhuras horizontais rasas, com moldura.
    Passo de 1,9 mm em vez do passo real — em 1:50 as lâminas verdadeiras deixariam
    menos de 0,8 mm de material entre ranhuras, abaixo do que o bico de 0,4 mm forma."""
    z = D - 0.55 if face == "front" else -0.01
    cortes, y = [], y0 + 0.7
    while y <= y1 - 1.0:
        cortes.append(rbox(x1 - x0, 0.9, 0.56, x0, y, z))
        y += passo
    # A moldura tem de romper a superfície externa, e a externa de cada costado está em
    # lado oposto: no fundo, um rasgo começando em z = +0,09 ficava enterrado na parede e
    # virava vazio fechado dentro dela, invisível por fora.
    zo = z + 0.1 if face == "front" else z - 0.1
    o = rbox(x1 - x0 + 1.4, y1 - y0, GROOVE, x0 - 0.7, y0, zo)
    i = rbox(x1 - x0 + 1.4 - 2 * GROOVE, y1 - y0 - 2 * GROOVE, GROOVE + 1,
             x0 - 0.7 + GROOVE, y0 + GROOVE, z - 0.45)
    return trimesh.util.concatenate(cortes + [o.difference(i)])


def door(x0, x1, y0, y1, face):
    z = D - GROOVE if face == "front" else -0.01
    o = rbox(x1 - x0, y1 - y0, GROOVE, x0, y0, z)
    i = rbox(x1 - x0 - 2 * GROOVE, y1 - y0 - 2 * GROOVE, GROOVE + 1,
             x0 + GROOVE, y0 + GROOVE, z - 0.45 if face == "front" else z + 0.45)
    return o.difference(i)


# Costado da frente
RAD_X0, RAD_X1 = 2.4, 15.4                                # grade do radiador
DOOR1_X0, DOOR1_X1 = 16.4, 31.4                           # porta com visor do painel
LOGO_X0, LOGO_X1 = 32.4, 52.4                             # painel fixo do logo
DOOR2_X0, DOOR2_X1 = 53.4, 68.4
cortes = [
    louver(RAD_X0, RAD_X1, PANEL_Y0 + 0.8, PANEL_Y1 - 0.8, "front"),
    door(DOOR1_X0, DOOR1_X1, PANEL_Y0, PANEL_Y1, "front"),
    door(DOOR2_X0, DOOR2_X1, PANEL_Y0, PANEL_Y1, "front"),
    # visor do painel de controle, rebaixado na porta 1
    rbox(9.0, 6.0, 0.6, DOOR1_X0 + 3.0, PANEL_Y1 - 8.0, D - 0.6),
    # costado de trás: saída de ar, painel longo de venezianas
    louver(4.0, W - 4.0, PANEL_Y0 + 1.0, PANEL_Y1 - 1.0, "back", passo=2.2),
]
body = body.difference(trimesh.util.concatenate(cortes))

# Chassi: bolsos de empilhadeira e linha de topo, nos dois costados
for z in (D - 0.7, -0.01) :
    for cx in (W * 0.28, W * 0.72):
        body = body.difference(rbox(8.0, 2.4, 0.71, cx - 4.0, 1.4, z))

# Chassi preto: mesma casca, cor separada (corte em y = CHASSI)
chassi_part = body.intersection(rbox(W + 2, CHASSI + 1.05, D + 2, -1, -1, -1))
body_green = body.difference(rbox(W + 2, CHASSI + 1, D + 2, -1, -1, -1))

# ---------- teto: tampa com aba, escapamento e olhais ----------
cap_plate = profile_prism(outer2d, BODY_TOP, H)
lip2d = rounded_rect(WALL + CAP_CLEAR, WALL + CAP_CLEAR, W - WALL - CAP_CLEAR, D - WALL - CAP_CLEAR, 0.6)
cap_lip = profile_prism(lip2d, BODY_TOP - CAP_LIP, BODY_TOP + 0.01).difference(
    profile_prism(lip2d.buffer(-1.3, join_style=1), BODY_TOP - CAP_LIP - 1, BODY_TOP + 0.02))
cap = cap_plate.union(cap_lip)
# O teto imprime de cabeça para baixo, então tudo nele é corte, nunca saliência:
# saliência viraria pedestal apoiado na mesa. Saída do escapamento como rebaixo com
# furo, e nervuras transversais rasas.
def cortes_teto():
    cortes = []
    flange = cylinder(radius=2.6, height=1.2, sections=32)
    flange.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    flange.apply_translation([W - 16.0, H - 0.1, D / 2])
    cortes.append(flange)
    furo = cylinder(radius=1.3, height=2.4, sections=28)
    furo.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    furo.apply_translation([W - 16.0, H - 0.7, D / 2])
    # Uniao, nao concatenacao: os dois cilindros do escapamento sao coaxiais e se
    # sobrepoem, e subtrair a colagem dos dois deixava um vazio fechado de 10 mm3
    # dentro do teto, no lugar do furo.
    cortes.append(cortes.pop().union(furo))
    x = 6.0
    while x <= W - 6.0:
        if abs(x - (W - 16.0)) > 4.0:
            cortes.append(rbox(0.6, 0.36, D - 6.0, x, H - 0.35, 3.0))
        x += 3.0
    return trimesh.util.concatenate(cortes)


cap = cap.difference(cortes_teto())

# ---------- escapamento: peça separada, encaixada no rebaixo do teto ----------
# No teto ele não pode nascer: a tampa imprime de cabeça para baixo, e qualquer saliência
# viraria um pedestal de 7 mm apoiado na mesa com a tampa inteira pendurada nele. Como
# peça à parte ele imprime em pé, apoiado no próprio disco de base — 20 mm² na mesa, que
# é o que segura uma peça fina desse tamanho.
#
# A chaminé sai com o topo cortado a 45° em vez do cotovelo curvo da foto. O cotovelo
# termina apontando para o lado, e a última parte dele seria um balanço horizontal sem
# nada embaixo. O corte a 45° é o limite que o bico forma sozinho, e em 1:50 lê como
# escapamento do mesmo jeito. Se preferir o cotovelo de verdade, dá para fazer a peça
# deitada, mas aí ela ganha um repuxo na barriga onde toca a mesa.
ESC_CX, ESC_CZ = W - 16.0, D / 2            # mesmo ponto do rebaixo já existente no teto
ESC_BASE_R, ESC_BASE_H = 2.55, 0.7          # entra no rebaixo de 2,6 e 0,7 do teto
ESC_R, ESC_ALT, ESC_FURO_R = 1.8, 7.0, 0.9  # parede de 0,9 mm na boca


def _em_pe(m, y0):
    """Cilindro do trimesh tem eixo em Z; aqui o eixo da peça é Y."""
    m.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    m.apply_translation([ESC_CX, y0, ESC_CZ])
    return m


Y0 = H - ESC_BASE_H                                        # disco assenta no rebaixo
disco = _em_pe(cylinder(radius=ESC_BASE_R, height=ESC_BASE_H, sections=48),
               Y0 + ESC_BASE_H / 2)
tubo = _em_pe(cylinder(radius=ESC_R, height=ESC_ALT, sections=48), H + ESC_ALT / 2)
escapamento = disco.union(tubo)
# Corte a 45°, virado para o fundo do gerador. O plano passa pelo eixo do tubo a
# ESC_R abaixo do topo, então a boca vai de H+2,4 (ponto baixo) a H+6,0 (ponto alto) e
# usa a altura toda da chaminé. A caixa de corte nasce nesse plano e sobe: girada em
# torno do mesmo ponto, ela tira só a cunha de cima e deixa uma rampa voltada para cima,
# que não é balanço nenhum.
ESC_PY = H + ESC_ALT - ESC_R
corte = rbox(6 * ESC_R, 6 * ESC_R, 6 * ESC_R, ESC_CX - 3 * ESC_R, ESC_PY, ESC_CZ - 3 * ESC_R)
corte.apply_transform(trimesh.transformations.rotation_matrix(
    np.pi / 4, [1, 0, 0], point=[ESC_CX, ESC_PY, ESC_CZ]))
escapamento = escapamento.difference(corte)
escapamento = escapamento.difference(
    _em_pe(cylinder(radius=ESC_FURO_R, height=ESC_ALT, sections=32), H + ESC_ALT))

# ---------- crachá do logo: peça separada, impressa deitada e colada ----------
# O rebaixo é raso de propósito: 0,7 mm deixa 0,9 mm de parede sob ele e dispensa reforço
# por dentro, que aqui esbarraria na aba do teto. O crachá fica 0,8 mm saliente, como o
# emblema aplicado de um gerador de verdade, e o rebaixo serve de gabarito para a colagem.
CR_X0, CR_X1 = 32.4, 52.4                                 # 0,75 mm de parede até cada porta
CR_Y0, CR_Y1 = (PANEL_Y0 + PANEL_Y1) / 2 - 5.0, (PANEL_Y0 + PANEL_Y1) / 2 + 5.0
CR_T, CR_BOLSO, CR_FOLGA = 1.5, 0.7, 0.25
# o rebaixo fica todo acima da linha do chassi, então só a carenagem verde é recortada
body_green = body_green.difference(
    rbox(CR_X1 - CR_X0 + 2 * CR_FOLGA, CR_Y1 - CR_Y0 + 2 * CR_FOLGA, CR_BOLSO + 0.5,
         CR_X0 - CR_FOLGA, CR_Y0 - CR_FOLGA, D - CR_BOLSO))

CZ0, CZ1 = D - CR_BOLSO, D - CR_BOLSO + CR_T
cracha = rbox(CR_X1 - CR_X0, CR_Y1 - CR_Y0, CR_T, CR_X0, CR_Y0, CZ0)
# logo embutido rente à face, como no painel da CCR: superfície lisa e três camadas de troca
# 18 mm de largura, não 16: o traço mais fino do símbolo cresce com o desenho inteiro,
# e a 16 mm ele caía para 0,79 mm. Engordar a curva em vez de crescer o desenho fecharia
# as frestas do espiral, que é o que dá a forma do símbolo.
CR_LOGO_W, CR_LOGO_PROF = 18.0, 0.6
CR_CX, CR_CY = (CR_X0 + CR_X1) / 2, (CR_Y0 + CR_Y1) / 2
bolso_logo = dcco_mesh(CR_LOGO_W, CR_LOGO_PROF + 0.5)
bolso_logo.apply_translation([CR_CX, CR_CY, CZ1 - CR_LOGO_PROF])
cracha = cracha.difference(bolso_logo)
cracha_logo = dcco_mesh(CR_LOGO_W, CR_LOGO_PROF + SINK)   # branco, como na foto
cracha_logo.apply_translation([CR_CX, CR_CY, CZ1 - CR_LOGO_PROF - SINK])

# Maçanetas na cor da própria carenagem: em parede vertical, uma barra preta de 1,2 mm
# seria a mesma ilha solta do logo, camada após camada. Em relevo verde, quem as desenha
# é a sombra, e não há troca de filamento nenhuma no costado.
macanetas = trimesh.util.concatenate([
    rbox(1.2, 5.0, 1.0, DOOR1_X1 - 3.0, (PANEL_Y0 + PANEL_Y1) / 2 - 2.5, D - SINK),
    rbox(1.2, 5.0, 1.0, DOOR2_X1 - 3.0, (PANEL_Y0 + PANEL_Y1) / 2 - 2.5, D - SINK),
])
body_green = body_green.union(macanetas)

# ---------- placa de base para a cúpula ----------
px0, pz0 = (W - PLATE_S) / 2, (D - PLATE_S) / 2
plate = profile_prism(rounded_rect(px0, pz0, px0 + PLATE_S, pz0 + PLATE_S, 4.0), -PLATE_T, 0)
plate = plate.difference(profile_prism(outer2d.buffer(0.2, join_style=1).simplify(0.001), -0.8, 0.01))

# Gerador comprido e estreito: sobram 29,5 mm de faixa na frente e no fundo.
PZ0, PZ1 = pz0, pz0 + PLATE_S
plate_marks = trimesh.util.concatenate([
    lying_text("FÓRUM BESS 2026", 9.0, D + 9.0),
    lying_text("GRUPO GERADOR", 6.5, D + 21.0),
    lying_text("ABEE-MT", 9.0, PZ0 + 22.0, back=True),
    lying_emblem(13.0, W / 2, PZ0 + 8.5),
])

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from bambu3mf import write_3mf, place_in_rows, clean_mesh

# ---------- exportação ----------
parts = {
    "carenagem_verde": body_green,
    "chassi_preto": chassi_part,
    "cracha_verde": cracha,
    "cracha_logo_branco": cracha_logo,
    "escapamento_preto": escapamento,
    "teto_verde": cap,
    "placa_base": plate,
    "emblema_e_textos": plate_marks,
}
for name, m in parts.items():
    m.merge_vertices()
    m.fix_normals()
    print(f"{name:20s} watertight={m.is_watertight}  volume={m.volume:8.0f} mm³")

TO_Z_UP = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])

body_stl = body_green.union(chassi_part)
body_stl.apply_transform(TO_Z_UP)
body_stl = clean_mesh(body_stl)
print(f"{'stl_corpo':20s} watertight={body_stl.is_watertight}  volume={body_stl.volume:8.0f} mm³"
      f"  medidas={np.round(body_stl.extents, 1)}")
body_stl.export("miniatura_dcco_corpo.stl")

# o crachá sai deitado, com o logo para cima: não leva TO_Z_UP nenhum
cracha_stl = cracha.union(cracha_logo)
cracha_stl.apply_translation([0, 0, -cracha_stl.bounds[0][2]])
cracha_stl = clean_mesh(cracha_stl)
print(f"{'stl_cracha':20s} watertight={cracha_stl.is_watertight}  volume={cracha_stl.volume:8.0f} mm³"
      f"  medidas={np.round(cracha_stl.extents, 1)}")
cracha_stl.export("miniatura_dcco_cracha.stl")

cap_stl = cap.copy()
cap_stl.apply_transform(TO_Z_UP)
cap_stl.apply_translation([0, 0, -cap_stl.bounds[0][2]])
cap_stl = clean_mesh(cap_stl)
print(f"{'stl_teto':20s} watertight={cap_stl.is_watertight}  volume={cap_stl.volume:8.0f} mm³"
      f"  medidas={np.round(cap_stl.extents, 1)}")
cap_stl.export("miniatura_dcco_teto.stl")

plate_stl = plate.union(plate_marks)
plate_stl.apply_transform(TO_Z_UP)
plate_stl.apply_translation([0, 0, -plate_stl.bounds[0][2]])
plate_stl = clean_mesh(plate_stl)
print(f"{'stl_placa':20s} watertight={plate_stl.is_watertight}  volume={plate_stl.volume:8.0f} mm³"
      f"  medidas={np.round(plate_stl.extents, 1)}")
plate_stl.export("miniatura_dcco_placa.stl")

esc_stl = escapamento.copy()
esc_stl.apply_transform(TO_Z_UP)
esc_stl.apply_translation([0, 0, -esc_stl.bounds[0][2]])
esc_stl = clean_mesh(esc_stl)
print(f"{'stl_escapamento':20s} watertight={esc_stl.is_watertight}  volume={esc_stl.volume:8.0f} mm³"
      f"  medidas={np.round(esc_stl.extents, 2)}")
esc_stl.export("miniatura_dcco_escapamento.stl")

# ---------- 3MF ----------

COLOR_GROUPS = {
    "gerador_corpo":  {"1_verde": ["carenagem_verde"], "2_preto": ["chassi_preto"]},
    "gerador_cracha": {"1_verde": ["cracha_verde"], "3_branco": ["cracha_logo_branco"]},
    "gerador_escapamento": {"2_preto": ["escapamento_preto"]},
    "gerador_teto":   {"1_verde": ["teto_verde"]},
    "placa_base":     {"2_preto": ["placa_base"], "3_branco": ["emblema_e_textos"]},
}
# O verde é a cor do gerador Cummins carenado. Não está no estoque atual (cinza, preto,
# branco) — sem ele, o filamento 1 pode ser o cinza e a peça fica coerente, só não fica
# na cor da máquina real.
PALETTE = [("1_verde", "Verde", "#2E6E45"),
           ("2_preto", "Preto", "#1A1A1A"),
           ("3_branco", "Branco", "#EDEFEE")]
flip = trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0])


def placed(name, obj):
    e = parts[name].copy()
    if obj == "gerador_cracha":
        return e          # já está deitado, logo para cima: é o ponto da mudança
    e.apply_transform(TO_Z_UP)
    if obj == "gerador_teto":
        e.apply_transform(flip)
    return e


def monta(nomes):
    return [(obj, [(cor, trimesh.util.concatenate([placed(n, obj) for n in ns]))
                   for cor, ns in COLOR_GROUPS[obj].items()]) for obj in nomes]


# Duas mesas, agrupadas por qual cor está embaixo em cada peça — é isso que decide a purga.
# Numa mesa só, o fatiador precisa trocar de filamento DENTRO de cada camada sempre que dois
# objetos pedem cores diferentes na mesma altura: o chassi preto do corpo convive com o teto
# verde por 30 camadas, e cada uma custa uma troca. Separando as peças que começam pretas
# das que começam verdes, as trocas caem de ~40 para ~15, e a torre de purga encolhe junto.
# O arquivo "multicor" continua existindo para quem preferir um trabalho só.
MESAS = [
    ("multicor", list(COLOR_GROUPS),
     [["gerador_corpo", "gerador_escapamento"], ["gerador_teto", "gerador_cracha"],
      ["placa_base"]]),
    ("mesa1_base_preta", ["gerador_corpo", "gerador_escapamento", "placa_base"],
     [["gerador_corpo", "gerador_escapamento"], ["placa_base"]]),
    ("mesa2_base_verde", ["gerador_teto", "gerador_cracha"],
     [["gerador_teto", "gerador_cracha"]]),
]
for sufixo, nomes, fileiras in MESAS:
    objs = monta(nomes)
    place_in_rows(objs, fileiras)
    # precision=4: o contorno traçado do logo tem segmentos quase colineares, e arredondar
    # o bolso do crachá para 3 casas colapsa faces e abre a malha — a trava do bambu3mf pega.
    slots = write_3mf(f"miniatura_dcco_{sufixo}.3mf",
                      "Miniatura gerador Cummins carenado 1:50", objs, PALETTE, precision=4)
    print(f"{'3mf_' + sufixo:20s} {len(objs)} objetos, filamentos: "
          + ", ".join(f"{k} = {v}" for k, v in slots.items()))
print("arquivos gravados")
