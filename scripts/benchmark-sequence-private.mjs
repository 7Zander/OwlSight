import path from 'node:path';
import {createDecoder} from '../src/exr/native.cjs';
import {unpackFrame} from '../src/exr/frame.mjs';
import {createLayerViews} from '../src/core/views.mjs';
import {describeView} from '../src/core/sequence.mjs';
import {discover} from '../src/app/sequence.cjs';
import {writeFile} from 'node:fs/promises';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
const file=process.env.OWLSIGHT_TEST_EXR;
if(!file) throw new Error('Set OWLSIGHT_TEST_EXR to an authorized local sample.');
const decoder=createDecoder(path.resolve('.'));
try {
 const sequence=await discover(file);
 const header=spawnSync(path.resolve('resources/decoder/owlsight-decoder.exe'),['-I','-B','-X','utf8','-c','import OpenEXR,json,sys; f=OpenEXR.File(sys.argv[1],separate_channels=True,header_only=True); print(json.dumps([dict(name=p.header.get("name",""), channels=sorted(c.name for c in p.header["channels"])) for p in f.parts]))',file],{encoding:'utf8',windowsHide:true});
 if(header.status!==0) throw new Error(header.stderr);
 const parts=JSON.parse(header.stdout), initial=describeView(parts,createLayerViews(parts)[0]);
 const first=await decoder.decode(file,initial);
 const frame=unpackFrame(first.bytes),views=createLayerViews(frame.sourceParts),descriptor=describeView(frame.sourceParts,views[0]);
 const records=[{decodeMs:Math.round(first.decodeMs),bytes:first.bytes.length}];
 for(const item of sequence.frames.slice(sequence.index+1,sequence.index+3)) {
   const result=await decoder.decode(item.path,descriptor);records.push({decodeMs:Math.round(result.decodeMs),bytes:result.bytes.length});
 }
 const report={cpu:os.cpus()[0].model,ramGiB:Math.round(os.totalmem()/1024**3),dimensions:[frame.sourceParts[0].width,frame.sourceParts[0].height],parts:frame.sourceParts.length,channels:frame.sourceParts.reduce((n,p)=>n+p.channels.length,0),sequenceFrames:sequence.frames.length,preview:[frame.parts[0].width,frame.parts[0].height],records,includesProcessStartup:true,sourceUploaded:false};
 await writeFile('build/verification/sequence-private-performance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {decoder.cancel();}
