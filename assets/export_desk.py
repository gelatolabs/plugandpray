# Exports the desk from assets/desk.blend to web/public/models/desk.glb.
#
#   blender -b assets/desk.blend --python assets/export_desk.py
#
# The game fits it to the desk's footprint (scene.js buildDesk), so its size
# and position in the .blend don't matter.
import os
import bpy

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web', 'public', 'models', 'desk.glb')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=False, export_apply=True,
                          export_cameras=False, export_lights=False, export_animations=False)
print('wrote', OUT)
