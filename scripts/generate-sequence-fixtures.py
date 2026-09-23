# SPDX-License-Identifier: GPL-3.0-or-later
from pathlib import Path
import OpenEXR
import numpy as np
root = Path('build/fixtures/sequence')
root.mkdir(parents=True, exist_ok=True)
# Distinct uniform RGB frames: easy to verify via real GPU readback.
for number in [1,2,3,5,6,7,8,9]:
    colors = ([1.,0.,0.], [0.,1.,0.], [0.,0.,1.])[(number-1)%3]
    pixels = {name: np.full((48,64), colors[i] if i < 3 else .5, dtype='float16') for i,name in enumerate(['R','G','B','A'])}
    OpenEXR.File({'compression': OpenEXR.DWAA_COMPRESSION}, pixels).write(str(root/f'shot_v01_{number:04}.exr'))
OpenEXR.File({'compression':OpenEXR.ZIP_COMPRESSION}, pixels).write(str(root/'shot_v02_0001.exr'))
# Part order changes across frames; the data layer must remain selected by name.
for number in [1,2]:
    beauty = OpenEXR.Part({'name':'beauty'}, {c: np.full((40,40),0.25,dtype='float32') for c in 'RGB'})
    data = OpenEXR.Part({'name':'data'}, {'Z':np.full((40,40),number/2,dtype='float32')})
    OpenEXR.File([beauty,data] if number == 1 else [data,beauty]).write(str(root/f'parts_{number:04}.exr'))
# Real 4K frame: preview output must remain bounded regardless of source dimensions.
large = np.full((2160,3840), .25, dtype='float16')
OpenEXR.File({'compression':OpenEXR.DWAB_COMPRESSION}, {c:large for c in 'RGB'}).write(str(root/'large_0001.exr'))
# Explicitly missing channels should fail, rather than silently show a different layer.
OpenEXR.File({}, {'Y':np.ones((48,64),dtype='float32')}).write(str(root/'missing_0001.exr'))
print('Generated sequence fixtures (gaps, versions, multipart order, 4K DWAB, missing channels).')
