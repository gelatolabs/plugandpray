# Exports the textured props from character.blend for the web game:
# web/public/models/<object>.glb, one per object, each centred on its own
# origin (they're laid out side by side in the .blend; CRT_Base and CRT_Screen
# share theirs, so the screen still fits the opening). The GelatoStation is
# split into its loose parts, the body and the lid (which opens), both in one
# file (gelatostation.glb, the meshes GelatoStation_Body and _Lid) so they share
# their textures; the game splits them apart again (loadModels). Their Substance
# Painter textures (assets/textures/<material>_*.png) are wired into each
# material first (base colour, metallic, roughness, normal, AO), so the
# .glb files carry them, as WebP (much smaller than PNG; three.js reads them).
#
#   blender -b assets/character.blend --python assets/export_props.py
import os
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'web', 'public', 'models')
TEX = os.path.join(HERE, 'textures')
OBJECTS = ['CRT_Base', 'CRT_Screen', 'GelatoStation_Base', 'Gelatostation_Disc', 'Virtualto_Headset_Base']
# objects exported as their loose parts, lowest first: the files' names
SPLIT = {'GelatoStation_Base': ('gelatostation', ['GelatoStation_Body', 'GelatoStation_Lid'])}
WEBP = dict(export_image_format='WEBP', export_image_quality=85)


def image(name, colour):
    path = os.path.join(TEX, name)
    if not os.path.exists(path):
        return None
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    return img


def wire(mat):
    """Rebuilds mat's node tree as a Principled BSDF fed by its texture set."""
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    def tex(suffix, colour):
        img = image(f'{mat.name}_{suffix}.png', colour)
        if not img:
            return None
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = img
        return n

    if (t := tex('Base_color', True)):
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    if (t := tex('Metallic', False)):
        nt.links.new(t.outputs['Color'], bsdf.inputs['Metallic'])
    if (t := tex('Roughness', False)):
        nt.links.new(t.outputs['Color'], bsdf.inputs['Roughness'])
    if (t := tex('Normal_OpenGL', False)):
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(t.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if (t := tex('Mixed_AO', False)):
        # the glTF exporter takes ambient occlusion from a "glTF Material Output" group's Occlusion input
        group = bpy.data.node_groups.get('glTF Material Output')
        if not group:
            group = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
            group.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        g = nt.nodes.new('ShaderNodeGroup')
        g.node_tree = group
        nt.links.new(t.outputs['Color'], g.inputs['Occlusion'])


os.makedirs(OUT, exist_ok=True)
root = bpy.context.scene.collection
for name in OBJECTS:
    o = bpy.data.objects[name]
    for slot in o.material_slots:
        if slot.material:
            wire(slot.material)
    if o.name not in root.objects:
        root.objects.link(o)
    o.hide_set(False)
    o.hide_viewport = False


def export(objs, path):
    for other in bpy.context.view_layer.objects:
        other.select_set(other in objs)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_animations=False, export_cameras=False, export_lights=False, **WEBP)
    print('wrote', path)


def loose_parts(o):
    """Copies of o, one per loose part of its mesh, lowest first."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.verts.ensure_lookup_table()
    seen, comps = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, comp = [v], set()
        seen.add(v.index)
        while stack:
            a = stack.pop()
            comp.add(a.index)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b.index not in seen:
                    seen.add(b.index)
                    stack.append(b)
        comps.append(comp)
    comps.sort(key=lambda c: min(bm.verts[i].co.z for i in c))
    out = []
    for comp in comps:
        part = bm.copy()
        part.verts.ensure_lookup_table()
        bmesh.ops.delete(part, geom=[v for v in part.verts if v.index not in comp], context='VERTS')
        me = o.data.copy()
        part.to_mesh(me)
        copy = o.copy()
        copy.data = me
        root.objects.link(copy)
        out.append(copy)
    return out


for name in OBJECTS:
    o = bpy.data.objects[name]
    loc = o.location.copy()
    o.location = (0, 0, 0)
    if name in SPLIT:
        file, names = SPLIT[name]
        parts = loose_parts(o)
        for part, part_name in zip(parts, names):
            part.name = part.data.name = part_name
        export(parts, os.path.join(OUT, f'{file}.glb'))
    else:
        export([o], os.path.join(OUT, f'{name.lower()}.glb'))
    o.location = loc
