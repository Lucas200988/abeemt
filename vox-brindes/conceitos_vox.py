"""Nove ideias de brinde para a VOX — SÓ PARA VER. Não grava 3MF nem STL.

A marca dá quatro ganchos, e cada peça pega pelo menos um:
  - o "O" que é um balão de fala com um sorriso amarelo dentro
  - a tagline em três tempos: FALE. COMUNIQUE. TRANSFORME.
  - as três barras inclinadas do rodapé, nas três cores da marca
  - o caixote, que é elemento oficial de ambientação da unidade

Todas são geometria — letra, casca, caixa, treliça — que é o que a impressora faz
bem. Nenhuma depende de escultura.

Eixos: Z para cima em todas, na posição em que a peça fica em pé na mesa.
"""
import numpy as np
import trimesh
from trimesh.creation import box, cylinder, icosphere, extrude_polygon
from shapely.geometry import Polygon, box as sbox, Point
from shapely.ops import unary_union
from shapely import affinity

from marca_vox import (TEAL, AMARELO, PRETO, BRANCO, TAGLINE, rbox, rrect, extrusao,
                       casco, centrado, escala, texto2d, marca, liga_soltas)

TEAL_MESH, AMAR_MESH, BALAO = marca()


def no_tamanho(shape, larg=None, alt=None):
    return escala(shape, larg, "w") if larg else escala(shape, alt, "h")


def marca_no_tamanho(larg):
    """Teal e amarelo juntos, na mesma escala, centrados na origem."""
    b = TEAL_MESH.bounds
    k = larg / (b[2] - b[0])
    cx, cy = (b[0] + b[2]) / 2 * k, (b[1] + b[3]) / 2 * k
    t = affinity.translate(affinity.scale(TEAL_MESH, k, k, origin=(0, 0)), -cx, -cy)
    a = affinity.translate(affinity.scale(AMAR_MESH, k, k, origin=(0, 0)), -cx, -cy)
    return t, a


def balao_no_tamanho(alt):
    b = BALAO.bounds
    k = alt / (b[3] - b[1])
    cx, cy = (b[0] + b[2]) / 2 * k, (b[1] + b[3]) / 2 * k
    t = affinity.translate(affinity.scale(BALAO, k, k, origin=(0, 0)), -cx, -cy)
    a = affinity.translate(affinity.scale(AMAR_MESH, k, k, origin=(0, 0)), -cx, -cy)
    return t, a


def na_face(shape2d, face, pos, prof):
    """Põe uma forma 2D no plano de uma face, já com a profundidade entrando.

    Só as três faces que as vistas mostram: topo, frente (-Y) e direita (+X).
    """
    m = extrusao(shape2d, prof)
    if face == "topo":
        m.apply_translation([pos[0], pos[1], pos[2] - prof])
    elif face == "frente":
        m.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
        m.apply_translation([pos[0], pos[1] + prof, pos[2]])
    elif face == "direita":
        m.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
        m.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0, 0, 1]))
        m.apply_translation([pos[0] - prof, pos[1], pos[2]])
    return m


# ======================= 1. chaveiro balão de fala =======================
def chaveiro():
    """A silhueta do balão de fala do logo, com a marca em relevo dentro.

    O caminho óbvio — recortar o O do logo como ele é, anel vazado — não fecha
    como peça: o sorriso do logo flutua no meio do vão, sem encostar em nada, e
    solto ele cairia. Tudo que o prende (esticar, fazer ponte) deforma o sorriso
    até ele virar uma tarja ou um raio atravessando o balão. Com o balão cheio, a
    marca entra em relevo apoiada na superfície — exatamente como nas outras
    peças, onde o sorriso nunca deu problema porque sempre teve chão embaixo.

    Dá de quebra um brinde mais honesto: um balão de fala dizendo VOX, e um anel
    de 4 mm maciço aguenta chave no bolso, coisa que parede fina de anel não faz.
    """
    ALT, ESP, ARTE = 46.0, 4.0, 0.9
    t2d, _ = balao_no_tamanho(ALT)
    cheio = Polygon(t2d.exterior)
    corpo = extrusao(cheio, ESP)
    topo = cheio.bounds[3]
    furo = cylinder(radius=2.1, height=20, sections=48)
    furo.apply_translation([0, topo - 5.2, ESP / 2])
    corpo = corpo.difference(furo)
    # acima do meio: embaixo fica o rabicho do balão, e a marca centrada caía
    # em cima dele
    marca_t, marca_a = marca_no_tamanho(27.0)
    marca_t = affinity.translate(marca_t, 0, 2.0)
    marca_a = affinity.translate(marca_a, 0, 2.0)
    rel = extrusao(marca_t, ARTE)
    rel.apply_translation([0, 0, ESP])
    sor = extrusao(marca_a, ARTE)
    sor.apply_translation([0, 0, ESP])
    return [(TEAL, corpo), (BRANCO, rel), (AMARELO, sor)]


# ======================= 2. marcador de página =======================
def marcador():
    L, A, ESP = 150.0, 34.0, 2.2
    corpo = extrude_polygon(rrect(A, L, 10.0, 0, 0), ESP)
    t2d, a2d = marca_no_tamanho(29.0)
    t2d = affinity.translate(t2d, 0, L / 2 - 17.0)
    a2d = affinity.translate(a2d, 0, L / 2 - 17.0)
    frase = texto2d(TAGLINE, 5.4, L * 0.66)
    frase = affinity.rotate(frase, 90, origin=(0, 0))
    frase = centrado(frase, 0, -6.0)
    g = extrusao(frase, 1.2)
    g.apply_translation([0, 0, ESP - 0.9])
    corpo = corpo.difference(g)
    furo = cylinder(radius=2.2, height=20, sections=32)
    furo.apply_translation([0, L / 2 - 5.0, ESP / 2])
    corpo = corpo.difference(furo)
    rel = extrusao(t2d, 0.9)
    rel.apply_translation([0, 0, ESP])
    sor = extrusao(a2d, 0.9)
    sor.apply_translation([0, 0, ESP])
    return [(TEAL, corpo), (BRANCO, rel), (AMARELO, sor)]


# ======================= 3. dado do improviso =======================
TEMAS = [("CONTE", "UM CASO"), ("DEFENDA", "O OPOSTO"), ("EXPLIQUE", "A UMA CRIANÇA"),
         ("VENDA", "ISTO AQUI"), ("1 MINUTO", "SEM PAUSA"), ("CONVENÇA", "A PLATEIA")]


def dado():
    L, R, PROF = 46.0, 5.0, 0.9
    perfil = rrect(L, L, R)
    corpo = casco([(perfil.buffer(-2.0, join_style=1), 0.0), (perfil, 2.0),
                   (perfil, L - 2.0), (perfil.buffer(-2.0, join_style=1), L)])
    cortes = []
    for face, (a, b), pos in (("topo", TEMAS[0], (0, 0, L)),
                              ("frente", TEMAS[1], (0, -L / 2, L / 2)),
                              ("direita", TEMAS[2], (L / 2, 0, L / 2))):
        bloco = unary_union([centrado(texto2d(a, 5.2, L - 12), 0, 4.0),
                             centrado(texto2d(b, 5.2, L - 12), 0, -4.0)])
        cortes.append(na_face(bloco, face, pos, PROF))
    for c in cortes:
        corpo = corpo.difference(c)
    t2d, _ = marca_no_tamanho(22.0)
    corpo = corpo.difference(na_face(t2d, "frente", (0, -L / 2, L / 2 + 15.0), PROF))
    return [(TEAL, corpo)]


# ======================= 4. suporte de celular para gravar =======================
def suporte():
    """Berço para o aluno gravar o treino: retrato no vão, paisagem no rasgo da frente.

    O vão entre o lábio da frente e o painel de trás tem 13 mm — passa capinha —, e
    o painel é fino de propósito: grosso, a peça vira caixote e some o berço.
    """
    W, D, ESP = 94.0, 82.0, 8.0
    PAINEL, VAO, LABIO = 7.0, 13.0, 18.0
    base = extrude_polygon(rrect(W, D, 5.0, 0, 0), ESP)
    painel = rbox(W - 16.0, PAINEL, 62.0, -(W - 16.0) / 2, 0.0, ESP - 1.0)
    painel.apply_transform(trimesh.transformations.rotation_matrix(
        np.radians(-13.0), [1, 0, 0], point=[0, D / 2 - 16.0, ESP]))
    painel.apply_translation([0, D / 2 - 16.0, 0])
    labio = rbox(W, 7.0, LABIO, -W / 2, D / 2 - 16.0 - VAO - 7.0, ESP - 1.0)
    peca = base.union(painel).union(labio)
    # entalhe do cabo no LÁBIO da frente, que é por onde o cabo do celular sai.
    # Antes ele atravessava o painel de trás e abria uma janela no meio dele.
    peca = peca.difference(rbox(18.0, 12.0, 14.0, -9.0, D / 2 - 16.0 - VAO - 7.5,
                                ESP + LABIO - 14.0))
    # rasgo de paisagem: raso, no topo do lábio
    peca = peca.difference(rbox(34.0, 9.0, 7.0, -17.0, D / 2 - 16.0 - VAO - 7.0,
                                ESP + LABIO - 7.0))
    t2d, a2d = marca_no_tamanho(50.0)
    rel = na_face(t2d, "frente", (0, -D / 2, ESP + 12.0), 1.2)
    rel.apply_translation([0, -1.2, 0])
    sor = na_face(a2d, "frente", (0, -D / 2, ESP + 12.0), 1.2)
    sor.apply_translation([0, -1.2, 0])
    return [(PRETO, peca), (TEAL, rel), (AMARELO, sor)]


# ======================= 5. porta-fichas de apoio =======================
def porta_fichas():
    W, D, H = 112.0, 48.0, 42.0
    corpo = casco([(rrect(W, D, 4.0), 0.0), (rrect(W, D, 4.0), H - 10.0),
                   (rrect(W, D - 14.0, 4.0, 0, -5.0), H)])
    fenda = rbox(W - 16.0, 17.0, H, -(W - 16.0) / 2, -8.5, 9.0)
    fenda.apply_transform(trimesh.transformations.rotation_matrix(
        np.radians(13.0), [1, 0, 0], point=[0, 0, 10.0]))
    corpo = corpo.difference(fenda)
    t2d, a2d = marca_no_tamanho(52.0)
    rel = na_face(t2d, "frente", (0, -D / 2, 13.0), 1.0)
    rel.apply_translation([0, -1.0, 0])
    sor = na_face(a2d, "frente", (0, -D / 2, 13.0), 1.0)
    sor.apply_translation([0, -1.0, 0])
    return [(BRANCO, corpo), (TEAL, rel), (AMARELO, sor)]


# ======================= 6. microfone de mesa =======================
def microfone():
    """Cabeça em grade, haste curta e base pesada — a proporção de microfone de mesa.

    A grade é cortada na esfera em dois sentidos: seis sulcos de latitude e doze
    meridianos. Só os de latitude deixavam a cabeça lisa de longe, parecendo
    pirulito; são os meridianos que dão a textura de tela.
    """
    BASE_R, BASE_H = 38.0, 12.0
    HASTE_H, CABECA_R = 26.0, 29.0
    base = casco([(Point(0, 0).buffer(BASE_R - 3.0, 72), 0.0),
                  (Point(0, 0).buffer(BASE_R, 72), 3.0),
                  (Point(0, 0).buffer(BASE_R - 2.0, 72), BASE_H)])
    haste = casco([(Point(0, 0).buffer(13.0, 48), BASE_H - 1.0),
                   (Point(0, 0).buffer(10.5, 48), BASE_H + HASTE_H)])
    cz = BASE_H + HASTE_H + CABECA_R - 9.0
    cabeca = icosphere(subdivisions=4, radius=CABECA_R)
    cabeca.apply_scale([1.0, 1.0, 0.94])
    cabeca.apply_translation([0, 0, cz])
    # corta só o que está ABAIXO do colar. Com a caixa começando na altura do
    # corte, ela comia dali para cima e a cabeça saía partida ao meio.
    corte_baixo = BASE_H + HASTE_H - 14.0
    cabeca = cabeca.difference(rbox(90, 90, 60, -45, -45, corte_baixo - 60.0))
    for k in range(-2, 4):                      # latitudes
        z = cz + k * 9.0
        fora = cylinder(radius=CABECA_R + 3.0, height=2.2, sections=72)
        fora.apply_translation([0, 0, z])
        dentro = cylinder(radius=CABECA_R - 1.8, height=3.0, sections=72)
        dentro.apply_translation([0, 0, z])
        cabeca = cabeca.difference(fora.difference(dentro))
    for k in range(12):                         # meridianos
        fenda = rbox(2.2, CABECA_R + 6.0, 2 * CABECA_R + 12.0,
                     -1.1, 0.0, cz - CABECA_R - 6.0)
        fenda = fenda.difference(casco([(Point(0, 0).buffer(CABECA_R - 1.8, 64),
                                         cz - CABECA_R - 7.0),
                                        (Point(0, 0).buffer(CABECA_R - 1.8, 64),
                                         cz + CABECA_R + 7.0)]))
        fenda.apply_transform(trimesh.transformations.rotation_matrix(
            k * np.pi / 6, [0, 0, 1]))
        cabeca = cabeca.difference(fenda)
    anel = cylinder(radius=14.5, height=5.0, sections=48)
    anel.apply_translation([0, 0, BASE_H + HASTE_H - 3.0])
    corpo = base.union(haste)
    # a marca vai no topo da base, À FRENTE da haste. Centrada e com 44 mm ela
    # passava por baixo da haste, que tem 26 mm de diâmetro ali: sobrava um
    # pedaço do V de um lado e um pedaço do X do outro, e o O sumia inteiro.
    t2d, a2d = marca_no_tamanho(30.0)
    t2d = affinity.translate(t2d, 0, -20.0)
    a2d = affinity.translate(a2d, 0, -20.0)
    rel = extrusao(t2d, 0.9)
    rel.apply_translation([0, 0, BASE_H - 0.1])
    sor = extrusao(a2d, 0.9)
    sor.apply_translation([0, 0, BASE_H - 0.1])
    return [(PRETO, corpo), (AMARELO, anel), (TEAL, cabeca), (TEAL, rel), (AMARELO, sor)]


# ======================= 7. troféu três tempos =======================
def trofeu():
    """As três barras inclinadas do rodapé da marca, nas três cores dela."""
    BW, BE, PASSO = 26.0, 10.0, 34.0
    base = casco([(rrect(124.0, 58.0, 6.0), 0.0), (rrect(124.0, 58.0, 6.0), 9.0),
                  (rrect(116.0, 50.0, 6.0), 12.0)])
    barras, cores = [], (PRETO, TEAL, AMARELO)
    for i, (alt, palavra) in enumerate(((66.0, "FALE"), (90.0, "COMUNIQUE"),
                                        (114.0, "TRANSFORME"))):
        b = rbox(BW, BE, alt, -BW / 2, -BE / 2, 0)
        b.apply_transform(trimesh.transformations.rotation_matrix(
            np.radians(16.0), [0, 1, 0]))
        b.apply_translation([(i - 1) * PASSO, 0, 10.0])
        letra = texto2d(palavra, 4.6, alt - 20.0)
        letra = affinity.rotate(letra, 90, origin=(0, 0))
        g = na_face(centrado(letra, 0, 0), "frente", (0, -BE / 2, alt / 2), 0.8)
        g.apply_transform(trimesh.transformations.rotation_matrix(
            np.radians(16.0), [0, 1, 0]))
        g.apply_translation([(i - 1) * PASSO, 0, 10.0])
        barras.append((cores[i], b.difference(g)))
    t2d, a2d = marca_no_tamanho(54.0)
    rel = na_face(t2d, "frente", (0, -29.0, 5.5), 1.0)
    rel.apply_translation([0, -1.0, 0])
    sor = na_face(a2d, "frente", (0, -29.0, 5.5), 1.0)
    sor.apply_translation([0, -1.0, 0])
    return [(BRANCO, base), (TEAL, rel), (AMARELO, sor)] + barras


# ======================= 8. letras VOX de balcão =======================
def letras():
    LARG, ESP = 150.0, 18.0
    BASE_H, BASE_D, SOBRA = 6.0, 30.0, 6.0
    t2d, a2d = marca_no_tamanho(LARG)
    t2d = liga_soltas(t2d, liga=2.6)
    minx, miny, maxx, maxy = t2d.bounds
    t2d = affinity.translate(t2d, -minx, -miny)
    a2d = affinity.translate(a2d, -minx, -miny)
    alt = maxy - miny

    def em_pe(shape, h, z0):
        m = extrusao(shape, h)
        m.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
        m.apply_translation([0, h, z0])
        return m

    corpo = em_pe(t2d, ESP, BASE_H - 0.3)
    sor = em_pe(a2d, ESP + 0.6, BASE_H - 0.3)
    base = extrude_polygon(
        sbox(-SOBRA, 0, LARG + SOBRA, BASE_D).buffer(-2.0, join_style=1)
        .buffer(2.0, join_style=1), BASE_H)
    frase = centrado(texto2d(TAGLINE, 4.0, LARG * 0.8), LARG / 2, 0)
    g = extrusao(frase, 1.0)
    g.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    g.apply_translation([0, 1.0, BASE_H / 2])
    return [(PRETO, base.difference(g)), (TEAL, corpo), (AMARELO, sor)]


# ======================= 9. caixote mini porta-canetas =======================
def caixote():
    """O caixote da ambientação da unidade, em tamanho de mesa."""
    W, D, H = 96.0, 86.0, 98.0
    POSTE, RIPA, VAO, FUNDO = 13.0, 15.0, 7.0, 4.0
    pecas = [rbox(W, D, FUNDO, -W / 2, -D / 2, 0)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            pecas.append(rbox(POSTE, POSTE, H,
                              -W / 2 if sx < 0 else W / 2 - POSTE,
                              -D / 2 if sy < 0 else D / 2 - POSTE, 0))
    z = FUNDO + 2.0
    while z + RIPA <= H - 2.0:
        pecas.append(rbox(W - 2 * POSTE, 6.0, RIPA, -(W - 2 * POSTE) / 2, -D / 2, z))
        pecas.append(rbox(W - 2 * POSTE, 6.0, RIPA, -(W - 2 * POSTE) / 2, D / 2 - 6.0, z))
        pecas.append(rbox(6.0, D - 2 * POSTE, RIPA, -W / 2, -(D - 2 * POSTE) / 2, z))
        pecas.append(rbox(6.0, D - 2 * POSTE, RIPA, W / 2 - 6.0, -(D - 2 * POSTE) / 2, z))
        z += RIPA + VAO
    corpo = pecas[0]
    for p in pecas[1:]:
        corpo = corpo.union(p)
    # a marca vai numa plaquinha colada na frente, e não em relevo nas ripas: em
    # cima das ripas ela sairia picada pelos vãos
    placa = rbox(64.0, 2.6, 28.0, -32.0, -D / 2 - 2.6, H * 0.46)
    t2d, a2d = marca_no_tamanho(54.0)
    rel = na_face(t2d, "frente", (0, -D / 2 - 2.6, H * 0.46 + 14.0), 0.8)
    rel.apply_translation([0, -0.8, 0])
    sor = na_face(a2d, "frente", (0, -D / 2 - 2.6, H * 0.46 + 14.0), 0.8)
    sor.apply_translation([0, -0.8, 0])
    return [(BRANCO, corpo), (PRETO, placa), (TEAL, rel), (AMARELO, sor)]


IDEIAS = [
    ("1 · Chaveiro balão de fala", "41 × 46 mm · 7 g · a marca em relevo",
     chaveiro, (-90, 62)),
    ("2 · Marcador de página", "150 × 34 × 2,2 mm · 14 g", marcador, (-96, 58)),
    ("3 · Dado do improviso", "46 mm · um tema por face", dado, (-48, 24)),
    ("4 · Suporte para gravar o treino", "94 × 82 × 70 mm", suporte, (-56, 20)),
    ("5 · Porta-fichas de apoio", "112 × 48 × 42 mm", porta_fichas, (-62, 26)),
    ("6 · Microfone de mesa", "⌀ 76 × 96 mm", microfone, (-54, 18)),
    ("7 · Troféu três tempos", "124 × 58 × 126 mm", trofeu, (-54, 16)),
    ("8 · Letras VOX de balcão", "162 × 30 × 68 mm", letras, (-58, 18)),
    ("9 · Caixote porta-canetas", "96 × 86 × 98 mm", caixote, (-52, 20)),
]
