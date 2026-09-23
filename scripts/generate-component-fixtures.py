from pathlib import Path
import numpy as np
import OpenEXR
folder=Path('build/fixtures/shared-components');folder.mkdir(parents=True,exist_ok=True)
for frame in range(12):
    channels={name:np.tile(np.array(values,dtype=np.float16),(4,1)) for name,values in {
        'R':[-2,0,2,4], 'G':[10,20,30,40], 'B':[100,200,300,400], 'A':[.1,.3,.6,.9]}.items()}
    OpenEXR.File({'compression':OpenEXR.ZIP_COMPRESSION},channels).write(str(folder/f'colors_{frame:04d}.exr'))
