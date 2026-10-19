# Exports the team's cartridge (assets/models/cartridge.blend)
# for the web game: web/public/models/cartridge.glb, modifiers applied, its
# middle at the origin and its front (Blender -Y) towards glTF +z. The game
# puts each game's label on the faces using the "Label" material and draws
# the GelatoBoy logo on the "Logo plate", so no images go in the file.
#
#   blender -b assets/models/cartridge.blend --python assets/export_cartridge.py
# (the other props: assets/export_ours.py)
import os

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'web', 'public', 'models', 'cartridge.glb')

obj = bpy.data.objects['Cartridge']
for o in bpy.context.view_layer.objects:
    o.select_set(o == obj)
bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True,
                          export_image_format='NONE', export_animations=False, export_cameras=False, export_lights=False)
print('wrote', OUT)
