"""Renderiza cada peça montada, nas cores dos filamentos, numa folha só.

Vista isométrica com face oculta removida, ordenação por profundidade e luz difusa.
Não é fotorrealismo — é o que a peça deve ser, para conferir antes de imprimir.
"""
import io, os, sys, warnings
import numpy as np
import trimesh
warnings.filterwarnings("ignore")
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection

sys.path.insert(0, "/home/user/abeemt")
TO_Z_UP = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])


def carrega(pasta, arq, corte="# ---------- exportação ----------"):
    d = os.getcwd()
    os.chdir(f"/home/user/abeemt/{pasta}")
    try:
        texto = open(arq).read()
        if corte not in texto:
            corte = "# ---------- verificação e exportação ----------"
        ns = {"__name__": "__render__", "__file__": os.path.abspath(arq)}
        buf, old = io.StringIO(), sys.stdout
        sys.stdout = buf
        try:
            exec(compile(texto.split(corte)[0], arq, "exec"), ns)
        finally:
            sys.stdout = old
    finally:
        os.chdir(d)
    return ns


def base(cor):
    return np.array([int(cor[i:i + 2], 16) / 255 for i in (1, 3, 5)])


def desenha(ax, pecas, az=-52.0, elev=27.0, luz=(-0.35, -0.72, 0.60), z_up=True):
    """pecas -- lista de (malha, cor hex).

    az negativo põe a câmera do lado da FRENTE das maquetes: no referencial de
    construção a frente olha para +Z, que depois da rotação vira -Y do mundo.
    z_up=False para peças que já nascem com a espessura em Z (os chaveiros)."""
    a, e = np.radians(az), np.radians(elev)
    d = np.array([np.cos(e) * np.cos(a), np.cos(e) * np.sin(a), np.sin(e)])
    r = np.cross([0, 0, 1.0], d); r /= np.linalg.norm(r)
    u = np.cross(d, r)
    L = np.array(luz, float); L /= np.linalg.norm(L)

    tri, cor, prof = [], [], []
    for m, hexc in pecas:
        g = m.copy()
        if z_up:
            g.apply_transform(TO_Z_UP)
        n = g.face_normals
        visivel = n @ d > 0.0                       # face oculta removida
        t = g.triangles[visivel]
        nv = n[visivel]
        # ambiente alto de propósito: com ambiente baixo o gabinete branco sai cinza
        lum = 0.62 + 0.38 * np.clip(nv @ L, 0, 1)
        c = np.clip(base(hexc)[None, :] * lum[:, None], 0, 1)
        tri.append(np.stack([t @ r, t @ u], axis=-1))
        cor.append(c)
        prof.append(t.reshape(-1, 3) @ d)
    tri = np.concatenate(tri); cor = np.concatenate(cor)
    prof = np.concatenate([p.reshape(-1, 3).mean(1) for p in prof])
    o = np.argsort(prof)                             # pintor: fundo primeiro
    # borda da mesma cor da face, fina: sem ela, a suavização do matplotlib deixa
    # um fio de fundo entre triângulos vizinhos, e numa face quebrada em milhares
    # de lascas — a frente da placa, cheia de furos da arte — isso vira uma teia
    # de linhas claras que não existe na peça.
    ax.add_collection(PolyCollection(tri[o], facecolors=cor[o], edgecolors=cor[o],
                                     linewidths=0.3, antialiased=True))
    v = tri.reshape(-1, 2)
    cx, cy = v[:, 0].mean(), v[:, 1].mean()
    raio = max(np.ptp(v[:, 0]), np.ptp(v[:, 1])) * 0.62
    ax.set_xlim(cx - raio, cx + raio); ax.set_ylim(cy - raio, cy + raio)
    ax.set_aspect("equal"); ax.axis("off")
