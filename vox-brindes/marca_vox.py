"""A marca VOX como geometria: traçado do logo, cores e texto.

O logo sai de `logo-vox.png`, recortado do PDF do rebranding. Três formas em
teal — V, O e X — e a meia-lua amarela dentro do balão.

O "O" do logo já É um balão de fala, com rabicho e tudo. Isso não é detalhe de
estilo: é o que deixa o brinde reconhecível mesmo pequeno e sem escrita nenhuma.

Cores medidas no próprio arquivo:
  teal     #03A6A5
  amarelo  #F6AE02

CUIDADO COM O ARQUIVO DO LOGO: no PDF ele é um bitmap de 283 px de largura, e o
que está aqui é a página renderizada a 900 dpi, ou seja, interpolada. Serve para
conceito. Para arquivo de impressão vale pedir o vetor à franqueadora, senão a
borda da letra sai com o degrau da interpolação.
"""
import os
import pickle

import numpy as np
import trimesh
from trimesh.creation import box, cylinder, extrude_polygon
from shapely.geometry import LineString, Polygon, box as sbox, Point
from shapely.ops import unary_union, nearest_points
from shapely import affinity
from matplotlib.textpath import TextPath
from matplotlib.font_manager import FontProperties

AQUI = os.path.dirname(os.path.abspath(__file__))
LOGO = os.path.join(AQUI, "logo-vox.png")
FONT = FontProperties(fname="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")

TEAL = "#03A6A5"
AMARELO = "#F6AE02"
PRETO = "#1A1A1A"
BRANCO = "#F2F2F0"
TAGLINE = "FALE. COMUNIQUE. TRANSFORME."


# ---------- utilidades de sólido ----------
def rbox(w, d, h, x=0.0, y=0.0, z=0.0):
    b = box(extents=[w, d, h])
    b.apply_translation([x + w / 2, y + d / 2, z + h / 2])
    return b


def rrect(w, d, r, cx=0.0, cy=0.0):
    r = min(r, min(w, d) / 2 - 0.01)
    return sbox(cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2) \
        .buffer(-r, join_style=1).buffer(r, join_style=1)


def extrusao(shape, h):
    geoms = list(shape.geoms) if hasattr(shape, "geoms") else [shape]
    return trimesh.util.concatenate([extrude_polygon(g.simplify(0.001), h) for g in geoms])


def casco(contornos):
    """Casco convexo sobre contornos empilhados: [(polígono, z), ...]."""
    pts = []
    for anel, z in contornos:
        c = np.array(anel.exterior.coords)
        pts.append(np.column_stack([c, np.full(len(c), z)]))
    return trimesh.convex.convex_hull(np.vstack(pts))


def centrado(shape, cx, cy):
    b = shape.bounds
    return affinity.translate(shape, cx - (b[0] + b[2]) / 2, cy - (b[1] + b[3]) / 2)


def escala(shape, alvo, eixo="w"):
    minx, miny, maxx, maxy = shape.bounds
    k = alvo / ((maxx - minx) if eixo == "w" else (maxy - miny))
    return affinity.scale(shape, k, k, origin=(0, 0))


def no_lugar(shape, larg=None, alt=None, cx=0.0, cy=0.0):
    s = escala(shape, larg, "w") if larg else escala(shape, alt, "h")
    return centrado(s, cx, cy)


# ---------- texto ----------
REF = "HEMO"


def _glifos(txt):
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
    return shape


def texto2d(txt, cap, max_width=None, engorda=0.08):
    """Altura de letra medida numa palavra de referência, para linha com acento
    não sair menor que a vizinha sem acento."""
    s = _glifos(txt)
    ref = _glifos(REF).bounds
    k = cap / (ref[3] - ref[1])
    b = s.bounds
    if max_width and (b[2] - b[0]) * k > max_width:
        k = max_width / (b[2] - b[0])
    return affinity.scale(s, k, k, origin=(0, 0)).buffer(engorda, join_style=1).simplify(0.02)


# ---------- o logo ----------
def _traca(mask, simp=1.2, suave=3.0):
    """Contorno da máscara, já tirado o degrau do bitmap.

    No PDF o logo tem 283 px de largura; aqui ele está renderizado a 900 dpi, ou
    seja, cada pixel do original virou ~3,7 px interpolados. Cortar a máscara num
    limiar devolve esse degrau de ~3,7 px inteiro, e na peça impressa ele vira
    serrilha na borda da letra — some na foto do logo, aparece numa letra de
    162 mm e aparece muito no chaveiro, que é um pedaço do logo ampliado.

    Borrar a máscara ANTES de traçar resolve de verdade: o contorno de nível 0,5
    de um campo contínuo passa com precisão de subpixel e sai liso. Tirar a
    serrilha depois, com buffer, não funciona — o degrau tem a mesma altura da
    curvatura da própria letra, então ou sobra serrilha ou some o desenho.
    `suave` é o sigma do borrão; para o sorriso, que tem 15 px de espessura, vai
    um valor menor, senão ele encolhe.
    """
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from scipy.ndimage import gaussian_filter
    # pad e eixo do espelho FIXOS: teal e amarelo são traçados em chamadas
    # separadas e precisam cair no mesmo sistema de coordenadas. Com pad variável,
    # ou espelhando cada um em torno do próprio centro, o sorriso desencontra do
    # balão (dava 14 px, ~0,7 mm num logo de 54 mm).
    campo = np.pad(mask.astype(float), 16)
    if suave:
        campo = gaussian_filter(campo, suave)
    segs = plt.contour(campo, levels=[0.5]).allsegs[0]
    polys = sorted((Polygon(s).buffer(0) for s in segs if len(s) >= 4),
                   key=lambda p: p.area, reverse=True)
    sh = None
    for p in polys:                      # maior primeiro: quem cai dentro é furo
        if p.is_empty:
            continue
        if sh is None:
            sh = p
        elif sh.contains(p.representative_point()):
            sh = sh.difference(p)
        else:
            sh = sh.union(p)
    return affinity.scale(sh.simplify(simp).buffer(0), 1, -1, origin=(0, 0))


def marca(cache=os.path.join(AQUI, "marca_vox.pkl")):
    """Devolve (teal, amarelo, balao) no mesmo sistema de coordenadas.

    `balao` é só o O — o balão de fala sozinho, que é o que serve de chaveiro, de
    ímã e de qualquer peça pequena onde a palavra inteira não caberia.
    """
    if os.path.exists(cache):
        return pickle.load(open(cache, "rb"))
    from PIL import Image
    a = np.array(Image.open(LOGO).convert("RGB")).astype(int)
    teal = _traca((a[:, :, 1] > 100) & (a[:, :, 2] > 100) & (a[:, :, 0] < 110))
    amarelo = _traca((a[:, :, 0] > 170) & (a[:, :, 1] > 110) & (a[:, :, 2] < 140),
                     suave=1.8)
    partes = sorted(teal.geoms, key=lambda g: g.bounds[0])
    balao = partes[1]                    # V, O, X — o do meio é o balão
    dados = (teal, amarelo, balao)
    pickle.dump(dados, open(cache, "wb"))
    return dados


def liga_soltas(shape, liga=2.0, tentativas=6):
    """Prende cada pedaço solto no vizinho mais próximo, com uma ligadura estreita.

    V, O e X não se encostam no logo. Numa peça que vai ser uma só — letras de
    balcão, nome colado —, soltos eles sairiam como três pedaços. A ligadura entra
    2 mm em cada peça: parando na borda, ela toca num ponto só, e união de
    polígonos que se tocam num ponto não funde.
    """
    for _ in range(tentativas):
        partes = list(shape.geoms) if hasattr(shape, "geoms") else [shape]
        if len(partes) < 2:
            return shape
        partes.sort(key=lambda g: g.area, reverse=True)
        pontes = []
        for g in partes[1:]:
            perto = min((h for h in partes if h is not g), key=g.distance)
            a, b = nearest_points(g, perto)
            v = np.array([b.x - a.x, b.y - a.y])
            n = np.linalg.norm(v)
            v = v / n if n > 1e-9 else np.array([1.0, 0.0])
            pontes.append(LineString([np.array([a.x, a.y]) - 2.0 * v,
                                      np.array([b.x, b.y]) + 2.0 * v])
                          .buffer(liga / 2, cap_style=2))
        shape = unary_union(partes + pontes)
    return shape
