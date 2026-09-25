"""Placas comemorativas CREA-MT e Mútua — FMEES 2026.

Duas placas de mesa, 100 x 120 x 4 mm, corpo preto com a arte laranja embutida
rente à face. Cada uma tem o seu pé, uma barra com rasgo inclinado 10 graus em
que a placa encaixa por atrito.

Por que a arte é embutida e não em relevo, e por que a face da arte imprime
CONTRA O VIDRO:

  Numa superfície de topo, a fronteira entre duas cores é uma costura entre
  perímetros, e o primeiro filete de cada cor depois da troca ainda vem sujo da
  cor anterior — foi o que estragou a chapa do SUNGROW. Virando a peça, a face
  da arte passa a ser a primeira camada, esmagada contra o vidro: a fronteira
  fica selada pela mesa, o brilho é o do vidro e a sujeira do purgo, se houver,
  sobe para dentro da peça em vez de aparecer.

  Consequência: NÃO usar passar a ferro (ironing). Em superfície de duas cores o
  ferro arrasta o escuro para dentro do claro.

A arte é uma cor só. Os dois logos são azuis, e azul não temos; além disso,
laranja sobre preto é o padrão que as quatro placas de base já seguem. Quem
preferir a arte em branco troca só o filamento do slot 2 — o arquivo não muda.

Purga: a arte inteira está nas TRÊS primeiras camadas (0 a 0,65 mm = 0,25 + 0,2
+ 0,2) e daí para cima é preto puro. São três trocas para o trabalho inteiro,
uma por camada de arte, contado no arquivo gravado. E como acima de 0,65 mm não
há laranja nenhum, os pés (pretos do começo ao fim) entram na mesma mesa sem
custar troca nenhuma.

Os logos são vetorizados dos arquivos oficiais em nl/ por limiar de luminância:
o que é escuro no original (azul do brasão/disco e o preto da palavra) vira arte,
o que é claro (o cavaleiro do CREA, a figura da Mútua, a engrenagem) vira vão e
mostra o preto do corpo. Dá uma leitura de duas tintas fiel ao desenho.

Peças (impressão sem suporte):
  placa - 100 x 120 x 4 mm, deitada, ARTE PARA BAIXO
  pe    - 100 x 30 x 11 mm, em pé sobre a base, rasgo para cima

Eixos: X = largura, Y = altura da placa, Z = espessura. Exporta com Z para cima
(a placa já sai deitada, que é como imprime).
"""
import os
import pickle
import sys

import numpy as np
import trimesh
from trimesh.creation import box, extrude_polygon
from shapely.geometry import Polygon, Point, box as sbox
from shapely.ops import unary_union
from shapely import affinity
from matplotlib.textpath import TextPath
from matplotlib.font_manager import FontProperties

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
from bambu3mf import write_3mf, place_in_rows, clean_mesh

# ---------- parâmetros ----------
PL_W, PL_H, PL_T = 100.0, 120.0, 4.0     # placa
R_CANTO = 5.0
ARTE, SINK = 0.65, 0.05                  # 0,65 = 0,25 da primeira camada + duas de 0,2

PE_W, PE_D, PE_H = 100.0, 30.0, 11.0     # pé
PE_R = 4.0
RASGO_W, RASGO_PROF, RASGO_FOLGA = 64.0, 7.5, 0.4
INCL = np.radians(10.0)                  # inclinação para trás
# rasgo adiantado no pé: inclinada 10 graus, a placa joga o centro de massa
# 60 * sen(10) = 10,4 mm para trás do rasgo. Com o rasgo a 9 mm da frente, o
# centro de massa cai em y = 19,4 mm, dentro dos 30 mm do pé e a 10,6 mm da borda
# de trás. Adiantar o rasgo é o que impede o conjunto de tombar para trás.
RASGO_Y = 9.0

FONT = FontProperties(fname="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
PASTA_NL = os.path.join(RAIZ, "nl")


def rbox(w, h, d, x=0, y=0, z=0):
    b = box(extents=[w, h, d])
    b.apply_translation([x + w / 2, y + h / 2, z + d / 2])
    return b


def rounded_rect(x0, y0, x1, y1, r):
    return sbox(x0, y0, x1, y1).buffer(-r, join_style=1).buffer(r, join_style=1)


def extrusao(shape, h):
    # simplify(0.001) antes de extrudar tira o ponto colinear que o buffer de
    # engorda e a união deixam na borda — cada um deles é um triângulo de área
    # zero a menos na tampa. Não zera: o contorno traçado do logo tem pontos
    # colineares distantes um do outro no anel, que o Douglas-Peucker mantém e o
    # triangulador às vezes junta num triângulo degenerado. Esses sobrevivem, e
    # quem lida com eles é a gravação (ver _clean em bambu3mf.py).
    geoms = list(shape.geoms) if hasattr(shape, "geoms") else [shape]
    return trimesh.util.concatenate([extrude_polygon(g.simplify(0.001), h) for g in geoms])


# ---------- texto ----------
# Escala tirada de uma palavra de referência, não da própria linha. Pela regra
# usual (altura da linha / altura pedida), uma linha com acento — ASSISTÊNCIA,
# por exemplo — tem o Ê comendo a altura, e sai com letra menor que a linha
# vizinha sem acento. Medindo sempre a mesma referência, todas as linhas de um
# mesmo corpo saem com a mesma altura de letra, com ou sem acento.
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
        elif shape.contains(p.representative_point()):   # contra-forma do R, do A, do O
            shape = shape.difference(p)
        else:
            shape = shape.union(p)
    return shape


def texto2d(txt, cap, max_width=None, engorda=0.10):
    shape = _glifos(txt)
    ref = _glifos(REF).bounds
    k = cap / (ref[3] - ref[1])
    minx, miny, maxx, maxy = shape.bounds
    if max_width and (maxx - minx) * k > max_width:
        k = max_width / (maxx - minx)
    shape = affinity.scale(shape, k, k, origin=(0, 0))
    return shape.buffer(engorda, join_style=1).simplify(0.02)


# ---------- emblema da ABEE-MT ----------
def emblema_abee(diam, traco=1.1):
    r = diam / 2
    anel = Point(0, 0).buffer(r, 64).difference(Point(0, 0).buffer(r - traco, 64))
    h = diam * 0.72
    raio = Polygon([(0.55, 1.0), (0.10, 0.42), (0.42, 0.42), (0.30, 0.0),
                    (0.90, 0.58), (0.58, 0.58), (0.70, 1.0)])
    raio = affinity.translate(affinity.scale(raio, h, h, origin=(0, 0)), -0.5 * h, -0.5 * h)
    return unary_union([anel, raio.buffer(0.06, join_style=2)])


# ---------- vetorização dos logos ----------
def _luz(rgb):
    return rgb[..., 0] * 0.30 + rgb[..., 1] * 0.59 + rgb[..., 2] * 0.11


def traca(png, limiar, cols=None, rows=None, simplify=0.6, cache=None):
    """Contorna o que é escuro no arquivo oficial e devolve a forma com furos.

    O recorte por linhas/colunas separa emblema, palavra e linha de apoio: cada
    um entra na composição com a sua escala, porque no logo original a linha de
    apoio é fina demais para virar filete de 0,4 mm — ela é redigitada.
    """
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
    for p in polys:                       # maior primeiro: quem cai dentro é furo
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


# ---------- composição ----------
def centrado(shape, y_topo):
    minx, miny, maxx, maxy = shape.bounds
    return affinity.translate(shape, -(minx + maxx) / 2, y_topo - maxy)


def empilha(itens):
    """itens = [(forma, folga acima)]. Empilha de cima para baixo, centrado em x = 0."""
    y, saida = 0.0, []
    for forma, folga in itens:
        y -= folga
        saida.append(centrado(forma, y))
        b = forma.bounds
        y -= b[3] - b[1]
    return unary_union(saida), -y


def lado_a_lado(formas, folga):
    """Alinha pelo centro vertical e encosta em x, para uma linha só."""
    x, saida = 0.0, []
    for f in formas:
        b = f.bounds
        saida.append(affinity.translate(f, x - b[0], -(b[1] + b[3]) / 2))
        x += (b[2] - b[0]) + folga
    return unary_union(saida)


def arte_de(logo, sub1, sub2):
    emblema, palavra = logo
    bloco, altura = empilha([
        (emblema, 0.0),
        (palavra, 5.0),
        (texto2d(sub1, 3.2, 78), 4.5),
        (texto2d(sub2, 3.2, 78), 2.0),
        (sbox(0, 0, 70.0, 1.2), 8.0),                      # régua de separação
        (texto2d("FMEES 2026", 8.5, 72), 8.0),
        (lado_a_lado([emblema_abee(11.0),
                      texto2d("HOMENAGEM ABEE-MT", 4.2, 60)], 4.0), 7.0),
    ])
    bloco = affinity.translate(bloco, PL_W / 2, (PL_H + altura) / 2)
    # ESPELHA EM X. A face da arte é a de z = 0, a que vai contra o vidro — quem
    # olha a placa pronta está do lado -Z, olhando o plano XY por baixo. Composta
    # na orientação natural do plano (a que se lê de +Z), a escrita sairia
    # invertida na peça impressa. Foi o desenho isométrico que pegou isso: no
    # render, "CREA-MT" aparecia ao contrário.
    return affinity.scale(bloco, -1, 1, origin=(PL_W / 2, 0)), altura


def placa_de(arte2d):
    """Corpo com o bolso da arte e a arte que o preenche, rente à face de baixo.

    O bolso é 0,05 mm mais raso que a arte, e não mais fundo: assim a arte
    termina em 0,65 mm, que é exatamente o topo da terceira camada (0,25 + 0,2 +
    0,2), e a interpenetração das duas cores fica dentro dessa camada. Fazendo o
    contrário, a arte invadiria a quarta camada e o fatiador trocaria de filamento
    uma vez a mais por causa de uma lasca de 0,05 mm.
    """
    corpo = extrude_polygon(rounded_rect(0, 0, PL_W, PL_H, R_CANTO), PL_T)
    corpo = corpo.difference(extrusao(arte2d, ARTE - SINK))
    return corpo, extrusao(arte2d, ARTE)


def pe():
    """Barra com rasgo inclinado. Imprime em pé sobre a base, rasgo para cima."""
    b = extrude_polygon(rounded_rect(0, 0, PE_W, PE_D, PE_R), PE_H)
    corte = rbox(RASGO_W, PL_T + RASGO_FOLGA, 3 * PE_H,
                 (PE_W - RASGO_W) / 2, RASGO_Y - (PL_T + RASGO_FOLGA) / 2,
                 PE_H - RASGO_PROF)
    # sinal negativo: girando em torno de X, o topo do rasgo tem de cair para +Y,
    # o fundo do pé. Com o sinal positivo a placa se inclinaria para a FRENTE e o
    # centro de massa dela sairia da base — tombava.
    corte.apply_transform(trimesh.transformations.rotation_matrix(
        -INCL, [1, 0, 0], point=[PE_W / 2, RASGO_Y, PE_H]))
    return b.difference(corte)


# ---------- as duas placas ----------
CREA = dict(
    nome="crea",
    logo=(escala(traca("crea.png", 95, cols=(0, 86), cache="crea_emblema.pkl"), 28.0, "h"),
          escala(traca("crea.png", 95, cols=(86, 391), rows=(0, 56),
                       cache="crea_palavra.pkl"), 64.0, "w")),
    sub1="CONSELHO REGIONAL DE ENGENHARIA",
    sub2="E AGRONOMIA DE MATO GROSSO",
)
MUTUA = dict(
    nome="mutua",
    logo=(escala(traca("mutua.png", 110, cols=(0, 140), cache="mutua_emblema.pkl"), 28.0, "h"),
          escala(traca("mutua.png", 110, cols=(140, 520), rows=(0, 106),
                       cache="mutua_palavra.pkl"), 64.0, "w")),
    sub1="CAIXA DE ASSISTÊNCIA DOS",
    sub2="PROFISSIONAIS DO CREA",
)

parts, artes = {}, {}
for spec in (CREA, MUTUA):
    a2d, altura = arte_de(spec["logo"], spec["sub1"], spec["sub2"])
    corpo, arte = placa_de(a2d)
    parts[f"placa_{spec['nome']}_corpo"] = corpo
    parts[f"placa_{spec['nome']}_arte"] = arte
    artes[spec["nome"]] = a2d
    print(f"placa {spec['nome']:6s} bloco de arte {altura:5.1f} mm de altura, "
          f"margem {(PL_H - altura) / 2:4.1f} mm")
parts["pe_crea"] = pe()
parts["pe_mutua"] = pe()

# ---------- conferência ----------
DENS = 1.24
for nome, m in parts.items():
    m.merge_vertices()
    m.fix_normals()
    print(f"{nome:20s} fechada={m.is_watertight}  volume={m.volume:8.0f} mm³"
          f"  {np.round(m.extents, 1)} mm  {m.volume / 1000 * DENS:5.1f} g")


def fino(shape, t):
    """Fração da área que some numa abertura de t: é o que é mais fino que t."""
    aberto = shape.buffer(-t / 2, join_style=1).buffer(t / 2, join_style=1)
    return 1 - aberto.area / shape.area


for nome, a2d in artes.items():
    caixa = sbox(*a2d.buffer(2.0).bounds)
    print(f"arte {nome:6s} traço fino demais (<0,42 mm): {fino(a2d, 0.42) * 100:4.1f}%"
          f"  |  vão fino demais: {fino(caixa.difference(a2d), 0.42) * 100:4.1f}%")

# ---------- exportação ----------
for nome in ("crea", "mutua"):
    stl = parts[f"placa_{nome}_corpo"].union(parts[f"placa_{nome}_arte"])
    stl = clean_mesh(stl)
    print(f"{'stl_placa_' + nome:20s} fechada={stl.is_watertight}  {np.round(stl.extents, 1)} mm")
    stl.export(f"placa_{nome}.stl")
clean_mesh(parts["pe_crea"]).export("pe_placa.stl")

COLOR_GROUPS = {
    "placa_crea":  {"1_preto": ["placa_crea_corpo"], "2_laranja": ["placa_crea_arte"]},
    "placa_mutua": {"1_preto": ["placa_mutua_corpo"], "2_laranja": ["placa_mutua_arte"]},
    "pe_crea":     {"1_preto": ["pe_crea"]},
    "pe_mutua":    {"1_preto": ["pe_mutua"]},
}
PALETTE = [("1_preto", "Preto", "#1A1A1A"), ("2_laranja", "Laranja", "#E8712B")]
# Quatro casas na gravação, não três: o contorno do logo tem vértices a poucos
# milésimos um do outro, e arredondar para 0,001 mm alinhava um deles sobre a
# aresta vizinha e abria a malha.
PRECISAO = 4


def monta(nomes):
    return [(obj, [(cor, trimesh.util.concatenate([parts[n].copy() for n in ns]))
                   for cor, ns in COLOR_GROUPS[obj].items()]) for obj in nomes]


# Aqui a mesa "multicor" é a que vale a pena: as quatro peças juntas custam as
# mesmas três trocas que só as duas placas custariam, porque o laranja vive nas
# três primeiras camadas e os pés são pretos do começo ao fim — eles entram nessas
# camadas na cor que já está no bico. É o oposto das maquetes, onde separar por
# "qual cor está embaixo" era o que encolhia a torre de purga.
# As outras duas mesas ficam para quem quiser imprimir só as placas ou só os pés.
MESAS = [
    ("multicor", list(COLOR_GROUPS),
     [["placa_crea", "placa_mutua"], ["pe_crea", "pe_mutua"]]),
    ("placas", ["placa_crea", "placa_mutua"], [["placa_crea", "placa_mutua"]]),
    ("pes", ["pe_crea", "pe_mutua"], [["pe_crea", "pe_mutua"]]),
]
for sufixo, nomes, fileiras in MESAS:
    objs = monta(nomes)
    place_in_rows(objs, fileiras)
    v = np.vstack([m.vertices for _, ps in objs for _, m in ps])
    slots = write_3mf(f"placas_crea_mutua_{sufixo}.3mf",
                      "Placas CREA-MT e Mútua — FMEES 2026", objs, PALETTE,
                      precision=PRECISAO)
    print(f"{'3mf_' + sufixo:16s} {len(objs)} objetos  mesa {np.round(v.max(0) - v.min(0), 1)} mm"
          f"  filamentos: " + ", ".join(f"{k} = {s}" for k, s in slots.items()))
print("arquivos gravados")
