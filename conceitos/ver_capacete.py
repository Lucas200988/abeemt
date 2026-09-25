"""Vistas do capacete, para escolher antes de produzir."""
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))
sys.path.insert(0, AQUI)
from render import desenha
from capacete import conceito_capacete

CORES = {"branco": "#EDEFEE", "preto": "#1A1A1A", "laranja": "#E8712B"}
print("montando...")
CREA = [(m, CORES[c]) for c, m in conceito_capacete("CREA-MT")]
MUTUA = [(m, CORES[c]) for c, m in conceito_capacete("mútua")]

# az entre -90 e 90 olha a FRENTE (o bico e o brasão estão em +X)
VISTAS = [("três quartos, de frente", CREA, 38.0, 20.0),
          ("de frente", CREA, 2.0, 7.0),
          ("de lado", CREA, -88.0, 6.0),
          ("de cima", CREA, 38.0, 60.0),
          ("o mesmo com a marca da Mútua", MUTUA, 38.0, 20.0),
          ("de trás — FMEES 2026 gravado na aba", CREA, 170.0, 34.0)]

fig = plt.figure(figsize=(15.5, 10.4), facecolor="#f4f4f2")
fig.suptitle("Capacete de obra — 128 × 100 × 58 mm", fontsize=19, fontweight="bold",
             color="#23262a", y=0.975)
fig.text(0.5, 0.943, "casca de 2,4 mm · 80 g · imprime deitado na aba, sem suporte · "
         "uma cor só, mais a chapa do brasão colada na testa", ha="center", fontsize=11, color="#5d6167")
for i, (titulo, pecas, az, elev) in enumerate(VISTAS):
    ax = fig.add_subplot(2, 3, i + 1)
    ax.set_facecolor("#f4f4f2")
    desenha(ax, pecas, az=az, elev=elev, z_up=False)
    ax.set_title(titulo, fontsize=11.5, color="#23262a", pad=6)
fig.subplots_adjust(left=0.01, right=0.99, top=0.895, bottom=0.01, wspace=0.0, hspace=0.08)
fig.savefig(os.path.join(AQUI, "conceito-capacete.png"), dpi=140, facecolor="#f4f4f2")
print("gravado")
