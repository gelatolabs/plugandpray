# Exports the "Signsign" character from character.blend for the
# web game (web/public/models/signsign.glb): the mesh, its skeleton in the
# rest pose (the T-pose) and its texture. web/src/guy.js poses it from code,
# like gfx_guy does on the GelatoStation.
#
#   blender -b assets/character.blend --python assets/export_signsign_glb.py
import os
import bpy

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web', 'public', 'models', 'signsign.glb')
MESH, ARM = 'PS2_Signsign_Char', 'Armature_Signsign_Char'

os.makedirs(os.path.dirname(OUT), exist_ok=True)
arm = bpy.data.objects[ARM]
arm.data.pose_position = 'REST'
# they may sit in a collection that isn't in the view layer: link them to the scene's own
root = bpy.context.scene.collection
for name in (MESH, ARM):
    o = bpy.data.objects[name]
    if o.name not in root.objects:
        root.objects.link(o)
    o.hide_set(False)
    o.hide_viewport = False
for o in bpy.context.view_layer.objects:
    o.select_set(o.name in (MESH, ARM))
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=False,
                          export_cameras=False, export_lights=False)
print('wrote', OUT)
