"""Nomes avulsos para colar — CREA-MT e Mútua, FMEES 2026.

A mesma palavra das letras de mesa, só que fina e sem rodapé: uma plaquinha de
2,4 mm para colar no porta-canetas, na tampa de uma caixa, onde for.

Dois tamanhos de cada, porque a peça é barata (menos de 1 g) e assim dá para
experimentar no porta-canetas antes de decidir:

  62 mm  — cabe na frente do organizador mini BESS, que tem 70 mm de largura
  90 mm  — para porta-canetas maior

A ARTE É ESPELHADA NO ARQUIVO, de propósito. A peça imprime com a face boa em
z = 0, contra o vidro, e essa face é olhada de baixo: desenhada na orientação
natural do plano, sairia invertida na peça. É a mesma conta das chapas das
maquetes. A face de cima, a que fica com o acabamento de camada, é a de colar.

A ligadura que prende o hífen do CREA-MT e o acento do mútua é refeita NO TAMANHO
FINAL, e não herdada da peça grande: herdada, ela encolheria junto com a palavra e
chegaria a 0,8 mm no tamanho de 62 mm, dois filetes de parede. Aqui ela tem 1,4 mm
em qualquer tamanho.

Não grava o rodapé nem o gravado do evento: são só os nomes.
"""
import io
import os
import sys
import warnings

warnings.filterwarnings("ignore")
import numpy as np
import trimesh
from shapely import affinity

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, RAIZ)
from bambu3mf import write_3mf, place_in_rows, clean_mesh

# Reaproveita o gerador das letras de mesa até antes da montagem: traçado do logo,
# ligadura e extrusão são os mesmos, e assim não há duas cópias para manter.
fonte = open(os.path.join(AQUI, "letras_crea_mutua.py")).read().split("DENS = 1.24")[0]
anterior = os.getcwd()
os.chdir(AQUI)
L = {"__name__": "__nomes__", "__file__": os.path.join(AQUI, "letras_crea_mutua.py")}
buf, real = io.StringIO(), sys.stdout
sys.stdout = buf
try:
    exec(compile(fonte, "letras_crea_mutua.py", "exec"), L)
finally:
    sys.stdout = real
    os.chdir(anterior)

ESP = 2.4                 # espessura da plaquinha
LIGA_COLADA = 1.4         # ligadura, no tamanho final
TAMANHOS = [62.0, 90.0]
DENS = 1.24


def nome(spec, largura):
    """A palavra sozinha, espelhada, com a face boa em z = 0."""
    bruto = L["traca"](spec["png"], spec["limiar"], spec["cols"], spec["rows"],
                       cache=os.path.join(AQUI, spec["cache"]))
    minx, miny, maxx, maxy = bruto.bounds
    k = largura / (maxx - minx)
    p = affinity.scale(bruto, k, k, origin=(0, 0))
    p = affinity.translate(p, -minx * k, -miny * k)
    L["LIGA"] = LIGA_COLADA          # ligadura no tamanho final, não herdada
    p = L["liga_soltas"](p)
    p = affinity.scale(p, -1, 1, origin=(largura / 2, 0))   # face olhada de baixo
    return L["extrusao"](p, ESP)


parts = {}
for spec in (L["CREA"], L["MUTUA"]):
    for larg in TAMANHOS:
        m = nome(spec, larg)
        m.merge_vertices()
        chave = f"nome_{spec['nome']}_{int(larg)}"
        corpos = len(m.split(only_watertight=False))
        parts[chave] = m
        print(f"{chave:18s} {np.round(m.extents, 1)} mm  fechada={m.is_watertight}  "
              f"corpos={corpos}  {m.volume / 1000 * DENS:4.2f} g")
        assert corpos == 1, "o nome tem de sair inteiro, num pedaço só"

# ---------- exportação ----------
for chave, m in parts.items():
    clean_mesh(m).export(f"{chave}.stl")

PALETTE = [("1_branco", "Branco", "#EDEFEE")]
COLOR_GROUPS = {k: {"1_branco": [k]} for k in parts}
PRECISAO = 4


def monta(nomes):
    def junta(ns):
        ms = [parts[n].copy() for n in ns]
        return ms[0] if len(ms) == 1 else trimesh.util.concatenate(ms)

    return [(obj, [(cor, junta(ns)) for cor, ns in COLOR_GROUPS[obj].items()])
            for obj in nomes]


objs = monta(list(parts))
place_in_rows(objs, [["nome_crea_90", "nome_mutua_90"],
                     ["nome_crea_62", "nome_mutua_62"]], gap=10.0)
v = np.vstack([m.vertices for _, ps in objs for _, m in ps])
slots = write_3mf("nomes_colados.3mf", "Nomes para colar — CREA-MT e Mútua", objs,
                  PALETTE, precision=PRECISAO)
print(f"3mf_nomes_colados  {len(objs)} peças  mesa {np.round(v.max(0) - v.min(0), 1)} mm"
      f"  filamentos: " + ", ".join(f"{k} = {s}" for k, s in slots.items()))
print("arquivos gravados")
