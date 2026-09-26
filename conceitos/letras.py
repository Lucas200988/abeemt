"""Conceito E: as marcas em letra 3D sobre rodapé, para mesa. SÓ PARA VER.

A palavra do logo oficial, vetorizada e extrudada em 16 mm, em pé sobre um rodapé
que liga todas as letras. Uma peça por patrocinador, 190 mm de largura.

DEITADA É QUE IMPRIME. Em pé, cada letra é uma armadilha de balanço: o braço de
cima do E sai 12 mm do tronco com nada embaixo, a barra do T idem, a pança do R
idem. Deitada — a face da letra contra o vidro e o rodapé virando parede —, não
sobra um balanço sequer, e ainda por cima a face boa sai com o brilho do vidro.
Depois é só levantar a peça e apoiar no rodapé.

O hífen do CREA-MT e o acento do mútua não encostam em letra nenhuma no logo, e
soltos sairiam da impressora como pecinhas avulsas. Cada um ganha uma ligadura de
2,4 mm no ponto de maior aproximação com a letra vizinha, onde ela some no desenho
— melhor que puxar um filete até o rodapé, que apareceria de frente.

Uma cor só. Duas cores aqui sairiam caro: deitada, rodapé e letra convivem em
todas as camadas de 0 a 16, e seria uma troca de filamento por camada.

Eixos do desenho: X = largura, Y = espessura da letra, Z = altura. É a posição de
mesa; a de impressão sai de deitar a peça para trás.
"""
import os
import pickle
import sys

import numpy as np
import trimesh
from trimesh.creation import extrude_polygon
from shapely.geometry import LineString, Polygon, box as sbox
from shapely.ops import unary_union
from shapely import affinity

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, RAIZ)
sys.path.insert(0, AQUI)
from conceitos_fmees import texto2d, extrusao, centrado

PASTA_NL = os.path.join(RAIZ, "nl")

LARG = 184.0          # largura da palavra
PROF = 16.0           # espessura da letra
LIGA = 2.4            # largura da ligadura que prende peça solta na vizinha
AFUNDA = 0.3          # o quanto a letra entra no rodapé
BASE_H, BASE_D = 5.0, 28.0
BASE_SOBRA = 5.0      # o rodapé passa da palavra este tanto de cada lado
GRAV = 0.7            # fundo do gravado do evento


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


def palavra(png, limiar, cols, rows, cache):
    p = traca(png, limiar, cols, rows, cache=os.path.join(AQUI, cache))
    minx, miny, maxx, maxy = p.bounds
    k = LARG / (maxx - minx)
    # escala em torno da ORIGEM e só então translada. Escalando em torno de
    # (minx, miny), esse ponto fica parado e a translação de -minx*k joga a
    # palavra para longe: foi assim que as letras saíram flutuando 1,5 mm acima do
    # rodapé, sem encostar nele — duas peças soltas em vez de uma.
    p = affinity.scale(p, k, k, origin=(0, 0))
    return liga_soltas(affinity.translate(p, -minx * k, -miny * k))


def liga_soltas(shape, tentativas=6):
    """Prende cada pedaço solto no vizinho mais próximo, com uma ligadura estreita.

    O hífen do CREA-MT e o acento do mútua não encostam em letra nenhuma no logo.
    Soltos, sairiam da impressora como pecinhas avulsas. Puxar um filete deles até
    o rodapé apareceria de frente; aqui a ligadura vai no ponto de maior aproximação
    com a letra vizinha, onde ela some no desenho.

    A ligadura ENTRA 2 mm em cada peça, e não encosta: parando na borda, ela toca a
    letra num ponto só, e união de polígonos que se tocam num ponto não funde — foi
    assim que a primeira versão devolveu as ligaduras como peças soltas a mais.

    Um fechamento global (buffer para fora e de volta) seria mais simples e não
    serve: o vão real do hífen para o A é maior do que a distância entre as caixas
    deles, porque a perna do A é inclinada, e um fechamento grande o bastante para
    vencê-lo fecharia junto as contra-formas do R e do A.
    """
    from shapely.ops import nearest_points
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


CREA = dict(nome="crea", png="crea.png", limiar=95, cols=(86, 391), rows=(0, 56),
            cache="crea_palavra.pkl")
MUTUA = dict(nome="mutua", png="mutua.png", limiar=110, cols=(140, 520), rows=(0, 106),
             cache="mutua_palavra.pkl")


def peca(spec, evento="FMEES 2026"):
    """Letras em pé sobre o rodapé, na posição de mesa."""
    p2d = palavra(spec["png"], spec["limiar"], spec["cols"], spec["rows"], spec["cache"])
    alt = p2d.bounds[3] - p2d.bounds[1]

    letras = extrusao(p2d, PROF)
    # de pé: o que era Y da palavra vira Z
    letras.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    letras.apply_translation([0, PROF, BASE_H - AFUNDA])   # entra no rodapé

    # O rodapé começa RENTE à face da letra e cresce só para trás. Centrado, ele
    # sobrava 6 mm na frente — e deitada para imprimir, essa sobra vira degrau: as
    # letras nasciam 6 mm no ar, 3300 mm² sem nada embaixo. Rente, letra e rodapé
    # começam juntos na mesa.
    base = extrude_polygon(
        sbox(-BASE_SOBRA, 0, LARG + BASE_SOBRA, BASE_D)
        .buffer(-2.0, join_style=1).buffer(2.0, join_style=1), BASE_H)

    # evento gravado na frente do rodapé, letra pequena
    g2d = centrado(texto2d(evento, 3.4, LARG * 0.45), LARG / 2, 0)
    # a ferramenta do gravado começa 0,3 mm FORA da face: rente a ela, o booleano
    # devolvia uma casquinha plana de volume zero coplanar com o rodapé
    g = extrusao(g2d, GRAV + 0.3)
    g.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    g.apply_translation([0, GRAV, BASE_H / 2])
    base = base.difference(g)

    return base.union(letras), alt


def deitada(m):
    """A mesma peça na posição em que imprime: a FACE DA LETRA contra o vidro.

    Giro de +90 graus, não de -90: com -90 a peça também deita, mas com a face boa
    para cima, e aí ela sai com o acabamento de camada de topo em vez do brilho do
    vidro.
    """
    g = m.copy()
    g.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    g.apply_translation([0, 0, -g.bounds[0][2]])
    return g


def conceito_letras(qual="crea"):
    m, alt = peca(CREA if qual == "crea" else MUTUA)
    return m, alt
