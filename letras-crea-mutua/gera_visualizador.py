"""Gera o visualizador 3D das letras a partir das MESMAS malhas que vão imprimir.

Escreve `visualizador-letras.html`: uma página que roda sozinha, com as malhas
embutidas e o three.js vindo do CDN. Gira com o dedo ou com o mouse, troca entre
a posição de mesa e a de impressão, e mostra os números de cada peça.

As malhas saem do gerador, não dos STL: é o mesmo objeto que o 3MF leva, com os
vértices arredondados a duas casas (centésimo de milímetro, muito abaixo do que a
impressora resolve) só para o arquivo não inchar.
"""
import io
import json
import os
import sys
import warnings

warnings.filterwarnings("ignore")
import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))

# roda o gerador até a exportação, para pegar as peças em pé
fonte = open(os.path.join(AQUI, "letras_crea_mutua.py")).read()
fonte = fonte.split("# ---------- exportação ----------")[0]
anterior = os.getcwd()
os.chdir(AQUI)
ns = {"__name__": "__visualizador__", "__file__": os.path.join(AQUI, "letras_crea_mutua.py")}
buf, real = io.StringIO(), sys.stdout
sys.stdout = buf
try:
    exec(compile(fonte, "letras_crea_mutua.py", "exec"), ns)
finally:
    sys.stdout = real
    os.chdir(anterior)

# também os nomes de colar, que são peça à parte
import io as _io
fonte_n = open(os.path.join(AQUI, "nomes_colados.py")).read().split("# ---------- exportação ----------")[0]
os.chdir(AQUI)
nn = {"__name__": "__viz_nomes__", "__file__": os.path.join(AQUI, "nomes_colados.py")}
buf, real = _io.StringIO(), sys.stdout
sys.stdout = buf
try:
    exec(compile(fonte_n, "nomes_colados.py", "exec"), nn)
finally:
    sys.stdout = real
    os.chdir(anterior)

import trimesh

DENS = 1.24
PECAS = []
ALVOS = [("crea", "CREA-MT", False), ("mutua", "mútua", False),
         ("nome_crea_62", "CREA-MT de colar", True),
         ("nome_mutua_62", "mútua de colar", True)]
for chave, titulo, plano in ALVOS:
    if plano:
        # meia-volta em X: o arquivo leva a face boa para baixo, contra o vidro, e
        # aqui ela tem de ficar para cima, ou o visualizador mostra a face de colar
        # e a palavra sai espelhada na tela.
        m = nn["parts"][chave].copy()
        m.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0]))
    else:
        m = ns["em_pe"][chave].copy()
    m.merge_vertices()
    # centra em X e Y; Z fica apoiado no zero, que é onde a peça toca a mesa
    b = m.bounds
    m.apply_translation([-(b[0][0] + b[1][0]) / 2, -(b[0][1] + b[1][1]) / 2, -b[0][2]])
    # o desenho usa Z para cima; three.js usa Y. A troca é feita aqui, de uma vez,
    # em vez de girar o objeto na página toda hora.
    v = m.vertices[:, [0, 2, 1]]
    PECAS.append({
        "id": chave, "nome": titulo, "plano": plano,
        "sub": ("Plaquinha de 2,4 mm para colar no porta-canetas. Sai também "
                "com 90 mm de largura." if plano else
                "Letra de 30 mm com 16 mm de espessura, sobre rodapé de 5 × 28 mm."),
        "v": np.round(v, 2).ravel().tolist(),
        "f": m.faces.ravel().tolist(),
        "larg": round(float(m.extents[0]), 1),
        "prof": round(float(m.extents[1]), 1),
        "alt": round(float(m.extents[2]), 1),
        "g": round(m.volume / 1000 * DENS, 2 if plano else 1),
        "faces": int(len(m.faces)),
        # Os rótulos mudam com a peça: na de colar, o 2,4 mm é espessura e o outro
        # número é altura de letra. Rotular pelos eixos, igual para todas, trocava
        # os dois de lugar.
        "medidas": ([["Largura", f"{m.extents[0]:.0f} mm"],
                     ["Altura da letra", f"{m.extents[1]:.1f} mm"],
                     ["Espessura", f"{m.extents[2]:.1f} mm"]] if plano else
                    [["Largura", f"{m.extents[0]:.0f} mm"],
                     ["Espessura", f"{m.extents[1]:.0f} mm"],
                     ["Altura", f"{m.extents[2]:.1f} mm"]]),
        # peça deitada se lê de cima; peça em pé, de frente
        "phi": 0.52 if plano else 1.14,
        "theta": -1.57 if plano else -1.32,
    })
    print(f"{titulo:18s} {len(m.faces):5d} faces  {PECAS[-1]['larg']} x "
          f"{PECAS[-1]['prof']} x {PECAS[-1]['alt']} mm  {PECAS[-1]['g']} g")

PAGINA = r"""<title>Letras CREA-MT e Mútua</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
  :root {
    --ground: #F2EFEA;
    --panel: #FFFFFF;
    --line: #DFD8CE;
    --ink: #17191C;
    --ink-2: #55514C;
    --ink-3: #8A837B;
    --accent: #E8712B;
    --accent-ink: #FFFFFF;
    --stage-1: #E7E2DA;
    --stage-2: #D6CFC4;
    --pla: #EDEFEE;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground: #15171A;
      --panel: #1D2024;
      --line: #2E3339;
      --ink: #EDEAE5;
      --ink-2: #B3ADA5;
      --ink-3: #7E7871;
      --accent: #F08A46;
      --accent-ink: #1A1206;
      --stage-1: #23272C;
      --stage-2: #14171A;
      color-scheme: dark;
    }
  }
  :root[data-theme="dark"] {
    --ground: #15171A;
    --panel: #1D2024;
    --line: #2E3339;
    --ink: #EDEAE5;
    --ink-2: #B3ADA5;
    --ink-3: #7E7871;
    --accent: #F08A46;
    --accent-ink: #1A1206;
    --stage-1: #23272C;
    --stage-2: #14171A;
    color-scheme: dark;
  }

  html, body { height: 100%; }
  body {
    margin: 0;
    background: var(--ground);
    color: var(--ink);
    font-family: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-size: 14px;
    line-height: 1.55;
  }
  .app { display: grid; grid-template-columns: minmax(0, 1fr) 330px; height: 100%; }
  @media (max-width: 860px) {
    html, body { height: auto; }
    .app { grid-template-columns: 1fr; height: auto; }
    .stage { height: 64vh; min-height: 340px; }
  }

  .stage {
    position: relative;
    min-height: 0;
    background: radial-gradient(120% 90% at 50% 12%, var(--stage-1), var(--stage-2));
    touch-action: none;
    overflow: hidden;
  }
  .stage canvas { display: block; width: 100%; height: 100%; }
  .stage:focus-visible { outline: 3px solid var(--accent); outline-offset: -3px; }
  .dica {
    position: absolute; left: 16px; bottom: 14px;
    font-size: 12px; color: var(--ink-2);
    background: color-mix(in srgb, var(--panel) 80%, transparent);
    border: 1px solid var(--line); border-radius: 999px; padding: 5px 12px;
  }
  .medida {
    position: absolute; right: 16px; top: 16px;
    font-family: 'Archivo', system-ui, sans-serif;
    font-variant-numeric: tabular-nums;
    font-size: 12px; letter-spacing: .06em; text-transform: uppercase;
    color: var(--ink-2);
    background: color-mix(in srgb, var(--panel) 80%, transparent);
    border: 1px solid var(--line); border-radius: 6px; padding: 5px 10px;
  }

  .lado {
    border-left: 1px solid var(--line);
    background: var(--panel);
    padding-block: 22px;
    padding-inline: 22px;
    overflow-y: auto;
    display: flex; flex-direction: column; gap: 20px;
  }
  @media (max-width: 860px) { .lado { border-left: 0; border-top: 1px solid var(--line); } }

  .marca {
    font-family: 'Archivo', system-ui, sans-serif;
    font-size: 11px; font-weight: 600; letter-spacing: .16em;
    text-transform: uppercase; color: var(--accent);
  }
  h1 {
    font-family: 'Archivo', system-ui, sans-serif;
    font-size: 25px; font-weight: 700; line-height: 1.15;
    margin: 4px 0 0; text-wrap: balance;
  }
  .sub { color: var(--ink-2); margin: 6px 0 0; }

  .grupo { display: flex; flex-direction: column; gap: 8px; }
  .rotulo {
    font-family: 'Archivo', system-ui, sans-serif;
    font-size: 11px; font-weight: 600; letter-spacing: .12em;
    text-transform: uppercase; color: var(--ink-3);
  }
  .botoes { display: flex; gap: 8px; flex-wrap: wrap; }
  button {
    font: inherit; font-weight: 500;
    color: var(--ink); background: var(--panel);
    border: 1px solid var(--line); border-radius: 8px;
    padding: 8px 13px; cursor: pointer;
    transition: background .15s, border-color .15s, color .15s;
  }
  button:hover:not(:disabled) { border-color: var(--ink-3); }
  button:disabled { opacity: .42; cursor: default; }
  button:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  button[aria-pressed="true"] {
    background: var(--accent); border-color: var(--accent); color: var(--accent-ink);
  }

  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 7px 0; border-bottom: 1px solid var(--line); }
  th { font-weight: 500; color: var(--ink-2); }
  td { text-align: right; font-family: 'Archivo', system-ui, sans-serif; font-weight: 600; }
  tr:last-child th, tr:last-child td { border-bottom: 0; }

  .notas { display: flex; flex-direction: column; gap: 12px; margin: 0; padding: 0; }
  .nota { list-style: none; padding-left: 14px; border-left: 2px solid var(--line); }
  .nota strong { font-weight: 600; }
  .nota.destaque { border-left-color: var(--accent); }
  .rodape { color: var(--ink-3); font-size: 12px; margin-top: auto; padding-top: 8px; }
</style>

<div class="app">
  <div class="stage" id="palco" tabindex="0" aria-label="Modelo 3D. Arraste para girar.">
    <div class="medida" id="medida"></div>
    <div class="dica">arraste para girar · role para aproximar</div>
  </div>

  <aside class="lado">
    <div>
      <div class="marca">ABEE-MT · FMEES 2026</div>
      <h1 id="titulo">CREA-MT</h1>
      <p class="sub" id="sub"></p>
    </div>

    <div class="grupo">
      <div class="rotulo">Peça</div>
      <div class="botoes" id="pecas"></div>
    </div>

    <div class="grupo">
      <div class="rotulo">Posição <span id="pos-nota"></span></div>
      <div class="botoes">
        <button id="b-mesa" aria-pressed="true">Na mesa</button>
        <button id="b-imprime" aria-pressed="false">Como imprime</button>
      </div>
    </div>

    <div class="grupo">
      <div class="rotulo">Medidas</div>
      <table>
        <tbody id="tabela"></tbody>
      </table>
    </div>

    <ul class="notas">
      <li class="nota destaque"><strong>Imprime deitada</strong>, com a face da letra contra
        o vidro — e é assim que o arquivo já sai. Em pé, o braço de cima do E sairia 12 mm
        do tronco com nada embaixo. Nas peças de colar, a face contra o vidro é a que
        aparece; a de cima é a de colar.</li>
      <li class="nota"><strong>Ligadura de 2,4 mm</strong> prende o hífen do CREA-MT e o
        acento do mútua na letra vizinha. No logo eles não encostam em nada, e soltos
        sairiam da impressora como pecinhas avulsas.</li>
      <li class="nota"><strong>FMEES 2026</strong> fica gravado 0,7 mm na frente do rodapé,
        na mesma cor, lido por sombra.</li>
    </ul>

    <div class="grupo">
      <div class="botoes">
        <button id="b-gira" aria-pressed="true">Girar sozinho</button>
        <button id="b-reset">Enquadrar</button>
      </div>
    </div>

    <p class="rodape">Modelo carregado do mesmo arquivo que vai para a impressora.</p>
  </aside>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>
const PECAS = __DADOS__;
</script>
<script>
(function () {
  const palco = document.getElementById('palco');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  palco.appendChild(renderer.domElement);

  const cena = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 1, 4000);

  cena.add(new THREE.HemisphereLight(0xffffff, 0x9a938a, 0.62));
  // A frente das letras olha para -Z: a luz principal tem de vir de lá, senão a
  // face que interessa fica na sombra e a peça sai cinzenta.
  const sol = new THREE.DirectionalLight(0xffffff, 0.9);
  sol.position.set(-170, 290, -150);
  sol.castShadow = true;
  sol.shadow.mapSize.set(2048, 2048);
  const c = sol.shadow.camera;
  c.left = -190; c.right = 190; c.top = 190; c.bottom = -190; c.near = 1; c.far = 900;
  cena.add(sol);
  const contra = new THREE.DirectionalLight(0xdfe7f0, 0.32);
  contra.position.set(190, 110, 200);
  cena.add(contra);

  const chao = new THREE.Mesh(new THREE.PlaneGeometry(900, 900),
                              new THREE.ShadowMaterial({ opacity: 0.2 }));
  chao.rotation.x = -Math.PI / 2;
  chao.receiveShadow = true;
  cena.add(chao);
  const grade = new THREE.GridHelper(600, 30, 0xb9b0a4, 0xc9c2b7);
  grade.material.transparent = true;
  grade.material.opacity = 0.5;
  cena.add(grade);

  const pla = new THREE.MeshStandardMaterial({
    color: 0xedefee, roughness: 0.62, metalness: 0.02, flatShading: true
  });

  const grupo = new THREE.Group();
  cena.add(grupo);
  const malhas = {};
  for (const p of PECAS) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p.v, 3));
    g.setIndex(p.f);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, pla);
    m.castShadow = true;
    m.receiveShadow = true;
    m.visible = false;
    malhas[p.id] = m;
    grupo.add(m);
  }

  const estado = {
    peca: PECAS[0], deitada: false,
    theta: -1.32, phi: 1.14, dist: 430,
    gira: !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  };

  function assenta() {
    // Tomba o grupo para a posição de impressão e reapoia na grade: a peça deitada
    // é a mesma malha, virada, e não um segundo modelo embutido no arquivo.
    grupo.rotation.x = estado.deitada ? -Math.PI / 2 : 0;
    grupo.position.set(0, 0, 0);
    grupo.updateMatrixWorld(true);
    const caixa = new THREE.Box3().setFromObject(malhas[estado.peca.id]);
    grupo.position.y = -caixa.min.y;
    grupo.position.z = -(caixa.min.z + caixa.max.z) / 2;
    grupo.updateMatrixWorld(true);
    const nova = new THREE.Box3().setFromObject(malhas[estado.peca.id]);
    const tam = nova.getSize(new THREE.Vector3());
    estado.alvo = nova.getCenter(new THREE.Vector3());
    estado.raio = tam.length() / 2;      // esfera que envolve a peça
  }

  function enquadra() {
    // Enquadra pela esfera e pelo MENOR dos dois campos de visão. Só pela altura,
    // a peça de 194 mm vazava dos lados no celular, onde a tela é estreita.
    const vFov = camera.fov * Math.PI / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(camera.aspect, 0.25));
    estado.dist = estado.raio / Math.sin(Math.min(vFov, hFov) / 2) * 1.12;
  }

  function mostra(id) {
    estado.peca = PECAS.find(p => p.id === id);
    for (const p of PECAS) malhas[p.id].visible = (p.id === id);
    const p = estado.peca;
    document.getElementById('titulo').textContent = p.nome;
    document.getElementById('sub').textContent = p.sub + ' Branco, um filamento só.';
    // peça de colar já nasce deitada: não há duas posições para mostrar
    if (p.plano && estado.deitada) posicao(false);
    for (const b of [document.getElementById('b-mesa'), document.getElementById('b-imprime')])
      b.disabled = p.plano;
    document.getElementById('pos-nota').textContent = p.plano ? '· já imprime deitada' : '';
    document.getElementById('tabela').innerHTML =
      p.medidas.concat([['Massa maciça', String(p.g).replace('.', ',') + ' g'],
                        ['Triângulos', p.faces.toLocaleString('pt-BR')]])
      .map(([a, b]) => '<tr><th>' + a + '</th><td>' + b + '</td></tr>').join('');
    document.getElementById('medida').textContent =
      p.larg + ' × ' + p.prof + ' × ' + p.alt + ' mm';
    for (const b of document.querySelectorAll('#pecas button'))
      b.setAttribute('aria-pressed', String(b.dataset.id === id));
    estado.theta = p.theta;
    estado.phi = p.phi;
    assenta();
    enquadra();
  }

  const caixaPecas = document.getElementById('pecas');
  for (const p of PECAS) {
    const b = document.createElement('button');
    b.textContent = p.nome;
    b.dataset.id = p.id;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => mostra(p.id));
    caixaPecas.appendChild(b);
  }

  function posicao(deitada) {
    estado.deitada = deitada;
    document.getElementById('b-mesa').setAttribute('aria-pressed', String(!deitada));
    document.getElementById('b-imprime').setAttribute('aria-pressed', String(deitada));
    assenta();
    enquadra();
  }
  document.getElementById('b-mesa').addEventListener('click', () => posicao(false));
  document.getElementById('b-imprime').addEventListener('click', () => posicao(true));

  const bGira = document.getElementById('b-gira');
  bGira.setAttribute('aria-pressed', String(estado.gira));
  bGira.addEventListener('click', () => {
    estado.gira = !estado.gira;
    bGira.setAttribute('aria-pressed', String(estado.gira));
  });
  document.getElementById('b-reset').addEventListener('click', () => {
    estado.theta = estado.peca.theta; estado.phi = estado.peca.phi; enquadra();
  });

  let arrastando = false, ux = 0, uy = 0, pinca = 0;
  palco.addEventListener('pointerdown', e => {
    arrastando = true; ux = e.clientX; uy = e.clientY;
    estado.gira = false; bGira.setAttribute('aria-pressed', 'false');
    palco.setPointerCapture(e.pointerId);
  });
  palco.addEventListener('pointermove', e => {
    if (!arrastando) return;
    estado.theta -= (e.clientX - ux) * 0.008;
    estado.phi = Math.min(Math.PI - 0.12, Math.max(0.12, estado.phi - (e.clientY - uy) * 0.006));
    ux = e.clientX; uy = e.clientY;
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave'])
    palco.addEventListener(ev, () => { arrastando = false; });
  palco.addEventListener('wheel', e => {
    e.preventDefault();
    estado.dist = Math.min(1600, Math.max(90, estado.dist * (1 + Math.sign(e.deltaY) * 0.1)));
  }, { passive: false });
  palco.addEventListener('touchmove', e => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                         e.touches[0].clientY - e.touches[1].clientY);
    if (pinca) estado.dist = Math.min(1600, Math.max(90, estado.dist * pinca / d));
    pinca = d;
  }, { passive: false });
  palco.addEventListener('touchend', () => { pinca = 0; });
  palco.addEventListener('keydown', e => {
    const passo = 0.12;
    if (e.key === 'ArrowLeft') estado.theta += passo;
    else if (e.key === 'ArrowRight') estado.theta -= passo;
    else if (e.key === 'ArrowUp') estado.phi = Math.max(0.12, estado.phi - passo);
    else if (e.key === 'ArrowDown') estado.phi = Math.min(Math.PI - 0.12, estado.phi + passo);
    else return;
    e.preventDefault();
    estado.gira = false; bGira.setAttribute('aria-pressed', 'false');
  });

  function tamanho() {
    const l = palco.clientWidth || 1, a = palco.clientHeight || 1;
    renderer.setSize(l, a, false);
    camera.aspect = l / a;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', () => { tamanho(); enquadra(); });

  let antes = performance.now();
  function quadro(agora) {
    const dt = Math.min(0.05, (agora - antes) / 1000);
    antes = agora;
    if (estado.gira) estado.theta += dt * 0.22;
    const r = estado.dist;
    camera.position.set(
      estado.alvo.x + r * Math.sin(estado.phi) * Math.cos(estado.theta),
      estado.alvo.y + r * Math.cos(estado.phi),
      estado.alvo.z + r * Math.sin(estado.phi) * Math.sin(estado.theta));
    camera.lookAt(estado.alvo);
    renderer.render(cena, camera);
    requestAnimationFrame(quadro);
  }

  tamanho();
  mostra(PECAS[0].id);
  requestAnimationFrame(quadro);
})();
</script>
"""

saida = os.path.join(AQUI, "visualizador-letras.html")
open(saida, "w").write(PAGINA.replace("__DADOS__", json.dumps(PECAS, ensure_ascii=False)))
print(f"gravado {os.path.basename(saida)}  {os.path.getsize(saida) // 1024} KB")
