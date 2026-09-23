// SPDX-License-Identifier: GPL-3.0-or-later
const fs = require('node:fs/promises');
const path = require('node:path');
// A frame is the final numeric field, never the earlier version field.
function frameName(name) {
  const match = /^(.*?)(\d+)(\.exr)$/i.exec(name);
  if (!match || /(?:^|[._-])v$/i.test(match[1])) return null;
  let prefix = match[1], field = match[2];
  if (/(?:^|[._-])-$/.test(prefix)) { prefix = prefix.slice(0, -1); field = '-' + field; }
  const number = Number(field);
  if (!Number.isSafeInteger(number)) return null;
  return { prefix, width: /^0\d/.test(match[2]) ? field.length : 0, fieldWidth: field.length, number, extension: match[3].toLowerCase() };
}
async function discover(file, current = () => true) {
  const pattern = frameName(path.basename(file));
  if (!pattern) return null;
  const candidates = [], start = performance.now(); let count = 0;
  for await (const entry of await fs.opendir(path.dirname(file))) {
    if (!current()) return null;
    if (++count > 100000 || performance.now() - start > 5000) throw new Error('目录过大或读取过慢，已停止自动识别序列；仍可查看单帧。');
    const item = frameName(entry.name);
    if (!entry.isFile() || !item || item.prefix !== pattern.prefix || item.extension !== pattern.extension) continue;
    candidates.push({ pattern: item, number: item.number, name: entry.name, path: path.join(path.dirname(file), entry.name) });
    if (candidates.length > 20000) throw new Error('序列超过 20000 帧，已停止自动识别；仍可查看单帧。');
  }
  // A padded sequence can cross 0999 -> 1000; infer that family when opening either side.
  // Existing shorter unpadded numbers take precedence for ambiguous mixed directories.
  const shortestUnpadded = candidates.reduce((n,f) => f.pattern.width ? n : Math.min(n,f.pattern.fieldWidth), Infinity);
  const width = pattern.width || (shortestUnpadded >= pattern.fieldWidth && candidates.some(f => f.pattern.width === pattern.fieldWidth) ? pattern.fieldWidth : 0);
  const frames = candidates.filter(f => width ? f.pattern.width === width || (!f.pattern.width && f.pattern.fieldWidth === width && shortestUnpadded >= width) : !f.pattern.width)
    .map(({pattern: _pattern, ...frame}) => frame);
  frames.sort((a,b) => a.number-b.number);
  if (frames.length < 2) return null;
  if (frames.some((f,i) => i && f.number === frames[i-1].number)) throw new Error('发现重复帧号，无法唯一识别序列。');
  const index = frames.findIndex(f => f.name === path.basename(file));
  if (index < 0) return null;
  const span = frames.at(-1).number - frames[0].number + 1;
  if (!Number.isSafeInteger(span)) throw new Error('帧号范围过大，无法安全播放。');
  const gaps = span - frames.length;
  return { frames, index, gaps };
}
// A folder opens the first numbered EXR family in natural filename order.
// Only its immediate children are scanned; existing discovery keeps families separate.
async function resolveOpenTarget(target,current=()=>true){
 if(typeof target!=='string'||target.length>32767||!path.isAbsolute(target))throw new Error('请拖入本地或网络盘上的 EXR 文件或文件夹。');
 const stat=await fs.stat(target);
 if(!current())throw new Error('旧文件读取已取消。');
 if(!stat.isDirectory())return {file:target,sequence:null};
 const files=[],start=performance.now();let count=0;
 for await(const entry of await fs.opendir(target)){
  if(!current())throw new Error('旧文件读取已取消。');
  if(++count>100000||performance.now()-start>5000)throw new Error('文件夹过大或读取过慢，请直接打开序列中的一帧。');
  if(entry.isFile()&&/\.exr$/i.test(entry.name))files.push(entry.name);
  if(files.length>20000)throw new Error('文件夹中的 EXR 超过 20000 个，请直接打开所需序列中的一帧。');
 }
 if(!files.length)throw new Error('此文件夹内没有 EXR 文件；请拖入直接包含序列帧的文件夹。');
 const collator=new Intl.Collator('en',{numeric:true,sensitivity:'base'});
 files.sort((a,b)=>collator.compare(a,b)||(a<b?-1:a>b?1:0));
 const first=files.find(name=>frameName(name))||files[0];
 const found=await discover(path.join(target,first),current);
 if(!current())throw new Error('旧文件读取已取消。');
 return {file:found?found.frames[0].path:path.join(target,first),sequence:found?{...found,index:0}:null};
}
module.exports = { frameName, discover, resolveOpenTarget };
