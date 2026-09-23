// SPDX-License-Identifier: GPL-3.0-or-later
import { mkdir, writeFile } from 'node:fs/promises';
import { init, encodeExr } from 'exrs';
import { writeFixture } from '../tests/fixtures/write-exr.mjs';
await mkdir('build/fixtures',{recursive:true}); await mkdir('resources',{recursive:true});
const width=640, height=400;
const names=['Combined.R','Combined.G','Combined.B','Combined.A','Diffuse.R','Diffuse.G','Diffuse.B','Specular.R','Specular.G','Specular.B','Normal.X','Normal.Y','Normal.Z','Depth.Z','Object.ID'];
const planes = Object.fromEntries(names.map(name=>[name,new Float32Array(width*height)]));
const spheres=[{x:-.7,y:.05,r:.6,color:[.16,.45,.62],id:1},{x:.45,y:.02,r:.48,color:[.66,.24,.105],id:2},{x:1.14,y:.22,r:.25,color:[.47,.62,.22],id:3}];
for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
  const u=(x/width-.5)*3.4, v=(y/height-.5)*2.1;
  let n=[0,0,1], depth=8, id=0, alpha=0, diffuse=[.014,.019,.026], spec=[0,0,0];
  for(const s of spheres) {
    const dx=(u-s.x)/s.r, dy=(v-s.y)/s.r, d=dx*dx+dy*dy;
    if(d>1) continue;
    n=[dx,-dy,Math.sqrt(1-d)]; depth=4-n[2]*s.r; id=s.id; alpha=1;
    const light=Math.max(0,(-.45*n[0]+.65*n[1]+.7*n[2])/1.06);
    const highlight=Math.pow(Math.max(0,-.2*n[0]+.3*n[1]+.9327*n[2]),65)*3;
    diffuse=s.color.map(c=>c*(.065+.92*light)); spec=[highlight,highlight,highlight];
    break;
  }
  const p=y*width+x;
  ['R','G','B'].forEach((c,i)=>{planes['Combined.'+c][p]=diffuse[i]+spec[i];planes['Diffuse.'+c][p]=diffuse[i];planes['Specular.'+c][p]=spec[i];});
  planes['Combined.A'][p]=alpha; ['X','Y','Z'].forEach((c,i)=>planes['Normal.'+c][p]=n[i]); planes['Depth.Z'][p]=depth; planes['Object.ID'][p]=id;
}
await init();
const channelNames=Object.keys(planes).sort(), interleaved=new Float32Array(width*height*channelNames.length);
for(let i=0;i<width*height;i++) channelNames.forEach((name,c)=>interleaved[i*channelNames.length+c]=planes[name][i]);
const demo=encodeExr({width,height,layers:[{channelNames,interleavedPixels:interleaved,precision:'f32',compression:'zip16'}]});
await writeFile('resources/demo.exr',demo);
await writeFile('build/fixtures/多通道 样例.exr',demo);
await writeFile('build/fixtures/known-origin.exr',writeFixture({width:2,height:2,origin:[-3,7],channels:{R:[1,0,0,2],G:[0,1,0,.25],B:[0,0,1,.5],A:[0,.5,1,1],Z:[10,20,30,40]}}));
await writeFile('build/fixtures/broken.exr',Buffer.from('This is not EXR'));
console.log(`Generated demo: ${width}x${height}, ${channelNames.length} channels, ${demo.length} bytes`);
