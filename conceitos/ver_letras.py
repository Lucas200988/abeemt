"""Vistas das letras 3D, para escolher antes de produzir."""
import os
import sys
import warnings

warnings.filterwarnings("ignore")
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))
sys.path.insert(0, AQUI)
from render import desenha
import letras as L

PRETO, LARANJA, CINZA = "#1A1A1A", "#E8712B", "#C9CDCB"
print("montando...")
crea, _ = L.conceito_letras("crea")
mutua, _ = L.conceito_letras("mutua")

par = [(crea.copy(), PRETO)]
m = mutua.copy()
m.apply_translation([0, 46.0, 0])
par.append((m, LARANJA))

VISTAS = [("CREA-MT — de frente", [(crea, PRETO)], -90.0, 6.0),
          ("CREA-MT — três quartos", [(crea, PRETO)], -54.0, 20.0),
          ("mútua — de frente", [(mutua, LARANJA)], -90.0, 6.0),
          ("mútua — três quartos", [(mutua, LARANJA)], -54.0, 20.0),
          ("as duas, na mesma escala", par, -58.0, 26.0),
          ("como imprime: deitada, face contra o vidro",
           [(L.deitada(crea), PRETO)], -54.0, 30.0)]

fig = plt.figure(figsize=(15.5, 10.6), facecolor="#f4f4f2")
fig.suptitle("Letras 3D de mesa — 194 mm de largura", fontsize=19, fontweight="bold",
             color="#23262a", y=0.975)
fig.text(0.5, 0.943, "letra de 30 mm com 16 mm de espessura, sobre rodapé de 5 × 28 mm · "
         "uma cor só · imprime deitada, sem suporte", ha="center", fontsize=11,
         color="#5d6167")
for i, (titulo, pecas, az, elev) in enumerate(VISTAS):
    ax = fig.add_subplot(2, 3, i + 1)
    ax.set_facecolor("#f4f4f2")
    desenha(ax, pecas, az=az, elev=elev, z_up=False)
    ax.set_title(titulo, fontsize=11.5, color="#23262a", pad=6)
fig.subplots_adjust(left=0.01, right=0.99, top=0.895, bottom=0.01, wspace=0.0, hspace=0.08)
fig.savefig(os.path.join(AQUI, "conceito-letras.png"), dpi=140, facecolor="#f4f4f2")
print("gravado")
