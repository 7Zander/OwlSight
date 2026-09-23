# SPDX-License-Identifier: GPL-3.0-or-later
from pathlib import Path
import OpenEXR
import numpy as np
out = Path('build/fixtures/boundaries')
out.mkdir(parents=True, exist_ok=True)
for count in (1, 4, 17, 64, 256):
    channels = {f'C{i:03}': np.full((32, 32), i / 256, dtype='float16') for i in range(count)}
    with OpenEXR.File(dict(compression=OpenEXR.ZIP_COMPRESSION), channels) as f:
        f.write(str(out / f'channels-{count}.exr'))
# Real, highly compressed 1 GiB float32 output, without any private content.
channels = {f'C{i:03}': np.full((1024, 1024), i / 256, dtype='float16') for i in range(256)}
with OpenEXR.File(dict(compression=OpenEXR.ZIP_COMPRESSION), channels) as f:
    f.write(str(out / 'at-budget.exr'))
print('Generated 1/4/17/64/256-channel files and real 1024 MiB boundary fixture.')
