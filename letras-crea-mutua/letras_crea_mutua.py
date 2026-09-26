"""Letras 3D de mesa — CREA-MT e Mútua, FMEES 2026.

A palavra do logo oficial, vetorizada e extrudada, em pé sobre um rodapé que liga
todas as letras. Uma peça por patrocinador, 194 mm de largura, letra de 30 mm com
16 mm de espessura, rodapé de 5 x 28 mm. "FMEES 2026" gravado na frente do rodapé.

Branco, uma cor só: zero troca de filamento e nenhuma torre de purga.

DEITADA É QUE IMPRIME, com a face da letra contra o vidro. Em pé, cada letra é uma
armadilha de balanço: o braço de cima do E sai 12 mm do tronco com nada embaixo, a
barra do T idem, a pança do R idem. Deitada não sobra balanço nenhum — medido
camada a camada — e a face boa ainda sai com o brilho do vidro. Depois é só
levantar a peça e apoiar no rodapé. Os arquivos já saem deitados.

Três coisas que o desenho teve de resolver, e que não são óbvias olhando a peça:

1. O hífen do CREA-MT e o acento do mútua NÃO ENCOSTAM em letra nenhuma no logo.
   Soltos, sairiam da impressora como pecinhas avulsas. Cada um ganha uma ligadura
   de 2,4 mm no ponto de maior aproximação com a letra vizinha, onde ela some no
   desenho — melhor que puxar um filete até o rodapé, que apareceria de frente.

2. O rodapé começa RENTE à face da letra e cresce só para trás. Centrado na
   espessura, ele sobrava 6 mm na frente, e deitada essa sobra virava degrau: as
   letras nasciam 6 mm no ar, 3300 mm² sem nada embaixo.

3. As letras AFUNDAM 0,3 mm no rodapé. Só encostando nele, a peça sai como dois
   corpos soltos que o fatiador trata como objetos diferentes.

Eixos do desenho: X = largura, Y = espessura da letra, Z = altura. É a posição de
mesa; a de impressão sai de deitar a peça para a frente.
"""
import os
import pickle
import sys

import numpy as np
import trimesh
from trimesh.creation import extrude_polygon
from shapely.geometry import LineString, Polygon, box as sbox
from shapely.ops import unary_union, nearest_points
from shapely import affinity
from matplotlib.textpath import TextPath
from matplotlib.font_manager import FontProperties

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
from bambu3mf import write_3mf, place_in_rows, clean_mesh

PASTA_NL = os.path.join(RAIZ, "nl")
FONT = FontProperties(fname="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")

# ---------- medidas ----------
LARG = 184.0          # largura da palavra
PROF = 16.0           # espessura da letra
LIGA = 2.4            # largura da ligadura que prende peça solta na vizinha
AFUNDA = 0.3          # o quanto a letra entra no rodapé
BASE_H, BASE_D = 5.0, 28.0
BASE_SOBRA = 5.0      # o rodapé passa da palavra este tanto de cada lado
BASE_R = 2.0
GRAV = 0.7            # fundo do gravado do evento
EVENTO = "FMEES 2026"


def extrusao(shape, h):
    geoms = list(shape.geoms) if hasattr(shape, "geoms") else [shape]
    return trimesh.util.concatenate([extrude_polygon(g.simplify(0.001), h) for g in geoms])


def centrado(shape, cx, cy):
    b = shape.bounds
    return affinity.translate(shape, cx - (b[0] + b[2]) / 2, cy - (b[1] + b[3]) / 2)


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

    s = glifos(txt)
    ref = glifos("HEMO").bounds
    k = cap / (ref[3] - ref[1])
    b = s.bounds
    if max_width and (b[2] - b[0]) * k > max_width:
        k = max_width / (b[2] - b[0])
    return affinity.scale(s, k, k, origin=(0, 0)).buffer(engorda, join_style=1).simplify(0.02)


# ---------- a palavra, do arquivo oficial ----------
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
    for p in polys:                        # maior primeiro: quem cai dentro é furo
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


def liga_soltas(shape, tentativas=6):
    """Prende cada pedaço solto no vizinho mais próximo, com uma ligadura estreita.

    A ligadura ENTRA 2 mm em cada peça, e não encosta: parando na borda, ela toca a
    letra num ponto só, e união de polígonos que se tocam num ponto não funde — a
    primeira versão devolvia as ligaduras como peças soltas a mais.

    Um fechamento global (buffer para fora e de volta) seria mais simples e não
    serve: o vão real do hífen para o A é maior do que a distância entre as caixas
    deles, porque a perna do A é inclinada, e um fechamento grande o bastante para
    vencê-lo fecharia junto as contra-formas do R e do A.
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
                          .buffer(LIGA / 2, cap_style=2))
        shape = unary_union(partes + pontes)
    return shape


def palavra(spec):
    p = traca(spec["png"], spec["limiar"], spec["cols"], spec["rows"],
              cache=os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                 spec["cache"]))
    minx, miny, maxx, maxy = p.bounds
    k = LARG / (maxx - minx)
    # escala em torno da ORIGEM e só então translada. Escalando em torno de
    # (minx, miny), esse ponto fica parado e a translação de -minx*k joga a palavra
    # para longe: foi assim que as letras saíram flutuando acima do rodapé.
    p = affinity.scale(p, k, k, origin=(0, 0))
    return liga_soltas(affinity.translate(p, -minx * k, -miny * k))


# ---------- a peça ----------
def peca(spec):
    """Letras em pé sobre o rodapé, na posição de mesa."""
    p2d = palavra(spec)
    letras = extrusao(p2d, PROF)
    letras.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    letras.apply_translation([0, PROF, BASE_H - AFUNDA])

    base = extrude_polygon(
        sbox(-BASE_SOBRA, 0, LARG + BASE_SOBRA, BASE_D)
        .buffer(-BASE_R, join_style=1).buffer(BASE_R, join_style=1), BASE_H)

    # evento gravado na frente do rodapé. A ferramenta começa 0,3 mm FORA da face:
    # rente a ela, o booleano devolvia uma casquinha plana de volume zero.
    g = extrusao(centrado(texto2d(EVENTO, 3.4, LARG * 0.45), LARG / 2, 0), GRAV + 0.3)
    g.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    g.apply_translation([0, GRAV, BASE_H / 2])

    return base.difference(g).union(letras)


def deitada(m):
    """A peça na posição em que imprime: a FACE DA LETRA contra o vidro.

    Giro de +90 graus, não de -90: com -90 ela também deita, mas com a face boa
    para cima, e aí sai com o acabamento de camada de topo em vez do brilho do
    vidro."""
    g = m.copy()
    g.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    g.apply_translation([0, -g.bounds[0][1], -g.bounds[0][2]])
    return g


CREA = dict(nome="crea", titulo="CREA-MT", png="crea.png", limiar=95,
            cols=(86, 391), rows=(0, 56), cache="crea_palavra.pkl")
MUTUA = dict(nome="mutua", titulo="mútua", png="mutua.png", limiar=110,
             cols=(140, 520), rows=(0, 106), cache="mutua_palavra.pkl")

DENS = 1.24
parts, em_pe = {}, {}
for spec in (CREA, MUTUA):
    m = peca(spec)
    em_pe[spec["nome"]] = m
    parts[f"letras_{spec['nome']}"] = deitada(m)
    corpos = len(m.split(only_watertight=False))
    print(f"letras_{spec['nome']:6s} em pé {np.round(m.extents, 1)} mm  "
          f"deitada {np.round(parts['letras_' + spec['nome']].extents, 1)} mm  "
          f"fechada={m.is_watertight}  corpos={corpos}  {m.volume / 1000 * DENS:5.1f} g")
    assert corpos == 1, "a peça tem de sair inteira, num corpo só"

# ---------- exportação ----------
for nome, m in parts.items():
    stl = clean_mesh(m)
    print(f"{'stl_' + nome:18s} fechada={stl.is_watertight}  {np.round(stl.extents, 1)} mm")
    stl.export(f"{nome}.stl")

PALETTE = [("1_branco", "Branco", "#EDEFEE")]
COLOR_GROUPS = {"letras_crea": {"1_branco": ["letras_crea"]},
                "letras_mutua": {"1_branco": ["letras_mutua"]}}
PRECISAO = 4


def monta(nomes):
    def junta(ns):
        # concatenate de UMA malha só não é inócuo: ele reconstrói o Trimesh com
        # process=True, que solda vértices, e soldar malha recém-saída de um
        # booleano pode abri-la. Com uma peça só, passa a própria cópia adiante.
        ms = [parts[n].copy() for n in ns]
        return ms[0] if len(ms) == 1 else trimesh.util.concatenate(ms)

    return [(obj, [(cor, junta(ns)) for cor, ns in COLOR_GROUPS[obj].items()])
            for obj in nomes]


# Uma cor só nas duas peças: não há troca de filamento nem torre de purga, e por
# isso não há razão para separar as mesas. As duas juntas cabem folgadas na H2C.
MESAS = [
    ("duas", ["letras_crea", "letras_mutua"], [["letras_crea"], ["letras_mutua"]]),
    ("crea", ["letras_crea"], [["letras_crea"]]),
    ("mutua", ["letras_mutua"], [["letras_mutua"]]),
]
for sufixo, nomes, fileiras in MESAS:
    objs = monta(nomes)
    place_in_rows(objs, fileiras)
    v = np.vstack([m.vertices for _, ps in objs for _, m in ps])
    slots = write_3mf(f"letras_{sufixo}.3mf", "Letras 3D CREA-MT e Mútua — FMEES 2026",
                      objs, PALETTE, precision=PRECISAO)
    print(f"{'3mf_' + sufixo:14s} {len(objs)} objeto(s)  mesa "
          f"{np.round(v.max(0) - v.min(0), 1)} mm  filamentos: "
          + ", ".join(f"{k} = {s}" for k, s in slots.items()))
print("arquivos gravados")
