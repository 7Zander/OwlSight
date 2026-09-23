# SPDX-License-Identifier: GPL-3.0-or-later
import bpy, pathlib, json
out=pathlib.Path(__file__).resolve().parent.parent/'build'/'fixtures'
out.mkdir(parents=True,exist_ok=True)
scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.samples=4
scene.render.resolution_x=128
scene.render.resolution_y=128
scene.render.resolution_percentage=100
scene.render.image_settings.media_type='MULTI_LAYER_IMAGE'
scene.render.image_settings.file_format='OPEN_EXR_MULTILAYER'
scene.render.image_settings.color_depth='32'
layer=scene.view_layers[0]
for name in ['use_pass_z','use_pass_normal','use_pass_diffuse_color','use_pass_diffuse_direct','use_pass_glossy_direct']:
    if hasattr(layer,name): setattr(layer,name,True)
scene.render.image_settings.exr_codec='ZIP'
scene.render.filepath=str(out/'blender-zip.exr')
bpy.ops.render.render(write_still=True)
for codec in ['PIZ','DWAA','DWAB']:
    scene.render.image_settings.exr_codec=codec
    bpy.data.images['Render Result'].save_render(str(out/('blender-'+codec.lower()+'.exr')),scene=scene)
(out/'blender-metadata.json').write_text(json.dumps({'blender':bpy.app.version_string,'engine':'CYCLES','samples':4,'resolution':[128,128],'source':'factory startup cube scene','colorDepth':'32','format':'OPEN_EXR_MULTILAYER'},indent=2),encoding='utf-8')


