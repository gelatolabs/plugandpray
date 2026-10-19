# Turns the 3D artist's textured FBX (assets/models/<name>.fbx)
# and its Substance Painter texture set (assets/textures/<name>/<material>_*.png)
# into the web game's model: web/public/models/<name>.glb. Each material gets
# its base colour, metallic, roughness, normal (OpenGL) and AO maps; a mesh
# with no material takes the first one (the texture set covers it).
#
#   blender -b --factory-startup --python assets/import_fbx.py -- gelatoboy
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
name = sys.argv[sys.argv.index('--') + 1]
FBX = os.path.join(HERE, 'models', name + '.fbx')
TEX = os.path.join(HERE, 'textures', name)
OUT = os.path.join(HERE, '..', 'web', 'public', 'models', name + '.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=FBX)
for o in list(bpy.data.objects):
    if o.type in ('CAMERA', 'LIGHT'):
        bpy.data.objects.remove(o)


def image(file, colour):
    path = os.path.join(TEX, file)
    if not os.path.exists(path):
        return None
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    return img


def wire(mat):
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
    # (glTF packs metallic and roughness into one image: the exporter does it from these two)
    if (t := tex('Metallic', False)):
        nt.links.new(t.outputs['Color'], bsdf.inputs['Metallic'])
    if (t := tex('Roughness', False)):
        nt.links.new(t.outputs['Color'], bsdf.inputs['Roughness'])
    if (t := tex('Normal_OpenGL', False)):
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(t.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if (t := tex('Mixed_AO', False)):
        group = bpy.data.node_groups.get('glTF Material Output') or bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        if 'Occlusion' not in [s.name for s in group.interface.items_tree]:
            group.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        g = nt.nodes.new('ShaderNodeGroup')
        g.node_tree = group
        nt.links.new(t.outputs['Color'], g.inputs['Occlusion'])


# Models merged into one mesh whose parts the game needs by name (the zapper's
# muzzle glows): split into their loose parts, each named by a test on its
# bounds (Blender axes, metres), the rest keeping the mesh's name.
PARTS = {
    'zapper': {'Muzzle': lambda lo, hi: lo.y < -0.1, 'Trigger': lambda lo, hi: hi.x - lo.x < 0.01},
}
if name in PARTS:
    from mathutils import Vector
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.separate(type='LOOSE')
        bpy.ops.object.mode_set(mode='OBJECT')
        base = o.name
        for p in list(bpy.context.selected_objects):
            vs = [p.matrix_world @ v.co for v in p.data.vertices]
            lo = Vector([min(v[i] for v in vs) for i in range(3)])
            hi = Vector([max(v[i] for v in vs) for i in range(3)])
            for part, test in PARTS[name].items():
                if test(lo, hi):
                    p.name = p.data.name = part
                    break
            else:
                p.name = p.data.name = base

# The GelatoBoy's link port: the game draws the port itself (its shaped dark
# face and glowing frame, web/src/cables.js), so the model's rectangular hole
# there is closed up flush with the side. (Blender axes, metres: the right
# side is x = 45 mm, the port's middle 44 mm up.)
if name == 'gelatoboy':
    import bmesh
    o = bpy.data.objects['GelatoBoy']
    bm = bmesh.new()
    bm.from_mesh(o.data)
    def near_port(v, pad=0.0018):
        return v.co.x > 0.039 and abs(v.co.y) < 0.003 + pad and abs(v.co.z - 0.044) < 0.006 + pad
    hole = [f for f in bm.faces if all(near_port(v) for v in f.verts)]
    bmesh.ops.delete(bm, geom=hole, context='FACES')
    rim = [e for e in bm.edges if e.is_boundary and all(near_port(v, 0.003) for v in e.verts)]
    for v in {v for e in rim for v in e.verts}:
        v.co.x = 0.045   # (onto the side, in case the rim's bevel left it short)
    bmesh.ops.triangle_fill(bm, edges=rim, use_beauty=True)
    bm.normal_update()
    bm.to_mesh(o.data)
    bm.free()
    print('closed the link port hole:', len(hole), 'faces')

mats = [m for m in bpy.data.materials if m.users]
for m in mats:
    wire(m)
first = next((m for m in mats if m.name == 'Material'), mats[0])
for o in bpy.data.objects:
    if o.type == 'MESH' and not o.data.materials:
        o.data.materials.append(first)
for o in bpy.data.objects:
    if o.name in bpy.context.view_layer.objects:
        o.select_set(o.type in ('MESH', 'EMPTY'))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True,
                          export_animations=False, export_cameras=False, export_lights=False,
                          export_image_format='WEBP', export_image_quality=85)   # (WebP: much smaller than PNG)
print('wrote', OUT)
