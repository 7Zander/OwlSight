// SPDX-License-Identifier: GPL-3.0-or-later
import { unpackFrame } from '../src/exr/frame.mjs';
export function unpackPreview(result) {
  if (!result.ok) throw new Error(result.error);
  const decoded=unpackFrame(result.bytes),part=decoded.parts[0];
  return {cost:result.bytes.byteLength,frame:{parts:decoded.sourceParts,decodeMs:result.decodeMs},
    packed:part ? {width:part.width,height:part.height,rgba:part.pixels,channels:part.channels.length,channelMap:decoded.channelMap,range:decoded.range,ranges:decoded.ranges} : null,
    result:{name:result.name,path:result.path}};
}
