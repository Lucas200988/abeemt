"""Bonecos de engenharia — CREA-MT e Mútua, FMEES 2026.

Duas peças de mesa, uma para cada patrocinador: um boneco estilizado de capacete
em pé sobre uma base, com uma placa de obra ao lado trazendo a marca. O CREA-MT
leva o engenheiro; a Mútua, a engenheira — o emblema dela já é um perfil feminino
com elmo, e a peça conversa com isso.

Estilizado de propósito, não realista. Rosto liso, volumes geométricos: é o que a
impressora faz bem e é o que se lê como objeto em cima de uma mesa, em vez de
brinquedo. O corpo inteiro nasce de cascos convexos sobre contornos empilhados —
tornozelo, joelho, quadril, cintura, ombro —, que é o jeito de ter volume cheio
sem nenhuma superfície pendurada.

A COR É FUNÇÃO SÓ DA ALTURA. É disso que sai a purga baixa: o boneco inteiro é
fatiado em três faixas em Z — preto de 0 a 11,5 (base, sapatos, pé dos postes),
cinza de 11,5 a 75,1 (pernas, tronco, braços, cabeça, postes) e laranja daí para
cima (o capacete). Duas trocas de filamento no trabalho, sequenciais. Qualquer
peça que cruze uma fronteira é cortada nela, e é por isso que o pé dos postes sai
preto: pintá-los de cinza lá embaixo custaria uma troca por camada durante 35
camadas seguidas.

Colete e cinto são SULCOS na própria cor, lidos por sombra. Faixa de segunda cor
numa parede vertical é o erro que já estragou o logo da CCR e o da WEG.

A placa de obra é peça à parte, impressa deitada com a ARTE PARA BAIXO, contra o
vidro, e colada nos postes — mesma decisão das chapas das maquetes.

Nada pede suporte, conferido camada a camada medindo quanto o material avança
além do apoio de baixo:
  - a aba do capacete brota da testa 4 mm abaixo da linha do capacete e abre a 45°
  - o queixo nasce com a largura do pescoço e abre 44°, não pousa em cima dele
  - os braços prendem em cima E embaixo, arqueados no meio: o vão é furo com ponte
    de 2 mm no alto, não braço pendurado com a mão começando no ar
  - o tubo de projeto e a prancheta se apoiam na base, a mão só encosta
  - o cabelo da engenheira é uma gota que começa dentro do tronco e engrossa subindo
  - o primeiro contorno do tronco pousa dentro das duas coxas
O único vão que sobra é a virilha, de 1,4 a 4 mm: ponte ancorada dos dois lados.

Eixos: X = largura da base, Y = profundidade (frente em -Y), Z = altura. Já nasce
em pé, que é como imprime.
"""
import os
import pickle
import sys

import numpy as np
import trimesh
from trimesh.creation import box, cylinder, icosphere, extrude_polygon
from shapely.geometry import Polygon, box as sbox
from shapely.ops import unary_union
from shapely import affinity
from matplotlib.textpath import TextPath
from matplotlib.font_manager import FontProperties

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
from bambu3mf import write_3mf, place_in_rows, clean_mesh

# ---------- base e composição ----------
BASE_W, BASE_D, BASE_T, BASE_R = 88.0, 46.0, 4.0, 6.0
BASE_CHANFRO = 1.0
FIG_X, FIG_Y = 62.0, 24.0                 # onde o boneco pisa
PROP_X = 78.0                             # tubo de projeto / prancheta
POSTE_X, POSTE_Y = 26.0, 31.0             # placa de obra
POSTE_W, POSTE_D, POSTE_VAO = 5.0, 4.0, 26.0
POSTE_Z1 = 41.0
PLACA_W, PLACA_H, PLACA_T = 48.0, 30.0, 2.4
PLACA_Z0 = 10.0
PLACA_ARTE = 0.65
APOIO = 1.6                               # ressalto em que a placa senta

# Fronteiras das faixas de cor, escolhidas por três coisas ao mesmo tempo:
#
# 1. não caem EM CIMA de uma feição — o topo do sapato está em 11,0 e a aba do
#    capacete brota em 70,0; cortar bem ali fazia o booleano devolver casquinhas
#    planas de volume zero no plano do corte;
# 2. o laranja começa um pouco ANTES de a aba brotar da testa, onde a mudança fica
#    escondida na sombra dela;
# 3. caem exatamente em linha de camada, 0,25 + 0,2k, que são os ajustes gravados
#    no arquivo: 11,45 é o topo da camada 56 e 75,05 o da 374. Assim cada camada é
#    de uma cor só e a linha de troca sai reta, em vez de ficar na dependência de
#    onde o plano de fatia cai dentro da camada.
Z_PRETO, Z_CAPACETE = 11.45, 75.05
SINK = 0.05

FONT = FontProperties(fname="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
PASTA_NL = os.path.join(RAIZ, "nl")


# ---------- utilidades ----------
def rbox(w, d, h, x=0.0, y=0.0, z=0.0):
    b = box(extents=[w, d, h])
    b.apply_translation([x + w / 2, y + d / 2, z + h / 2])
    return b


def rounded_rect(w, d, r, cx=0.0, cy=0.0):
    # r limitado: com r igual à metade do lado o buffer negativo esvazia o
    # polígono e o casco fica sem pontos. Para círculo de verdade, use circulo().
    r = min(r, min(w, d) / 2 - 0.01)
    return sbox(cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2) \
        .buffer(-r, join_style=1).buffer(r, join_style=1)


def circulo(r, cx=0.0, cy=0.0):
    from shapely.geometry import Point
    return Point(cx, cy).buffer(r, 64)


def extrusao(shape, h):
    geoms = list(shape.geoms) if hasattr(shape, "geoms") else [shape]
    return trimesh.util.concatenate([extrude_polygon(g.simplify(0.001), h) for g in geoms])


def casco(contornos):
    """Casco convexo sobre contornos empilhados: [(polígono shapely, z), ...]."""
    pts = []
    for anel, z in contornos:
        xy = np.array(anel.exterior.coords)
        pts.append(np.column_stack([xy, np.full(len(xy), z)]))
    return trimesh.convex.convex_hull(np.vstack(pts))


def solido(niveis, folga=0.0):
    """Casco convexo sobre contornos (largura, profundidade, raio, z).

    Casco convexo não guarda cintura — por isso o tronco vem de dois sólidos,
    quadril-cintura e cintura-ombro, unidos depois. `folga` positiva encolhe todos
    os contornos e negativa engorda: é assim que sai a casca que abre os sulcos.
    """
    return casco([(rounded_rect(w - 2 * folga, d - 2 * folga, max(r - folga, 0.2)), z)
                  for w, d, r, z in niveis])


def so_solidos(m, minimo=0.01):
    """Joga fora os corpos de volume zero que o booleano deixa no plano do corte."""
    corpos = [c for c in m.split(only_watertight=False) if abs(c.volume) > minimo]
    return trimesh.util.concatenate(corpos) if len(corpos) > 1 else corpos[0]


def capsula(r, p0, p1):
    """Cilindro com calota nas duas pontas."""
    p0, p1 = np.array(p0, float), np.array(p1, float)
    m = cylinder(radius=r, segment=[p0, p1], sections=32)
    for p in (p0, p1):
        e = icosphere(subdivisions=2, radius=r)
        e.apply_translation(p)
        m = m.union(e)
    return m


def texto2d(txt, cap, max_width=None, engorda=0.10):
    """Escala tirada de uma palavra de referência, não da própria linha: assim uma
    linha com acento não sai com letra menor que a vizinha sem acento."""
    def glifos(t):
        tp = TextPath((0, 0), t, size=10, prop=FONT)
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
        return shape

    shape = glifos(txt)
    ref = glifos("HEMO").bounds
    k = cap / (ref[3] - ref[1])
    minx, miny, maxx, maxy = shape.bounds
    if max_width and (maxx - minx) * k > max_width:
        k = max_width / (maxx - minx)
    return affinity.scale(shape, k, k, origin=(0, 0)).buffer(engorda, join_style=1) \
        .simplify(0.02)


def _luz(rgb):
    return rgb[..., 0] * 0.30 + rgb[..., 1] * 0.59 + rgb[..., 2] * 0.11


def traca(png, limiar, cols=None, rows=None, simplify=0.6, cache=None):
    """Contorna o que é escuro no arquivo oficial do logo, com furos."""
    if cache and os.path.exists(cache):
        return pickle.load(open(cache, "rb"))
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from PIL import Image
    a = np.array(Image.open(os.path.join(PASTA_NL, png)).convert("RGBA")).astype(float)
    d = (a[:, :, 3] > 110) & (_luz(a[:, :, :3]) < limiar)
    if rows:
        d = d[rows[0]:rows[1]]
    if cols:
        d = d[:, cols[0]:cols[1]]
    segs = plt.contour(np.pad(d.astype(float), 2), levels=[0.5]).allsegs[0]
    polys = sorted((Polygon(s).buffer(0) for s in segs if len(s) >= 4),
                   key=lambda p: p.area, reverse=True)
    shape = None
    for p in polys:
        if p.is_empty:
            continue
        if shape is None:
            shape = p
        elif shape.contains(p.representative_point()):
            shape = shape.difference(p)
        else:
            shape = shape.union(p)
    shape = affinity.scale(shape.simplify(simplify).buffer(0), 1, -1, origin="center")
    if cache:
        pickle.dump(shape, open(cache, "wb"))
    return shape


def escala(shape, alvo, eixo="w"):
    minx, miny, maxx, maxy = shape.bounds
    k = alvo / ((maxx - minx) if eixo == "w" else (maxy - miny))
    return affinity.scale(shape, k, k, origin=(minx, miny))


# ---------- o boneco ----------
# Alturas medidas do chão da base. Proporção de cinco cabeças e um quarto, com a
# perna um pouco mais longa que o tronco (35 contra 25 mm): na primeira versão a
# perna tinha 29 e o boneco saiu atarracado, parecendo de casaco comprido.
Z_PE, Z_JOELHO, Z_QUADRIL = BASE_T, 27.0, 46.0
Z_CINTURA, Z_OMBRO, Z_TOPO_OMBRO = 56.0, 68.0, 71.0
Z_QUEIXO, Z_CABECA, Z_COROA, Z_ABA = 71.5, 75.5, 82.5, 79.5


def boneco(feminina=False):
    ombro = 26.0 if feminina else 31.0
    cintura = 17.5 if feminina else 21.0
    quadril = 26.5 if feminina else 24.5

    # tronco primeiro, sozinho: os sulcos do colete e do cinto são abertos aqui,
    # antes de os braços e as pernas entrarem. Abertos depois, a casca que os gera
    # raspava também a parte de dentro do braço.
    # O primeiro contorno do tronco, em 41, é estreito de propósito: ele tem de
    # POUSAR DENTRO das duas coxas. Começando direto com a largura do quadril, a
    # base dele avançava 2,4 mm além da perna e virava face virada para baixo.
    baixo = [(20.0, 13.0, 4.0, Z_QUADRIL - 5.0),
             (quadril, 16.0, 5.0, Z_QUADRIL - 2.5),
             (cintura, 14.0, 4.5, Z_CINTURA)]
    alto = [(cintura, 14.0, 4.5, Z_CINTURA), (ombro, 16.0, 5.5, Z_OMBRO),
            (ombro - 5.0, 13.0, 5.0, Z_TOPO_OMBRO)]
    tronco = solido(baixo).union(solido(alto))

    def sulco(niveis, z0, alt, prof=0.9, recorte=None):
        """Rebaixo de profundidade constante na superfície do tronco.

        Feito por casca — o sólido engordado menos o mesmo sólido encolhido —, e
        não por caixa: o tronco muda de largura com a altura, e uma caixa reta
        morderia fundo no meio e nada nas pontas."""
        fora = solido(niveis, folga=-1.5)
        dentro = solido(niveis, folga=prof)
        casca = fora.difference(dentro).intersection(
            rbox(90.0, 50.0, alt, -45.0, -25.0, z0))
        return casca if recorte is None else casca.intersection(recorte)

    tronco = tronco.difference(sulco(alto, Z_CINTURA + 1.0, 3.4))      # faixa do colete
    for lado in (-1, 1):                                               # alças, só na frente
        tronco = tronco.difference(sulco(
            alto, Z_CINTURA + 4.4, Z_OMBRO - 1.0 - (Z_CINTURA + 4.4),
            recorte=rbox(2.6, 25.0, 100.0, lado * 6.2 - 1.3, -25.0, 0.0)))
    tronco = tronco.difference(sulco(baixo, Z_QUADRIL - 1.0, 2.4))     # cinto

    partes = [tronco]

    # pés: o bico aponta para a frente (-Y)
    for lado in (-1, 1):
        pe = solido([(13.0, 24.0, 3.5, Z_PE - 0.2), (12.0, 20.0, 3.5, Z_PE + 7.0)])
        pe.apply_translation([lado * 8.0, -3.0, 0])
        partes.append(pe)

    # pernas: o vão entre elas fecha para cima, 3 graus — nada para apoiar
    for lado in (-1, 1):
        perna = solido([(12.0, 13.0, 4.0, Z_PE + 6.0),
                        (13.5, 14.0, 4.5, Z_JOELHO),
                        (15.0, 16.0, 5.0, Z_QUADRIL)])
        perna.apply_translation([lado * 8.0, 0, 0])
        partes.append(perna)

    # Braços presos EM CIMA E EMBAIXO, arqueados no meio: sobem do quadril, abrem
    # no cotovelo e encostam no ombro. O vão que sobra é um furo, com ponte de 2 mm
    # no alto — e não um braço pendurado. Pendurado, a ponta de baixo da mão
    # nascia a 41 mm de altura sem nada embaixo: ilha solta, suporte na certa.
    cot_x, mao_x = 15.0, quadril / 2 + 1.2
    for lado in (-1, 1):
        x0 = lado * (ombro / 2 - 3.0)
        partes.append(capsula(3.0, [x0, 0.5, Z_OMBRO - 1.5],
                              [lado * cot_x, 1.0, Z_CINTURA - 1.0]))
        partes.append(capsula(3.0, [lado * cot_x, 1.0, Z_CINTURA - 1.0],
                              [lado * mao_x, 1.2, Z_QUADRIL + 3.0]))
        mao = icosphere(subdivisions=2, radius=3.2)
        mao.apply_scale([0.8, 1.25, 1.0])        # bola redonda parecia luva de boxe
        mao.apply_translation([lado * mao_x, 1.2, Z_QUADRIL + 1.5])
        partes.append(mao)

    partes.append(cylinder(radius=4.4, sections=32,
                           segment=[[0, 0, Z_TOPO_OMBRO - 3.0], [0, 0, Z_QUEIXO + 1.0]]))
    # A cabeça precisa NASCER do pescoço, não pousar em cima dele. Com o queixo
    # começando já com 14 mm em cima de um pescoço de 8,8, sobravam 115 mm² de
    # face virada para baixo — suporte na certa. O primeiro contorno agora tem a
    # largura do pescoço e abre 44 graus até o queixo.
    partes.append(solido([(9.6, 10.2, 4.5, Z_QUEIXO - 0.5),
                          (14.0, 14.5, 5.0, Z_QUEIXO + 2.2),
                          (16.5, 17.5, 6.5, Z_CABECA),
                          (15.5, 16.5, 6.0, Z_ABA),
                          (10.0, 11.0, 4.5, Z_COROA)]))

    if feminina:
        # cabelo caindo nas COSTAS, que aqui é +Y: a frente é -Y, para onde apontam
        # os bicos dos pés. Na primeira versão isto estava em -Y e o cabelo nascia
        # na cara dela.
        #
        # Gota entre duas esferas: estreita embaixo, dentro do tronco, e cheia na
        # nuca. Sobe abrindo pouco, então cada camada nasce em cima da anterior —
        # um rabo de cavalo pendurado seria o contrário, a ponta de baixo começaria
        # no ar. O casco convexo de duas esferas não incha de lado como o de uma
        # esfera com um ponto, que saía parecendo mochila.
        baixa = icosphere(subdivisions=2, radius=2.6)
        baixa.apply_translation([0, 5.5, Z_CINTURA + 2.0])
        alta = icosphere(subdivisions=2, radius=5.0)
        alta.apply_translation([0, 9.2, Z_CABECA - 1.0])
        partes.append(trimesh.convex.convex_hull(
            np.vstack([baixa.vertices, alta.vertices])))

    corpo = partes[0]
    for p in partes[1:]:
        corpo = corpo.union(p)

    # capacete: casco esférico, aba cônica a 45 graus e crista no topo
    # capacete de obra: casco achatado (0,88 em Z), aba estreita saindo 2,3 mm. Na
    # primeira versão a aba ia a 13,6 mm de raio e o capacete virava chapéu de palha.
    def casca(r, achata=0.88):
        e = icosphere(subdivisions=3, radius=r)
        e.apply_scale([1.0, 1.04, achata])
        e.apply_translation([0, 0, Z_ABA + 1.0])
        return e.intersection(rbox(40, 40, 30, -20, -20, Z_ABA))

    domo = casca(10.2)
    # A aba começa 4 mm ABAIXO da linha do capacete, com o raio que cabe dentro da
    # cabeça (8,0), e abre a 45 graus até 12,4. Começando na própria linha da aba,
    # o disco de baixo dela ficava 102 mm² no ar. Assim ela desce sobre a testa,
    # que por sinal é como um capacete de obra é de verdade.
    aba = casco([(circulo(8.0), Z_ABA - 4.0), (circulo(12.4), Z_ABA + 0.4)])
    crista = casca(10.9).intersection(rbox(3.4, 30.0, 30.0, -1.7, -15.0, Z_ABA))
    return corpo.union(domo).union(aba).union(crista)


def adereco(feminina=False):
    """Tubo de projeto (ele) ou prancheta (ela), de pé, apoiados na base.

    De pé e apoiados de propósito: pendurados na mão, a ponta de baixo começaria
    no ar. Assim cada um sobe da própria base e a mão só encosta."""
    if not feminina:
        tubo = cylinder(radius=3.6, sections=32,
                        segment=[[0, 0, BASE_T - 0.2], [0, 0, BASE_T + 44.0]])
        tampa = icosphere(subdivisions=2, radius=3.6)
        tampa.apply_translation([0, 0, BASE_T + 44.0])
        anel = cylinder(radius=3.9, sections=32,
                        segment=[[0, 0, BASE_T + 39.0], [0, 0, BASE_T + 41.0]])
        return tubo.union(tampa).union(anel)
    prancheta = solido([(18.0, 3.2, 1.4, BASE_T - 0.2), (18.0, 3.2, 1.4, BASE_T + 43.0)])
    clipe = solido([(10.0, 5.0, 2.0, BASE_T + 38.0), (10.0, 5.0, 2.0, BASE_T + 41.0)])
    return prancheta.union(clipe)


# ---------- base, postes e placa de obra ----------
def base_e_postes():
    perfil = rounded_rect(BASE_W, BASE_D, BASE_R, BASE_W / 2, BASE_D / 2)
    b = extrude_polygon(perfil, BASE_T)
    # chanfro de 1 mm no topo da borda: tira o canto vivo. O sólido a subtrair é a
    # fatia de cima menos o tronco de pirâmide que sobe encolhendo.
    fatia = extrude_polygon(perfil, BASE_CHANFRO)
    fatia.apply_translation([0, 0, BASE_T - BASE_CHANFRO])
    rampa = casco([(perfil, BASE_T - BASE_CHANFRO),
                   (perfil.buffer(-BASE_CHANFRO, join_style=1), BASE_T + 0.01)])
    b = b.difference(fatia.difference(rampa))

    postes = []
    for lado in (-1, 1):
        x = POSTE_X + lado * POSTE_VAO / 2
        p = rbox(POSTE_W, POSTE_D, POSTE_Z1 - BASE_T + 1.0,
                 x - POSTE_W / 2, POSTE_Y - POSTE_D / 2, BASE_T - 1.0)
        # ressalto em que a placa senta, para não escorregar na hora de colar.
        # Em consolo de 45 graus, não em prateleira: prateleira de 1,6 mm sai
        # pendurada no ar e desce cabelo.
        y0 = POSTE_Y - POSTE_D / 2 - APOIO
        p = p.union(casco([
            (sbox(x - POSTE_W / 2, y0 + APOIO - 0.2, x + POSTE_W / 2, y0 + APOIO),
             PLACA_Z0 - 1.2 - APOIO),
            (sbox(x - POSTE_W / 2, y0, x + POSTE_W / 2, y0 + APOIO), PLACA_Z0 - 1.2)]))
        postes.append(p)
    return b, postes


def arte_placa(logo, evento="FMEES 2026"):
    """Marca do patrocinador em cima, régua, e o evento discreto embaixo."""
    y, saida = 0.0, []
    for forma, folga in [(logo, 0.0), (sbox(0, 0, 34.0, 0.9), 3.6),
                         (texto2d(evento, 3.1, 30.0), 3.2)]:
        b = forma.bounds
        y -= folga
        saida.append(affinity.translate(forma, -(b[0] + b[2]) / 2, y - b[3]))
        y -= b[3] - b[1]
    arte = affinity.translate(unary_union(saida), PLACA_W / 2, (PLACA_H - y) / 2)
    # espelha em X: a face da arte é a de z = 0, a que vai contra o vidro, e é
    # olhada por baixo — composta na orientação natural do plano, sairia invertida
    return affinity.scale(arte, -1, 1, origin=(PLACA_W / 2, 0)), -y


def placa_obra(arte2d):
    corpo = extrude_polygon(rounded_rect(PLACA_W, PLACA_H, 2.0,
                                         PLACA_W / 2, PLACA_H / 2), PLACA_T)
    corpo = corpo.difference(extrusao(arte2d, PLACA_ARTE - SINK))
    return corpo, extrusao(arte2d, PLACA_ARTE)


# ---------- montagem das duas peças ----------
CREA = dict(nome="crea", feminina=False,
            logo=lambda: escala(traca("crea.png", 95, cols=(86, 391), rows=(0, 56),
                                      cache="crea_palavra.pkl"), 40.0, "w"))
MUTUA = dict(nome="mutua", feminina=True,
             logo=lambda: escala(traca("mutua.png", 110, cols=(140, 520), rows=(0, 106),
                                       cache="mutua_palavra.pkl"), 40.0, "w"))
DEDICATORIA = "HOMENAGEM ABEE-MT"

parts, artes, inteiros = {}, {}, {}
for spec in (CREA, MUTUA):
    nome, fem = spec["nome"], spec["feminina"]
    base, postes = base_e_postes()

    # dedicatória gravada na frente da base: mesma cor, leitura por sombra
    ded = texto2d(DEDICATORIA, 3.8, 52.0)
    b = ded.bounds
    ded = affinity.translate(ded, BASE_W / 2 - (b[0] + b[2]) / 2, 7.0 - (b[1] + b[3]) / 2)
    gravado = extrusao(ded, 0.8)     # 0,8 mm de fundo: raso demais não faz sombra
    gravado.apply_translation([0, 0, BASE_T - 0.8])
    base = base.difference(gravado)

    fig = boneco(fem)
    fig.apply_translation([FIG_X, FIG_Y, 0])
    prop = adereco(fem)
    prop.apply_translation([PROP_X, FIG_Y - 2.0, 0])

    inteiro = base
    for p in postes + [fig, prop]:
        inteiro = inteiro.union(p)
    inteiros[nome] = inteiro

    # corte em faixas de cor: é só disso que sai a purga baixa
    topo = inteiro.bounds[1][2] + 1.0
    for cor, z0, z1 in [("preto", 0.0, Z_PRETO), ("cinza", Z_PRETO, Z_CAPACETE),
                        ("laranja", Z_CAPACETE, topo)]:
        parts[f"{nome}_{cor}"] = so_solidos(inteiro.intersection(
            rbox(BASE_W + 20, BASE_D + 20, z1 - z0, -10.0, -10.0, z0)))

    a2d, alt = arte_placa(spec["logo"]())
    corpo, arte = placa_obra(a2d)
    parts[f"placa_{nome}_corpo"] = corpo
    parts[f"placa_{nome}_arte"] = arte
    artes[nome] = a2d
    print(f"{nome}: boneco com {inteiro.bounds[1][2]:.1f} mm de altura, "
          f"arte da placa com {alt:.1f} mm")

DENS = 1.24
# Confere sem tocar na malha. Um merge_vertices() aqui parecia inofensivo e não
# era: a faixa cinza da engenheira sai FECHADA do booleano, e o merge, ao soldar
# dois vértices que o booleano deixou a poucos milésimos um do outro, a ABRIA.
# Quem precisa limpar é a gravação, e lá a limpeza é a cuidadosa (bambu3mf._clean).
for nome, m in parts.items():
    print(f"{nome:22s} fechada={m.is_watertight}  volume={m.volume:8.0f} mm³"
          f"  {np.round(m.extents, 1)} mm  {m.volume / 1000 * DENS:5.1f} g")

# ---------- exportação ----------
for nome in ("crea", "mutua"):
    stl = clean_mesh(inteiros[nome])
    print(f"{'stl_boneco_' + nome:22s} fechada={stl.is_watertight}  "
          f"{np.round(stl.extents, 1)} mm  {stl.volume / 1000 * DENS:5.1f} g")
    stl.export(f"boneco_{nome}.stl")
    clean_mesh(parts[f"placa_{nome}_corpo"].union(parts[f"placa_{nome}_arte"])) \
        .export(f"placa_obra_{nome}.stl")

COLOR_GROUPS = {}
for nome in ("crea", "mutua"):
    COLOR_GROUPS[f"boneco_{nome}"] = {"1_preto": [f"{nome}_preto"],
                                      "2_cinza": [f"{nome}_cinza"],
                                      "3_laranja": [f"{nome}_laranja"]}
    COLOR_GROUPS[f"placa_{nome}"] = {"1_preto": [f"placa_{nome}_corpo"],
                                     "3_laranja": [f"placa_{nome}_arte"]}
PALETTE = [("1_preto", "Preto", "#1A1A1A"), ("2_cinza", "Cinza", "#C9CDCB"),
           ("3_laranja", "Laranja", "#E8712B")]
PRECISAO = 4


def monta(nomes):
    def junta(ns):
        # concatenate de UMA malha só não é inócuo: ele reconstrói o Trimesh com
        # process=True, que solda vértices — e soldar uma malha recém-saída de um
        # booleano pode abri-la. Com uma peça só, passa a própria cópia adiante.
        ms = [parts[n].copy() for n in ns]
        return ms[0] if len(ms) == 1 else trimesh.util.concatenate(ms)

    return [(obj, [(cor, junta(ns)) for cor, ns in COLOR_GROUPS[obj].items()])
            for obj in nomes]


# Bonecos numa mesa, placas de obra em outra. Aqui separar VALE: a placa é preta
# com laranja nas três primeiras camadas, altura em que o boneco também é preto —
# juntos, o laranja da placa conviveria com o preto do boneco camada a camada, e
# depois com o cinza. Separados, cada mesa tem trocas sequenciais: duas na dos
# bonecos, uma na das placas.
MESAS = [
    ("multicor", list(COLOR_GROUPS),
     [["boneco_crea", "boneco_mutua"], ["placa_crea", "placa_mutua"]]),
    ("bonecos", ["boneco_crea", "boneco_mutua"], [["boneco_crea", "boneco_mutua"]]),
    ("placas_obra", ["placa_crea", "placa_mutua"], [["placa_crea", "placa_mutua"]]),
]
for sufixo, nomes, fileiras in MESAS:
    objs = monta(nomes)
    place_in_rows(objs, fileiras)
    v = np.vstack([m.vertices for _, ps in objs for _, m in ps])
    slots = write_3mf(f"bonecos_{sufixo}.3mf", "Bonecos de engenharia — FMEES 2026",
                      objs, PALETTE, precision=PRECISAO)
    print(f"{'3mf_' + sufixo:16s} {len(objs)} objetos  mesa "
          f"{np.round(v.max(0) - v.min(0), 1)} mm  filamentos: "
          + ", ".join(f"{k} = {s}" for k, s in slots.items()))
print("arquivos gravados")
