from pathlib import Path
import OpenEXR,numpy as np
import argparse
parser=argparse.ArgumentParser()
parser.add_argument('--width',type=int,default=64)
parser.add_argument('--height',type=int,default=48)
parser.add_argument('--frames',type=int,default=48)
parser.add_argument('--output',default='build/fixtures/layer-switch')
args=parser.parse_args()
root=Path(args.output);root.mkdir(parents=True,exist_ok=True)
for frame in range(args.frames):
 parts=[]
 for name,axis in [('beauty',0),('diffuse',1),('specular',2)]:
  parts.append(OpenEXR.Part({'name':name,'compression':OpenEXR.ZIP_COMPRESSION},{c:np.full((args.height,args.width),(.3+.6*frame/max(1,args.frames-1)) if i==axis else 0,dtype='float16') for i,c in enumerate('RGB')}))
 OpenEXR.File(parts).write(str(root/f'switch_{frame:04}.exr'))
