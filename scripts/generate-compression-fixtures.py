# SPDX-License-Identifier: GPL-3.0-or-later
from pathlib import Path
import json
import OpenEXR
import numpy as np

out = Path('build/fixtures/compression')
out.mkdir(parents=True, exist_ok=True)
y, x = np.mgrid[:64, :64]
channels = {
    'R': (x / 32).astype('float16'),
    'G': (y / 64).astype('float16'),
    'B': ((x + y) / 128).astype('float16'),
    'A': np.ones((64, 64), dtype='float16'),
    'Z': (x + y * 64 + .25).astype('float32'),
    'ID': (x + y * 64).astype('uint32'),
}
codecs = ['NO', 'RLE', 'ZIPS', 'ZIP', 'PIZ', 'PXR24', 'B44', 'B44A', 'DWAA', 'DWAB', 'HTJ2K32', 'HTJ2K256']
for name in codecs:
    header = dict(type=OpenEXR.scanlineimage, compression=getattr(OpenEXR, name + '_COMPRESSION'))
    with OpenEXR.File(header, {k:v.copy() for k,v in channels.items()}) as f:
        f.write(str(out / (name + '.exr')))
tiles = OpenEXR.TileDescription()
tiles.xSize = tiles.ySize = 16
with OpenEXR.File(dict(type=OpenEXR.tiledimage, compression=OpenEXR.ZIP_COMPRESSION, tiles=tiles), {k:v.copy() for k,v in channels.items()}) as f:
    f.write(str(out / 'TILED.exr'))
(out / 'metadata.json').write_text(json.dumps(dict(OpenEXR=OpenEXR.__version__, numpy=np.__version__, codecs=codecs)), encoding='utf-8')
print('Created 12 compression fixtures + tiled ZIP; Half RGB, Float Z, UINT ID.')
