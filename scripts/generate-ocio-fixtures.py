# SPDX-License-Identifier: GPL-3.0-or-later
from pathlib import Path
import numpy as np
import OpenEXR, json
root=Path('build/fixtures/ocio');root.mkdir(parents=True,exist_ok=True);(root/'luts').mkdir(exist_ok=True)
samples=[[-.1,0,.18],[.01,.04,.1],[.18,.18,.18],[.25,.5,.75],[1,1,1],[2,4,8],[16,.5,0],[.5,.1,.8]]
image=np.tile(np.array(samples,dtype=np.float32)[None,:,:],(2,1,1))
with OpenEXR.File({'compression':OpenEXR.ZIP_COMPRESSION},{'R':image[:,:,0].copy(),'G':image[:,:,1].copy(),'B':image[:,:,2].copy(),'Z':np.full((2,8),.25,dtype=np.float32)}) as f:f.write(str(root/'colors.exr'))
(root/'samples.json').write_text(json.dumps(samples))
(root/'luts/test.spi1d').write_text('Version 1\nFrom 0.0 4.0\nLength 17\nComponents 1\n{\n'+'\n'.join(str((i/16)**.8) for i in range(17))+'\n}\n')
(root/'luts/test.cube').write_text('LUT_3D_SIZE 3\n'+'\n'.join(f'{r*.4} {g*.3} {b*.2}' for b in range(3) for g in range(3) for r in range(3))+'\n')
(root/'test.ocio').write_text("""ocio_profile_version: 2
search_path: luts
roles:
  scene_linear: Linear
  default: Linear
displays:
  Test:
    - !<View> {name: LUT, colorspace: Output}
    - !<View> {name: Direct, colorspace: Linear}
    - !<View> {name: Missing LUT, colorspace: Missing}
active_displays: [Test]
active_views: [LUT, Direct, Missing LUT]
looks:
  - !<Look>
    name: Warm
    process_space: Linear
    transform: !<MatrixTransform> {matrix: [0.8, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1.2, 0, 0, 0, 0, 1]}
colorspaces:
  - !<ColorSpace> {name: Linear, bitdepth: 32f, isdata: false, allocation: uniform}
  - !<ColorSpace>
    name: Encoded
    bitdepth: 32f
    isdata: false
    to_scene_reference: !<ExponentTransform> {value: [2.2, 2.2, 2.2, 1]}
  - !<ColorSpace>
    name: Output
    bitdepth: 32f
    isdata: false
    from_scene_reference: !<GroupTransform>
      children:
        - !<FileTransform> {src: test.spi1d, interpolation: linear}
        - !<FileTransform> {src: test.cube, interpolation: tetrahedral}
  - !<ColorSpace>
    name: Missing
    bitdepth: 32f
    isdata: false
    from_scene_reference: !<FileTransform> {src: absent.cube}
  - !<ColorSpace> {name: Raw, isdata: true}
""",encoding='utf-8')
(root/'missing-lut.ocio').write_text((root/'test.ocio').read_text(encoding='utf-8').replace('active_views: [LUT, Direct, Missing LUT]','active_views: [Missing LUT]'),encoding='utf-8')
(root/'bad.ocio').write_text('broken: [',encoding='utf-8')
print(root)
