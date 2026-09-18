"""Escrita de 3MF com cada peça já atribuída a um filamento do Bambu Studio.

Por que não basta a seção `basematerials` do núcleo da especificação 3MF:
o importador do Bambu Studio (src/libslic3r/Format/bbs_3mf.cpp) não tem
nenhum tratamento para ela. Ele lê cor de `<m:colorgroup>` (extensão de
materiais, prefixo literal "m:", porque o parser não resolve namespaces) e,
de forma direta e sem depender de janela nenhuma, lê a atribuição de
filamento de `Metadata/model_settings.config`:

    <object id="{id da montagem}">
      <metadata key="extruder" value="1"/>
      <part id="{id da malha}" subtype="normal_part">
        <metadata key="extruder" value="2"/>
      </part>
    </object>

Gravamos os dois: o colorgroup para outros programas e visualizadores
entenderem as cores, e o model_settings.config para o Studio abrir cada peça
no filamento certo.

Dois detalhes do importador que mudam o que precisa ser gravado:

1. Objeto com uma única peça tem o `extruder` da peça apagado e usa o do
   objeto. Por isso o slot vai nos dois níveis.
2. No fim do carregamento, peça cujo slot é maior que o número de filamentos
   do projeto aberto volta para o filamento 1, sem aviso. Ou seja: um projeto
   com um filamento só abre este arquivo todo de uma cor, por mais correto que
   o arquivo esteja. O projeto precisa ter tantos filamentos quantos slots
   a paleta usar.

As malhas recebidas já devem estar com Z para cima e na posição final: os
deslocamentos são embutidos nos vértices, e nem componente nem item levam
matriz de transformação.
"""
import zipfile
from xml.sax.saxutils import escape

import numpy as np

CORE_NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
MATERIAL_NS = "http://schemas.microsoft.com/3dmanufacturing/material/2015/02"
COLOR_GROUP_ID = 1

CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
    '</Types>')
RELS = ('<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Target="/3D/3dmodel.model" Id="rel0" '
        'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
        '</Relationships>')


def place_in_rows(objects, rows, gap=12.0):
    """Arruma os objetos em fileiras compactas, centradas na origem.

    Sem isso, as peças espalhadas em X ocupam uma faixa larga da mesa, e nas
    impressoras de dois bicos (H2C, H2D) a peça mais à esquerda cai na "Left
    nozzle only area" — a faixa que só o bico esquerdo alcança, onde não dá
    para fazer multicor. Deslocamento embutido nos vértices: cada objeto fica
    centrado na sua fileira e apoiado em z = 0.

    rows -- lista de listas de nomes de objeto, uma por fileira.
    """
    by_name = dict(objects)
    assert {n for r in rows for n in r} == set(by_name), "fileiras não cobrem os objetos"

    def bounds(name):
        v = np.vstack([m.vertices for _, m in by_name[name]])
        return v.min(0), v.max(0)

    dims = {n: (b[1] - b[0]) for r in rows for n in r for b in [bounds(n)]}
    depths = [max(dims[n][1] for n in r) for r in rows]
    total_depth = sum(depths) + gap * (len(rows) - 1)

    y = total_depth / 2
    for row, depth in zip(rows, depths):
        widths = [dims[n][0] for n in row]
        x = -(sum(widths) + gap * (len(row) - 1)) / 2
        for name, w in zip(row, widths):
            lo, hi = bounds(name)
            shift = [x - lo[0], y - depth / 2 - (lo[1] + hi[1]) / 2, -lo[2]]
            for _, m in by_name[name]:
                m.apply_translation(shift)
            x += w + gap
        y -= depth + gap
    return objects


def _clean(mesh, precision):
    """Solda vértices coincidentes e joga fora faces de área zero.

    Booleanos e cantos arredondados deixam algumas faces degeneradas. Fatiador
    costuma consertar em silêncio, mas gravar limpo é mais barato que contar
    com o conserto."""
    def limpa(x, **kw):
        y = x.copy()
        y.merge_vertices(**kw)
        y.update_faces(y.nondegenerate_faces())
        y.update_faces(y.unique_faces())
        y.remove_unreferenced_vertices()
        return y

    # Arredonda para a precisão que vai ser gravada ANTES de limpar. É o
    # arredondamento da gravação que alinha um sliver quase colinear e o
    # transforma em face de área zero, então limpar antes dele não resolve.
    m = mesh.copy()
    m.vertices = np.round(m.vertices, precision)
    m = limpa(m)
    if not m.is_watertight or (m.area_faces < 1e-9).any():
        # Sobram slivers colineares: dois vértices a poucos milésimos um do outro
        # numa aresta reta, que nenhuma tolerância de altura remove. Solda num grid
        # de 0,01 mm, bem abaixo da resolução de impressão — e só aceita o resultado
        # se a peça continuar fechada e sem face de área zero.
        s = limpa(m, digits_vertex=2)
        if s.is_watertight and not (s.area_faces < 1e-9).any():
            return s
    assert m.is_watertight, "malha deixou de ser fechada na limpeza"
    return m


def clean_mesh(mesh, precision=3):
    """Mesma limpeza que as malhas gravadas no 3MF recebem, para uso nos STL.

    Um `merge_vertices()` solto depois de um booleano solda vértices que o
    booleano deixou a poucos milésimos um do outro e abre a malha — foi o que
    aconteceu com o STL fundido do PowerStack, no ponto do rodapé. Aqui a ordem
    é a que funciona: arredondar, soldar, jogar fora face degenerada, e só
    aceitar o resultado se a peça continuar fechada.
    """
    erro = None
    for p in (precision, precision + 1, precision + 2):
        try:
            return _clean(mesh, p)
        except AssertionError as e:      # sobe uma casa: malha fundida de peças que se
            erro = e                     # interpenetram tem sliver mais fino que 3 casas
    raise AssertionError(f"não fechou nem com {precision + 2} casas: {erro}")


def _mesh_xml(obj_id, name, mesh, pindex, precision):
    mesh = _clean(mesh, precision)
    v = "".join(f'<vertex x="{x:.{precision}f}" y="{y:.{precision}f}" z="{z:.{precision}f}"/>'
                for x, y, z in mesh.vertices)
    t = "".join(f'<triangle v1="{a}" v2="{b}" v3="{c}" p1="{pindex}"/>'
                for a, b, c in mesh.faces)
    return (f'<object id="{obj_id}" name="{escape(name)}" type="model" '
            f'pid="{COLOR_GROUP_ID}" pindex="{pindex}">'
            f'<mesh><vertices>{v}</vertices><triangles>{t}</triangles></mesh>'
            f'</object>')


def write_3mf(path, title, objects, palette, precision=3):
    """Grava um 3MF em `path`.

    objects -- lista de (nome do objeto, [(chave de cor, malha), ...]).
               Cada objeto vira um objeto do Studio com uma peça por cor.
    palette -- lista de (chave de cor, nome do filamento, "#RRGGBB").
               A ordem define o slot: o primeiro item é o filamento 1.
    """
    slot = {key: i + 1 for i, (key, _, _) in enumerate(palette)}
    used = {color for _, parts in objects for color, _ in parts}
    desconhecidas = used - set(slot)
    assert not desconhecidas, f"cores fora da paleta: {sorted(desconhecidas)}"

    colorgroup = (f'<m:colorgroup id="{COLOR_GROUP_ID}">'
                  + "".join(f'<m:color color="{hexc}"/>' for _, _, hexc in palette)
                  + '</m:colorgroup>')

    meshes, assemblies, items, config = "", "", "", ""
    next_id = COLOR_GROUP_ID + 1
    for obj_name, parts in objects:
        part_ids = []
        for color, mesh in parts:
            meshes += _mesh_xml(next_id, f"{obj_name}__{color}", mesh,
                                slot[color] - 1, precision)
            part_ids.append((next_id, color))
            next_id += 1
        comps = "".join(f'<component objectid="{i}"/>' for i, _ in part_ids)
        assemblies += (f'<object id="{next_id}" name="{escape(obj_name)}" type="model">'
                       f'<components>{comps}</components></object>')
        items += f'<item objectid="{next_id}"/>'
        # o slot do objeto é o da primeira peça; as demais peças sobrescrevem
        config += (f'  <object id="{next_id}">\n'
                   f'    <metadata key="name" value="{escape(obj_name)}"/>\n'
                   f'    <metadata key="extruder" value="{slot[part_ids[0][1]]}"/>\n')
        for i, color in part_ids:
            config += (f'    <part id="{i}" subtype="normal_part">\n'
                       f'      <metadata key="name" value="{escape(obj_name)}__{escape(color)}"/>\n'
                       f'      <metadata key="extruder" value="{slot[color]}"/>\n'
                       f'    </part>\n')
        config += '  </object>\n'
        next_id += 1

    model_xml = ('<?xml version="1.0" encoding="UTF-8"?>'
                 f'<model unit="millimeter" xml:lang="en-US" xmlns="{CORE_NS}" '
                 f'xmlns:m="{MATERIAL_NS}">'
                 f'<metadata name="Title">{escape(title)}</metadata>'
                 f'<resources>{colorgroup}{meshes}{assemblies}</resources>'
                 f'<build>{items}</build></model>')
    model_settings = ('<?xml version="1.0" encoding="UTF-8"?>\n'
                      f'<config>\n{config}</config>\n')

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", CONTENT_TYPES)
        zf.writestr("_rels/.rels", RELS)
        zf.writestr("3D/3dmodel.model", model_xml)
        zf.writestr("Metadata/model_settings.config", model_settings)
    return slot
