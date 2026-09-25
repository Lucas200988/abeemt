"""Conceitos de peça para CREA-MT e Mútua — SÓ PARA VER, nada de arquivo de impressão.

Este arquivo não grava 3MF nem STL de propósito. Ele monta os modelos e desenha,
para escolher a peça antes de produzir. Depois que uma for escolhida, ela vira
uma pasta própria, com as conferências de sempre.

Por que mudar de rumo: boneco humano bom sai de escultura digital, não de código
empilhando primitivas. O que código faz bem é geometria mecânica — dente de
engrenagem, treliça, torre. Os três conceitos aqui são disso.

  A. Engrenagem planetária que GIRA, impressa montada, numa peça só
  B. Ponte treliçada sobre base
  C. Torre de transmissão

Eixos: Z para cima em todos, na posição em que imprimem.
"""
import os
import sys

import numpy as np
import trimesh
from trimesh.creation import box, cylinder, extrude_polygon
from shapely.geometry import Polygon, box as sbox, Point
from shapely.ops import unary_union
from shapely import affinity
from matplotlib.textpath import TextPath
from matplotlib.font_manager import FontProperties

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)

FONT = FontProperties(fname="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")


def rbox(w, d, h, x=0.0, y=0.0, z=0.0):
    b = box(extents=[w, d, h])
    b.apply_translation([x + w / 2, y + d / 2, z + h / 2])
    return b


def barra(p0, p1, lado):
    """Barra de seção quadrada entre dois pontos — o membro da treliça e da torre."""
    p0, p1 = np.array(p0, float), np.array(p1, float)
    v = p1 - p0
    L = np.linalg.norm(v)
    m = box(extents=[lado, lado, L])
    z = v / L
    x = np.cross([0, 0, 1.0], z)
    if np.linalg.norm(x) < 1e-9:
        x = np.array([1.0, 0, 0])
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    T = np.eye(4)
    T[:3, :3] = np.column_stack([x, y, z])
    T[:3, 3] = (p0 + p1) / 2
    m.apply_transform(T)
    return m


def texto2d(txt, cap, max_width=None, engorda=0.10):
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


def extrusao(shape, h):
    geoms = list(shape.geoms) if hasattr(shape, "geoms") else [shape]
    return trimesh.util.concatenate([extrude_polygon(g.simplify(0.001), h) for g in geoms])


def centrado(shape, cx, cy):
    b = shape.bounds
    return affinity.translate(shape, cx - (b[0] + b[2]) / 2, cy - (b[1] + b[3]) / 2)


# ===================== A. engrenagem planetária =====================
def engrenagem2d(m, z, alpha=np.radians(20.0), folga=0.0, n=14):
    """Perfil involuto de uma engrenagem externa, no plano XY.

    Involuta de verdade, não dente triangular: é o flanco involuto que faz a
    transmissão rodar macia e é ele que dá o desenho que se reconhece de longe.
    `folga` é a folga de impressão, tirada da espessura do dente no primitivo.
    """
    r_p = m * z / 2.0
    r_b = r_p * np.cos(alpha)
    r_a, r_f = r_p + m, r_p - 1.25 * m
    inv = lambda a: np.tan(a) - a
    meia = np.pi / (2 * z) - folga / r_p          # meia espessura angular no primitivo
    r_ini = max(r_b, r_f) + 1e-4
    rr = np.linspace(r_ini, r_a, n)
    th = inv(np.arccos(np.clip(r_b / rr, -1.0, 1.0))) - inv(alpha)

    pts = []
    passo = 2 * np.pi / z
    for k in range(z):
        base = k * passo
        pts.append((r_f * np.cos(base - passo / 2), r_f * np.sin(base - passo / 2)))
        for r, t in zip(rr, th):                   # flanco esquerdo, subindo
            a = base - meia + t
            pts.append((r * np.cos(a), r * np.sin(a)))
        for r, t in zip(rr[::-1], th[::-1]):       # flanco direito, descendo
            a = base + meia - t
            pts.append((r * np.cos(a), r * np.sin(a)))
        pts.append((r_f * np.cos(base + passo / 2), r_f * np.sin(base + passo / 2)))
    return Polygon(pts).buffer(0)


# 15 dentes com módulo 1,28 no lugar de 12 com 1,7: mesmo diâmetro, dente mais
# miúdo, desenho mais fino. A conta que tem de fechar é dupla — Z_ANEL = Z_SOL +
# 2·Z_PLAN para os centros baterem, e (Z_SOL + Z_ANEL) divisível por 3 para os
# três planetas caírem a 120 graus com os dentes casando.
MOD, Z_SOL, Z_PLAN = 1.28, 15, 15
Z_ANEL = Z_SOL + 2 * Z_PLAN                        # 45; (15+45)/3 = 20, inteiro
ALT_ENG, FOLGA = 12.0, 0.18
BASE_R, BASE_H = 46.0, 3.5
R_ANEL_EXT = MOD * Z_ANEL / 2 + 1.25 * MOD + 5.0


def conceito_engrenagem():
    r_sol = MOD * Z_SOL / 2
    r_plan = MOD * Z_PLAN / 2
    base = cylinder(radius=BASE_R, height=BASE_H, sections=128)
    base.apply_translation([0, 0, BASE_H / 2])

    z0 = BASE_H + 0.25          # 0,25 de folga: a 1ª camada de cada engrenagem é
                                # ponte sobre a base, e por isso não solda nela
    # A coroa termina na MESMA altura das engrenagens. Mais alta, ela vira parede e
    # esconde justamente o que faz a peça: os dentes engrenando.
    anel_ext = cylinder(radius=R_ANEL_EXT, height=ALT_ENG + 0.25, sections=128)
    anel_ext.apply_translation([0, 0, BASE_H + (ALT_ENG + 0.25) / 2])
    # coroa interna = anel cheio menos o perfil de uma engrenagem externa: o vão
    # entre dentes da coroa tem exatamente a forma do dente que engrena nela
    # o corte tem de atravessar a coroa INTEIRA. Começando em cima da base, ele
    # deixava um disco de 0,25 mm fechando o furo por baixo.
    corte = extrusao(engrenagem2d(MOD, Z_ANEL, folga=-FOLGA), ALT_ENG + 6.0)
    corte.apply_translation([0, 0, BASE_H - 2.0])
    coroa = anel_ext.difference(corte)

    # A coroa sai na mesma cor das engrenagens de propósito: acima da base é
    # tudo laranja. Coroa de uma cor e engrenagens de outra conviveriam na
    # mesma altura por 60 camadas, uma troca em cada.
    pecas = [("preto", base), ("laranja", coroa)]
    sol = extrusao(engrenagem2d(MOD, Z_SOL, folga=FOLGA), ALT_ENG)
    sol = sol.difference(cylinder(radius=3.0, height=40, sections=48))
    sol.apply_translation([0, 0, z0])
    pecas.append(("laranja", sol))
    for k in range(3):
        a = k * 2 * np.pi / 3
        p = extrusao(engrenagem2d(MOD, Z_PLAN, folga=FOLGA), ALT_ENG)
        p = p.difference(cylinder(radius=2.6, height=40, sections=48))
        # gira o planeta para os dentes casarem na posição em que ele fica
        ang = a * (Z_SOL + Z_ANEL) / Z_PLAN
        p.apply_transform(trimesh.transformations.rotation_matrix(ang, [0, 0, 1]))
        p.apply_translation([(r_sol + r_plan) * np.cos(a), (r_sol + r_plan) * np.sin(a), z0])
        pecas.append(("laranja", p))

    # marca numa chapa deitada, na borda da base: arte embutida rente, impressa
    # com a face contra o vidro e colada — a técnica que já funciona nas maquetes
    chapa = rbox(56.0, 15.0, 1.6, -28.0, -(BASE_R - 1.0), BASE_H)
    arte2d = centrado(texto2d("CREA-MT · FMEES 2026", 5.0, 50.0), 0.0, -(BASE_R - 8.5))
    arte = extrusao(arte2d, 0.65)
    arte.apply_translation([0, 0, BASE_H + 0.95])
    pecas.append(("preto", chapa.difference(extrusao(arte2d, 0.7)
                                            .apply_translation([0, 0, BASE_H + 0.95])
                                            or extrusao(arte2d, 0.7))))
    pecas.append(("laranja", arte))
    return pecas


# ===================== B. ponte treliçada =====================
def conceito_ponte():
    VAO, ALT, LARG, BARRA = 176.0, 44.0, 46.0, 4.2
    N = 6
    passo = VAO / N
    base = extrude_polygon(sbox(-VAO / 2 - 12, -LARG / 2 - 9, VAO / 2 + 12, LARG / 2 + 9)
                           .buffer(-6, join_style=1).buffer(6, join_style=1), 4.0)
    z0 = 4.0
    membros = []
    for lado in (-1, 1):
        y = lado * LARG / 2
        # banzos
        membros.append(barra([-VAO / 2, y, z0 + BARRA / 2], [VAO / 2, y, z0 + BARRA / 2], BARRA))
        membros.append(barra([-VAO / 2 + passo, y, z0 + ALT], [VAO / 2 - passo, y, z0 + ALT], BARRA))
        for i in range(N + 1):
            x = -VAO / 2 + i * passo
            if 0 < i < N:                      # montantes
                membros.append(barra([x, y, z0], [x, y, z0 + ALT], BARRA))
            if i < N:                          # diagonais em Warren, alternando
                x1 = x + passo
                if i % 2 == 0:
                    a, b = [x, y, z0], [x1, y, z0 + ALT]
                else:
                    a, b = [x, y, z0 + ALT], [x1, y, z0]
                if i == 0:
                    b = [x1, y, z0 + ALT]
                membros.append(barra(a, b, BARRA * 0.85))
    # transversais e contraventamento do tabuleiro
    for i in range(N + 1):
        x = -VAO / 2 + i * passo
        membros.append(barra([x, -LARG / 2, z0 + BARRA / 2], [x, LARG / 2, z0 + BARRA / 2], BARRA))
        if 0 < i < N:
            membros.append(barra([x, -LARG / 2, z0 + ALT], [x, LARG / 2, z0 + ALT], BARRA * 0.8))
    tabuleiro = rbox(VAO, LARG - 2 * BARRA, 2.4, -VAO / 2, -(LARG - 2 * BARRA) / 2, z0 + BARRA - 0.6)
    # encontros: a ponte pousa em dois blocos, como pilar de ponte de verdade
    for lado in (-1, 1):
        membros.append(rbox(16.0, LARG + 4.0, 6.0, lado * VAO / 2 - 8.0, -(LARG + 4) / 2, 0.0))

    placa = rbox(64.0, 2.4, 26.0, -32.0, -LARG / 2 - 2.4, z0 + 9.0)
    arte = extrusao(centrado(texto2d("CREA-MT", 11.0, 54.0), 0, 0), 0.7)
    arte.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    arte.apply_translation([0, -LARG / 2 - 2.4, z0 + 22.0])

    letras = texto2d("FMEES 2026", 6.0, 120.0)
    g = extrusao(centrado(letras, 0, -(LARG / 2 + 4.5)), 0.8)
    g.apply_translation([0, 0, 4.0 - 0.8])
    return [("preto", base.difference(g)),
            ("cinza", trimesh.util.concatenate(membros + [tabuleiro])),
            ("preto", placa), ("laranja", arte)]


# ===================== C. torre de transmissão =====================
def conceito_torre():
    H, BARRA = 168.0, 3.4
    niveis = [(0.0, 34.0), (46.0, 22.0), (86.0, 14.0), (108.0, 11.0), (H, 9.0)]
    base = cylinder(radius=46.0, height=4.0, sections=96)
    base.apply_translation([0, 0, 2.0])
    membros = []

    def canto(z, meia, i):
        s = [(-1, -1), (1, -1), (1, 1), (-1, 1)][i]
        return [s[0] * meia, s[1] * meia, z + 4.0]

    for a in range(len(niveis) - 1):
        z0, m0 = niveis[a]
        z1, m1 = niveis[a + 1]
        for i in range(4):
            membros.append(barra(canto(z0, m0 / 2, i), canto(z1, m1 / 2, i), BARRA))
        # treliça de face: dois painéis em X por trecho
        n = 3 if a < 2 else 2
        for k in range(n):
            t0, t1 = k / n, (k + 1) / n
            za, ma = z0 + (z1 - z0) * t0, m0 + (m1 - m0) * t0
            zb, mb = z0 + (z1 - z0) * t1, m0 + (m1 - m0) * t1
            for i in range(4):
                j = (i + 1) % 4
                membros.append(barra(canto(za, ma / 2, i), canto(zb, mb / 2, j), BARRA * 0.8))
                membros.append(barra(canto(za, ma / 2, j), canto(zb, mb / 2, i), BARRA * 0.8))
            for i in range(4):
                j = (i + 1) % 4
                membros.append(barra(canto(zb, mb / 2, i), canto(zb, mb / 2, j), BARRA * 0.8))
    # mísulas: os braços que carregam os cabos
    for z, comp in ((120.0, 30.0), (138.0, 24.0), (156.0, 18.0)):
        for lado in (-1, 1):
            meia = np.interp(z, [n[0] for n in niveis], [n[1] for n in niveis]) / 2
            ponta = [lado * (meia + comp), 0, z + 4.0]
            membros.append(barra([lado * meia, -meia, z + 4.0], ponta, BARRA))
            membros.append(barra([lado * meia, meia, z + 4.0], ponta, BARRA))
            membros.append(barra([lado * meia * 0.9, 0, z - 12.0 + 4.0], ponta, BARRA * 0.8))
            iso = cylinder(radius=1.6, height=7.0, sections=24)
            iso.apply_translation([ponta[0], 0, ponta[2] - 3.5])
            membros.append(iso)

    chapa = rbox(56.0, 2.4, 16.0, -28.0, -40.0, 8.0)
    arte = extrusao(centrado(texto2d("CREA-MT", 8.0, 46.0), 0, 0), 0.7)
    arte.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    arte.apply_translation([0, -40.0, 16.0])
    letras = texto2d("FMEES 2026", 5.0, 60.0)
    g = extrusao(centrado(letras, 0, 30.0), 0.8)
    g.apply_translation([0, 0, 4.0 - 0.8])
    return [("preto", base.difference(g)), ("cinza", trimesh.util.concatenate(membros)),
            ("preto", chapa), ("laranja", arte)]
