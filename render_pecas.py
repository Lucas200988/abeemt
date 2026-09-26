import sys, numpy as np, trimesh, matplotlib
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from render import carrega, desenha

CINZA, PRETO, LARANJA = "#C9CDCB", "#1A1A1A", "#E8712B"
BRANCO, GRAFITE, VERDE = "#EDEFEE", "#33373B", "#2E6E45"

print("carregando os geradores...")
weg = carrega("miniatura-weg", "weg_bess_miniatura.py")
dcco = carrega("miniatura-dcco", "gerador_dcco_miniatura.py")
ps = carrega("miniatura-powerstack", "bess_miniature.py")
ccr = carrega("miniatura-painel-ccr", "painel_ccr_miniatura.py")
chav = carrega("brinde-geral", "chaveiro_bateria.py")
org = carrega("brinde-geral", "organizador_mini_bess.py")
let = carrega("letras-crea-mutua", "letras_crea_mutua.py")


def posiciona(pecas, dx=0.0, dz=0.0, centrar=True):
    """Move um grupo de peças para (dx, dz), opcionalmente centrando antes."""
    v = np.vstack([m.vertices for m, _ in pecas])
    c = [(v[:, 0].min() + v[:, 0].max()) / 2, 0, (v[:, 2].min() + v[:, 2].max()) / 2] \
        if centrar else [0, 0, 0]
    saida = []
    for m, cor in pecas:
        g = m.copy()
        g.apply_translation([dx - c[0], 0, dz - c[2]])
        saida.append((g, cor))
    return saida


# painel 7: as peças coladas, lado a lado (aqui com a arte para cima, para poder vê-la)
coladas = (posiciona([(weg["plaq"], CINZA), (weg["logo_preto"], PRETO)], -26, 0)
           + posiciona([(ps["chapa"], BRANCO), (ps["marca"], GRAFITE),
                        (ps["indicador"], LARANJA)], 6, 0)
           + posiciona([(dcco["cracha"], VERDE), (dcco["cracha_logo"], BRANCO)], -26, 20)
           + posiciona([(dcco["escapamento"], PRETO)], 10, 20))

# painel 9: as duas palavras em letra 3D, na posição de mesa
BRANCO = "#EDEFEE"
letras = []
for nome, dy in (("crea", -58.0), ("mutua", 58.0)):
    g = let["em_pe"][nome].copy()
    g.apply_translation([0, dy, 0])
    letras.append((g, BRANCO))

# painel 8: as quatro placas em duas fileiras
placas = []
for (ns, chave), (dx, dz) in zip(
        [(weg, "plate_marks"), (dcco, "plate_marks"), (ps, "plate_text"), (ccr, "plate_marks")],
        [(-45, -45), (45, -45), (-45, 45), (45, 45)]):
    placas += posiciona([(ns["plate"], PRETO), (ns[chave], LARANJA)], dx, dz)

CENAS = [
 ("WEG BESS contêiner 1:80", "75,7 × 30,5 × 32,4 mm · 50 g · 3 filamentos", [
    (weg["body"], CINZA), (weg["cap"], CINZA), (weg["plaq"], CINZA),
    (weg["logo_preto"], PRETO), (weg["plate"], PRETO), (weg["plate_marks"], LARANJA)], True, 30),
 ("DCCO gerador Cummins 1:50", "72,4 × 25,0 × 43,7 mm · 49 g · 4 filamentos", [
    (dcco["body_green"], VERDE), (dcco["chassi_part"], PRETO), (dcco["cap"], VERDE),
    (dcco["cracha"], VERDE), (dcco["cracha_logo"], BRANCO), (dcco["escapamento"], PRETO),
    (dcco["plate"], PRETO), (dcco["plate_marks"], LARANJA)], True, 30),
 ("Sungrow PowerStack 1:25", "46,0 × 65,6 × 98,0 mm · 81 g · 3 filamentos", [
    (ps["body_white"], BRANCO), (ps["base_part"], GRAFITE), (ps["cap"], GRAFITE),
    (ps["light_bar"], LARANJA), (ps["chapa"], BRANCO), (ps["marca"], GRAFITE),
    (ps["indicador"], LARANJA), (ps["plate"], GRAFITE), (ps["plate_text"], LARANJA)], True, 24),
 ("Painel elétrico CCR 1:20", "40,0 × 30,0 × 100,0 mm · 68 g · 3 filamentos", [
    (ccr["body"], BRANCO), (ccr["cap"], GRAFITE), (ccr["porta"], BRANCO),
    (ccr["porta_logo"], GRAFITE), (ccr["plate"], GRAFITE),
    (ccr["plate_marks"], LARANJA)], True, 24),
 ("Chaveiro bateria — brinde de todos", "70 × 32 × 3,2 mm · 5,73 g · até 716 unidades", [
    (chav["base"], LARANJA), (chav["relevo"], PRETO)], False, 52),
 ("Organizador mini BESS — destaque", "70 × 90 × 60 mm · 74,7 g · até 58 unidades", [
    (org["corpo_claro"], CINZA), (org["rodape"], PRETO)], True, 28),
 ("As quatro peças que vão coladas", "chapa WEG · crachá DCCO · chapa SUNGROW · escapamento",
    coladas, True, 40),
 ("Placas de base — as quatro numa mesa", "180 × 180 × 4,5 mm · 103 g · 2 filamentos",
    placas, True, 40),
 ("Letras 3D — CREA-MT e Mútua", "194 mm de largura · branco, um filamento só · "
    "imprime deitada", letras, False, 24),
]

fig = plt.figure(figsize=(20.5, 17.2), facecolor="#f4f4f2")
fig.suptitle("FMEES 2026 — resultado esperado de cada impressão", fontsize=20,
             fontweight="bold", color="#23262a", y=0.981)
fig.text(0.5, 0.9575, "renderizado a partir dos mesmos arquivos que vão para a impressora, "
         "nas cores dos filamentos", ha="center", fontsize=11, color="#5d6167")

for i, (titulo, sub, pecas, zup, elev) in enumerate(CENAS):
    ax = fig.add_subplot(3, 3, i + 1)
    ax.set_facecolor("#f4f4f2")
    print(f"  desenhando {titulo}...")
    desenha(ax, pecas, elev=elev, z_up=zup)
    ax.set_title(titulo, fontsize=12, fontweight="bold", color="#23262a", pad=8)
    ax.text(0.5, -0.05, sub, transform=ax.transAxes, ha="center", fontsize=9.3, color="#5d6167")
fig.subplots_adjust(left=0.008, right=0.992, top=0.930, bottom=0.028, wspace=0.02, hspace=0.14)
fig.savefig("/home/user/abeemt/fmees-2026-pecas.png",
            dpi=150, facecolor="#f4f4f2")
print("gravado")
