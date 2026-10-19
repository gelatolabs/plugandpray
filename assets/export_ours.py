# Exports one of the team's models (assets/models/<file>.blend)
# for the web game: web/public/models/<name>.glb, everything visible in the
# file, modifiers applied, origins and sizes as they are (Blender -Y, the
# front, becomes glTF +z). The game adds anything it draws itself (labels,
# logos) on top, so no images go in the file.
#
#   blender -b assets/models/stand.blend --python assets/export_ours.py -- display_stand
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
name = sys.argv[sys.argv.index('--') + 1]
OUT = os.path.join(HERE, '..', 'web', 'public', 'models', name + '.glb')

# (meshes, and the empties that hold them together: a root can be either)
for o in bpy.context.view_layer.objects:
    o.select_set(o.type in ('MESH', 'EMPTY') and (o.visible_get() or o.type == 'EMPTY'))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True,
                          export_image_format='NONE', export_animations=False, export_cameras=False, export_lights=False)
print('wrote', OUT)
