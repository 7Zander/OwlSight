// SPDX-License-Identifier: GPL-3.0-or-later
// Minimal uncompressed scanline writer for independent decoder fixtures.
// Layout reference: https://openexr.com/en/latest/OpenEXRFileLayout.html
const cstring = value => Buffer.from(value + '\0');
const i32 = value => { const b = Buffer.alloc(4); b.writeInt32LE(value); return b; };
const f32 = value => { const b = Buffer.alloc(4); b.writeFloatLE(value); return b; };
function attr(name, type, bytes) { return Buffer.concat([cstring(name),cstring(type),i32(bytes.length),bytes]); }
export function writeFixture({ width, height, channels, origin = [0,0] }) {
  const names = Object.keys(channels).sort();
  const box = Buffer.concat([i32(origin[0]),i32(origin[1]),i32(origin[0]+width-1),i32(origin[1]+height-1)]);
  const channelList = Buffer.concat([...names.map(name => Buffer.concat([cstring(name),i32(2),i32(0),i32(1),i32(1)])),Buffer.from([0])]);
  const header = Buffer.concat([i32(20000630),i32(2),attr('channels','chlist',channelList),attr('compression','compression',Buffer.from([0])),attr('dataWindow','box2i',box),attr('displayWindow','box2i',box),attr('lineOrder','lineOrder',Buffer.from([0])),attr('pixelAspectRatio','float',f32(1)),attr('screenWindowCenter','v2f',Buffer.alloc(8)),attr('screenWindowWidth','float',f32(1)),Buffer.from([0])]);
  const offsets = Buffer.alloc(height*8), blocks=[];
  let offset = header.length+offsets.length;
  for(let y=0;y<height;y++) {
    offsets.writeBigUInt64LE(BigInt(offset),y*8);
    const data = Buffer.alloc(width*names.length*4);
    names.forEach((name,c)=>{for(let x=0;x<width;x++) data.writeFloatLE(channels[name][y*width+x],(c*width+x)*4);});
    const block=Buffer.concat([i32(y+origin[1]),i32(data.length),data]); blocks.push(block); offset+=block.length;
  }
  return Buffer.concat([header,offsets,...blocks]);
}
