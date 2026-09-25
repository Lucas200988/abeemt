"""Conceito D: capacete de obra, peça de mesa. SÓ PARA VER — não grava 3MF nem STL.

Capacete inteiro, 128 x 112 x 67 mm, casca oca de 2,4 mm: aba larga com bico
comprido na frente e curta atrás, casco de lados quase retos que fecha em cúpula,
três nervuras, as orelhas de encaixe dos abafadores e o brasão do patrocinador
numa chapa colada na testa, que é onde capacete de obra leva marca mesmo.

O que faz ler como capacete e não como tigela virada é a ABA. Ela não entra no
casco convexo junto com o resto — se entrar, o casco "embala" tudo e o degrau
entre aba e casco some, que foi como saiu a primeira tentativa: um igloo. Aba e
casco são dois sólidos unidos depois.

Números que dão a cara da peça:
  aba    128 de comprimento por 112 de largura
  casco   94 por 88 na base
  sobra   24 mm de bico na frente, 12 mm nos lados, 8 mm atrás

Por que imprime bem, ao contrário do boneco:
  - deitado na aba, que é plana e maciça: apoio inteiro na mesa, nada em balanço
  - o casco só FECHA para dentro conforme sobe; cada camada nasce sobre a anterior
  - o alto da cúpula é o único lugar que avança rápido, e lá o furo interno já está
    pequeno — o fatiador atravessa em ponte, como em qualquer cúpula
  - uma cor só no capacete. Só a chapa do brasão tem duas, e é peça à parte,
    impressa deitada com a arte contra o vidro e colada, como nas maquetes

Eixos: X = comprimento (bico em +X), Y = largura, Z = altura. Já nasce deitado na
aba, que é como imprime.
"""
import os
import sys

import numpy as np
import trimesh
from trimesh.creation import extrude_polygon
from shapely.geometry import Polygon
from shapely import affinity

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from conceitos_fmees import rbox, texto2d, extrusao, centrado

# ---------- medidas ----------
A_ABA, B_ABA, E_ABA = 64.0, 50.0, 0.30     # ovo da aba: bico 83 na frente, 45 atrás
ABA_H, ABA_BORDA = 5.0, 2.2                # espessura no pé e na ponta
A_CAS, B_CAS, E_CAS = 47.0, 44.0, 0.12     # ovo do casco
PAREDE = 2.4
ALT = 58.0
FACE_X = 46.0                              # plano da testa achatada
CHAPA_W, CHAPA_H, CHAPA_T, CHAPA_ARTE = 30.0, 15.0, 1.8, 0.6
CHAPA_Z = 26.0   # acima da rampa de 45° do corte da testa, senão a chapa
                 # fica com a borda de baixo no vazio

# (altura, fator). Lados quase retos até a metade, depois fecha em cúpula: é esse
# perfil, e não o de meia-esfera, que faz a peça ser capacete.
# Mais casas do que o necessário: cada contorno é uma aresta do casco convexo, e
# com poucos o domo sai facetado em anéis visíveis.
PERFIL = [(0.0, 1.000), (6.0, 1.000), (12.0, 0.995), (18.0, 0.986), (24.0, 0.972),
          (30.0, 0.951), (35.0, 0.926), (40.0, 0.890), (44.0, 0.850),
          (48.0, 0.792), (51.0, 0.730), (53.5, 0.655), (55.5, 0.560),
          (57.0, 0.430), (ALT, 0.150)]


def ovo(A, B, e, n=200):
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    return Polygon(np.column_stack([A * np.cos(t) * (1 + e * np.cos(t)), B * np.sin(t)]))


def casco(contornos):
    pts = []
    for anel, z in contornos:
        c = np.array(anel.exterior.coords)
        pts.append(np.column_stack([c, np.full(len(c), z)]))
    return trimesh.convex.convex_hull(np.vstack(pts))


def contorno_casco(f, folga=0.0):
    a = ovo(A_CAS * f, B_CAS * f, E_CAS)
    return a.buffer(-folga, join_style=1) if folga else a


def casco_externo(k=1.0):
    return casco([(affinity.scale(contorno_casco(f), k, k, origin=(0, 0)), z)
                  for z, f in PERFIL])


def capacete():
    # aba: chanfrada no topo, mais fina na ponta que no pé
    aba_2d = ovo(A_ABA, B_ABA, E_ABA)
    aba = casco([(aba_2d, 0.0), (aba_2d, ABA_BORDA),
                 (aba_2d.buffer(-8.0, join_style=1), ABA_H)])
    corpo = aba.union(casco_externo())

    # nervuras: o casco 2,5 % maior, cortado em três faixas. Mesmo truque do sulco
    # do colete, ao contrário: em vez de tirar, acrescenta.
    maior = casco_externo(1.038)
    for y0, y1 in ((-4.2, 4.2), (-31.0, -24.5), (24.5, 31.0)):
        corpo = corpo.union(maior.intersection(
            rbox(300.0, y1 - y0, 300.0, -150.0, y0, ABA_H - 1.0)))

    # orelhas dos abafadores: saliência com a barriga a 45 graus, para não virar
    # prateleira no ar
    for lado in (-1, 1):
        y = lado * (B_CAS * 0.99 - 2.0)
        orelha = casco([
            (Polygon([(-11, y), (11, y), (11, y + lado * 3.4), (-11, y + lado * 3.4)]), 20.0),
            (Polygon([(-8, y), (8, y), (8, y + lado * 0.2), (-8, y + lado * 0.2)]), 12.0),
            (Polygon([(-8, y), (8, y), (8, y + lado * 0.2), (-8, y + lado * 0.2)]), 27.0)])
        corpo = corpo.union(orelha)

    # Testa achatada onde a chapa cola. O corte não desce reto até a aba: a barriga
    # dele sobe a 45 graus, senão sobraria um beiral de 5 mm virado para baixo — e
    # o corte reto ainda abria um talho na aba, que na primeira versão virou um
    # entalhe feio bem no meio dela.
    corte = casco([
        (Polygon([(FACE_X + 6.0, -60), (120, -60), (120, 60), (FACE_X + 6.0, 60)]), 5.2),
        (Polygon([(FACE_X, -60), (120, -60), (120, 60), (FACE_X, 60)]), 11.2),
        (Polygon([(FACE_X, -60), (120, -60), (120, 60), (FACE_X, 60)]), 120.0)])
    corpo = corpo.difference(corte)
    corpo = corpo.difference(rbox(1.0, CHAPA_W + 0.6, CHAPA_H + 0.6,
                                  FACE_X - 0.5, -(CHAPA_W + 0.6) / 2,
                                  CHAPA_Z - (CHAPA_H + 0.6) / 2))

    # oco: o mesmo casco encolhido da espessura da parede, descendo abaixo de zero
    # para abrir por baixo
    # Cada contorno de dentro é o de fora encolhido da parede nos dois sentidos:
    # 2,4 mm para dentro no plano E 2,4 mm para baixo em Z. Cortando a lista no
    # alto em vez de baixá-la, o oco terminava num teto chato de 1700 mm² — um
    # vão de 47 mm para o bico atravessar no ar. Assim ele fecha em cúpula junto
    # com o casco, e o vão vai a zero.
    dentro = casco([(contorno_casco(f, PAREDE), z - PAREDE) for z, f in PERFIL] +
                   [(contorno_casco(1.0, PAREDE), -4.0)])
    # Bloco maciço atrás da testa, guardado ANTES de vazar a peça e devolvido
    # depois. A testa achatada tira 5 mm da frente do casco, e a parede só tem
    # 2,4 — sem esse bloco o corte atravessava e abria um rasgo em meia-lua bem
    # embaixo do brasão. Por dentro ninguém vê.
    testa = corpo.intersection(rbox(9.0, 46.0, 40.0, FACE_X - 8.0, -23.0, ABA_BORDA))
    corpo = corpo.difference(dentro).union(testa)

    # evento gravado na aba de trás
    g = extrusao(centrado(texto2d("FMEES 2026", 6.4, 52.0), -(A_ABA * 0.60), 0.0), 0.8)
    g.apply_translation([0, 0, ABA_BORDA - 0.8])
    return corpo.difference(g)


def chapa_brasao(marca="CREA-MT"):
    """Chapa da marca, deitada, como imprime: arte embutida rente à face de baixo."""
    corpo = extrude_polygon(
        Polygon([(0, 0), (CHAPA_W, 0), (CHAPA_W, CHAPA_H), (0, CHAPA_H)])
        .buffer(-2.5, join_style=1).buffer(2.5, join_style=1), CHAPA_T)
    arte2d = centrado(texto2d(marca, 8.5, CHAPA_W - 5.0), CHAPA_W / 2, CHAPA_H / 2)
    arte2d = affinity.scale(arte2d, -1, 1, origin=(CHAPA_W / 2, 0))   # imprime virada
    corpo = corpo.difference(extrusao(arte2d, CHAPA_ARTE - 0.05))
    return corpo, extrusao(arte2d, CHAPA_ARTE)


def chapa_posta(marca="CREA-MT"):
    """A mesma chapa, girada para a testa, só para o desenho."""
    corpo, arte = chapa_brasao(marca)
    # Leva a chapa do plano XY, onde ela imprime, para a testa: largura da chapa
    # vira -Y, altura vira Z, e a face da arte (z = 0) fica virada para +X, que é
    # a frente. A arte já está espelhada para imprimir contra o vidro, e é esse
    # espelho que a faz ler direito quando se olha essa face por fora.
    M = np.eye(4)
    M[:3, :3] = np.column_stack([[0, -1, 0], [0, 0, 1], [-1, 0, 0]])
    saida = []
    for m in (corpo, arte):
        g = m.copy()
        g.apply_translation([-CHAPA_W / 2, -CHAPA_H / 2, 0])
        g.apply_transform(M)
        g.apply_translation([FACE_X - 0.5 + CHAPA_T, 0, CHAPA_Z])
        saida.append(g)
    return saida


def conceito_capacete(marca="CREA-MT"):
    corpo_chapa, arte = chapa_posta(marca)
    return [("branco", capacete()), ("preto", corpo_chapa), ("laranja", arte)]
