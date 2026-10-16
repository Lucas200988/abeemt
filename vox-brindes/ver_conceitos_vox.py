"""Desenha as nove ideias de brinde da VOX numa folha só."""
import os
import sys
import warnings

warnings.filterwarnings("ignore")
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))
sys.path.insert(0, AQUI)
from render import desenha
from conceitos_vox import IDEIAS

FUNDO = "#F3F1EC"
print("montando...")
MONTADAS = [(t, s, f(), v) for t, s, f, v in IDEIAS]

fig = plt.figure(figsize=(16.5, 16.2), facecolor=FUNDO)
fig.suptitle("VOX — nove ideias de brinde", fontsize=21, fontweight="bold",
             color="#15201F", y=0.9885, va="top")
fig.text(0.5, 0.9565, "só para escolher. Nenhum arquivo de impressão foi gerado ainda.",
         ha="center", va="top", fontsize=11.5, color="#5B6563")

for i, (titulo, sub, pecas, (az, elev)) in enumerate(MONTADAS):
    ax = fig.add_subplot(3, 3, i + 1)
    ax.set_facecolor(FUNDO)
    print(f"  desenhando {titulo}...")
    desenha(ax, [(m, cor) for cor, m in pecas], az=az, elev=elev, z_up=False)
    ax.set_title(f"{titulo}\n{sub}", fontsize=11.5, color="#15201F",
                 loc="left", pad=6, linespacing=1.7)
fig.subplots_adjust(left=0.01, right=0.99, top=0.893, bottom=0.012,
                    wspace=0.02, hspace=0.14)
fig.savefig(os.path.join(AQUI, "ideias-brindes-vox.png"), dpi=140, facecolor=FUNDO)
print("gravado")
