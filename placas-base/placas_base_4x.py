"""As quatro placas de base numa mesa só.

Cada maquete tem a sua placa de 84 x 84 x 3 mm com os dizeres em relevo. Desde que as
letras das quatro passaram a ser laranja sobre preto, as quatro viraram a mesma dupla de
cores — e aí não há razão para quatro trabalhos separados.

O ganho é maior do que só juntar: as quatro placas têm a mesma estrutura em Z, corpo preto
de 0 a 3 mm e letra laranja de 3 a 4,4 mm. Numa mesa só, o fatiador faz as camadas de 0 a 3
inteiras em preto e as de 3 a 4,4 inteiras em laranja — UMA troca de filamento para as
quatro placas, contra uma por placa mais a torre de purga de cada trabalho.

As malhas vêm dos próprios geradores de cada maquete, executados até a seção de exportação;
nada é redesenhado aqui. Rodar de novo qualquer gerador e depois este arquivo mantém tudo
em sincronia.
"""
import io
import os
import sys

import numpy as np
import trimesh

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
from bambu3mf import write_3mf, place_in_rows

# pasta, arquivo do gerador, nome da malha dos dizeres, nome da maquete
FONTES = [
    ("miniatura-weg", "weg_bess_miniatura.py", "plate_marks", "weg"),
    ("miniatura-dcco", "gerador_dcco_miniatura.py", "plate_marks", "dcco"),
    ("miniatura-powerstack", "bess_miniature.py", "plate_text", "powerstack"),
    ("miniatura-painel-ccr", "painel_ccr_miniatura.py", "plate_marks", "ccr"),
]
CORTE = "# ---------- exportação ----------"
TO_Z_UP = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])
PALETTE = [("1_preto", "Preto", "#1A1A1A"), ("2_laranja", "Laranja", "#E8712B")]
DENSIDADE = 1.24


def placa_de(pasta, arquivo, chave):
    """Roda o gerador da maquete até a exportação e devolve (placa, dizeres) com Z para cima."""
    anterior = os.getcwd()
    os.chdir(os.path.join(RAIZ, pasta))
    try:
        fonte = open(arquivo).read().split(CORTE)[0]
        ns = {"__name__": "__placas_base__", "__file__": os.path.abspath(arquivo)}
        saida, real = io.StringIO(), sys.stdout
        sys.stdout = saida
        try:
            exec(compile(fonte, arquivo, "exec"), ns)
        finally:
            sys.stdout = real
    finally:
        os.chdir(anterior)
    corpo, dizeres = ns["plate"].copy(), ns[chave].copy()
    for m in (corpo, dizeres):
        m.apply_transform(TO_Z_UP)
    return corpo, dizeres


objects, total = [], 0.0
for pasta, arquivo, chave, nome in FONTES:
    corpo, dizeres = placa_de(pasta, arquivo, chave)
    for m in (corpo, dizeres):
        m.merge_vertices()
        m.fix_normals()
    g = (corpo.volume + dizeres.volume) / 1000 * DENSIDADE
    total += g
    print(f"placa_{nome:11s} {np.round(corpo.extents, 1)} mm  {g:5.1f} g")
    objects.append((f"placa_{nome}", [("1_preto", corpo), ("2_laranja", dizeres)]))

place_in_rows(objects, [["placa_weg", "placa_dcco"], ["placa_powerstack", "placa_ccr"]])
v = np.vstack([m.vertices for _, partes in objects for _, m in partes])
print(f"{'mesa':18s} {np.round(v.max(0) - v.min(0), 1)} mm  {total:5.1f} g no total")

slots = write_3mf("placas_base_4x.3mf", "Placas de base FMEES 2026 — as quatro", objects, PALETTE)
print("filamentos:", ", ".join(f"{k} = {v}" for k, v in slots.items()))
print("arquivo gravado")
