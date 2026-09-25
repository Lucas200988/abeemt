"""Desenha os três conceitos numa folha só, para escolher antes de produzir."""
import os
import sys

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))
sys.path.insert(0, AQUI)
from render import desenha
from conceitos_fmees import conceito_engrenagem, conceito_ponte, conceito_torre

CORES = {"preto": "#1A1A1A", "cinza": "#C9CDCB", "laranja": "#E8712B"}

print("montando...")
CONCEITOS = [
    ("A · Engrenagem planetária", "gira de verdade, impressa montada numa peça só\n"
     "88 mm de diâmetro", conceito_engrenagem(), [(-52.0, 34.0), (-90.0, 72.0)]),
    ("B · Ponte treliçada", "treliça Warren com tabuleiro e encontros\n200 × 64 × 52 mm",
     conceito_ponte(), [(-52.0, 18.0), (-100.0, 8.0)]),
    ("C · Torre de transmissão", "perfilada, com mísulas e isoladores\n92 × 92 × 172 mm",
     conceito_torre(), [(-52.0, 14.0), (-95.0, 6.0)]),
]

fig = plt.figure(figsize=(15.5, 15.0), facecolor="#f4f4f2")
fig.suptitle("FMEES 2026 — três conceitos para CREA-MT e Mútua", fontsize=19,
             fontweight="bold", color="#23262a", y=0.975)
fig.text(0.5, 0.951, "só para escolher. Nenhum arquivo de impressão foi gerado ainda.",
         ha="center", fontsize=11, color="#5d6167")

for i, (titulo, sub, pecas, vistas) in enumerate(CONCEITOS):
    for j, (az, elev) in enumerate(vistas):
        ax = fig.add_subplot(3, 2, i * 2 + j + 1)
        ax.set_facecolor("#f4f4f2")
        desenha(ax, [(m, CORES[c]) for c, m in pecas], az=az, elev=elev, z_up=False)
        if j == 0:
            ax.set_title(f"{titulo}\n{sub}", fontsize=12.5, color="#23262a",
                         loc="left", pad=8, linespacing=1.6)
fig.subplots_adjust(left=0.01, right=0.99, top=0.885, bottom=0.01, wspace=0.0, hspace=0.06)
fig.savefig(os.path.join(AQUI, "conceitos-fmees-2026.png"), dpi=140, facecolor="#f4f4f2")
print("gravado")
