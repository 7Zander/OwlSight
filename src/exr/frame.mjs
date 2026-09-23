// SPDX-License-Identifier: GPL-3.0-or-later
const textDecoder = new TextDecoder();
export function unpackFrame(bytes) {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (buffer.length < 4) throw new Error('解码结果不完整。');
  const size = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint32(0, true);
  if (size > 1024 ** 2 || size % 4 || size + 4 > buffer.length) throw new Error('解码元数据无效。');
  const frame = JSON.parse(textDecoder.decode(buffer.subarray(4, 4 + size)));
  let offset = size + 4;
  for (const part of frame.parts) {
    const length = part.width * part.height * part.channels.length;
    const pixelBytes = part.pixelType === 'half' ? 2 : 4;
    if (offset + length * pixelBytes > buffer.length) throw new Error('解码像素不完整。');
    const ArrayType = pixelBytes === 2 ? Uint16Array : Float32Array;
    part.pixels = new ArrayType(buffer.buffer, buffer.byteOffset + offset, length);
    offset += length * pixelBytes;
  }
  if (offset !== buffer.length) throw new Error('解码像素大小不匹配。');
  return frame;
}
