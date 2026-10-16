"""Renderiza cada peça montada, nas cores dos filamentos, numa folha só.

Vista isométrica com z-buffer e luz difusa. Não é fotorrealismo — é o que a peça
deve ser, para conferir antes de imprimir.

POR QUE Z-BUFFER E NÃO ORDENAÇÃO POR PROFUNDIDADE: a versão antiga pintava os
triângulos do fundo para a frente, ordenados pelo centro de cada um. Isso quebra
quando uma face grande e um relevo raso dividem o mesmo lugar: a frente de um
porta-fichas de 112 mm são DOIS triângulos, e o centro deles fica mais perto da
câmera que metade do logo de 1 mm de relevo que está por cima. Resultado: o logo
saía picado, cortado na diagonal. Com z-buffer a comparação é por pixel, então
1 mm de relevo basta para aparecer inteiro.
"""
import io, os, sys, warnings
import numpy as np
import trimesh
warnings.filterwarnings("ignore")
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

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


def _rasteriza(T, C, x0, x1, y1, n):
    """T -- (F,3,3) com x, y de tela e profundidade. C -- (F,3) cor já sombreada.

    Devolve (rgb, alfa) em n x n. Projeção ortográfica, então a profundidade
    interpola linearmente na tela — baricêntrica simples basta.
    """
    s = n / (x1 - x0)
    px = (T[:, :, 0] - x0) * s
    py = (y1 - T[:, :, 1]) * s
    dz = T[:, :, 2]

    rgb = np.zeros((n, n, 3))
    alf = np.zeros((n, n))
    zb = np.full((n, n), -np.inf)

    lo_x = np.floor(px.min(1)).astype(int)
    hi_x = np.ceil(px.max(1)).astype(int)
    lo_y = np.floor(py.min(1)).astype(int)
    hi_y = np.ceil(py.max(1)).astype(int)
    dentro = (hi_x >= 0) & (lo_x < n) & (hi_y >= 0) & (lo_y < n)
    lo_x = np.clip(lo_x, 0, n - 1); hi_x = np.clip(hi_x, 0, n - 1)
    lo_y = np.clip(lo_y, 0, n - 1); hi_y = np.clip(hi_y, 0, n - 1)

    for i in np.nonzero(dentro)[0]:
        ix0, ix1, iy0, iy1 = lo_x[i], hi_x[i], lo_y[i], hi_y[i]
        ax_, ay_ = px[i, 0], py[i, 0]
        bx_, by_ = px[i, 1], py[i, 1]
        cx_, cy_ = px[i, 2], py[i, 2]
        area = (bx_ - ax_) * (cy_ - ay_) - (cx_ - ax_) * (by_ - ay_)
        if abs(area) < 1e-9:
            continue
        X = np.arange(ix0, ix1 + 1)[None, :] + 0.5
        Y = np.arange(iy0, iy1 + 1)[:, None] + 0.5
        w0 = ((bx_ - X) * (cy_ - Y) - (cx_ - X) * (by_ - Y)) / area
        w1 = ((cx_ - X) * (ay_ - Y) - (ax_ - X) * (cy_ - Y)) / area
        w2 = 1.0 - w0 - w1
        # tolerância folgada na borda: sem ela, dois triângulos vizinhos podem
        # ambos recusar o mesmo pixel e sobra um fio de fundo entre eles
        m = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        if not m.any():
            continue
        z = w0 * dz[i, 0] + w1 * dz[i, 1] + w2 * dz[i, 2]
        jan = zb[iy0:iy1 + 1, ix0:ix1 + 1]
        pon = m & (z > jan)
        if not pon.any():
            continue
        jan[pon] = z[pon]
        rgb[iy0:iy1 + 1, ix0:ix1 + 1][pon] = C[i]
        alf[iy0:iy1 + 1, ix0:ix1 + 1][pon] = 1.0
    return rgb, alf


def _reduz(rgb, alf, ss):
    """Média de blocos ss x ss com alfa pré-multiplicado — a borda da peça mistura
    com o fundo de verdade, em vez de puxar preto de pixel vazio."""
    if ss == 1:
        return np.dstack([rgb, alf])
    n = rgb.shape[0] // ss
    a = alf.reshape(n, ss, n, ss).mean((1, 3))
    p = (rgb * alf[:, :, None]).reshape(n, ss, n, ss, 3).mean((1, 3))
    out = np.zeros((n, n, 4))
    nz = a > 0
    out[..., :3][nz] = p[nz] / a[nz][:, None]
    out[..., 3] = a
    return out


def desenha(ax, pecas, az=-52.0, elev=27.0, luz=(-0.35, -0.72, 0.60), z_up=True,
            res=800, ss=2):
    """pecas -- lista de (malha, cor hex).

    az negativo põe a câmera do lado da FRENTE das maquetes: no referencial de
    construção a frente olha para +Z, que depois da rotação vira -Y do mundo.
    z_up=False para peças que já nascem com a espessura em Z (os chaveiros)."""
    a, e = np.radians(az), np.radians(elev)
    d = np.array([np.cos(e) * np.cos(a), np.cos(e) * np.sin(a), np.sin(e)])
    r = np.cross([0, 0, 1.0], d); r /= np.linalg.norm(r)
    u = np.cross(d, r)
    L = np.array(luz, float); L /= np.linalg.norm(L)

    tri, cor = [], []
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
        tri.append(np.stack([t @ r, t @ u, t @ d], axis=-1))
        cor.append(np.clip(base(hexc)[None, :] * lum[:, None], 0, 1))
    T = np.concatenate(tri); C = np.concatenate(cor)

    v = T[:, :, :2].reshape(-1, 2)
    cx, cy = v[:, 0].mean(), v[:, 1].mean()
    raio = max(np.ptp(v[:, 0]), np.ptp(v[:, 1])) * 0.62
    x0, x1, y0, y1 = cx - raio, cx + raio, cy - raio, cy + raio
    img = _reduz(*_rasteriza(T, C, x0, x1, y1, res * ss), ss)
    ax.imshow(img, extent=(x0, x1, y0, y1), origin="upper", interpolation="bilinear")
    ax.set_xlim(x0, x1); ax.set_ylim(y0, y1)
    ax.set_aspect("equal"); ax.axis("off")
