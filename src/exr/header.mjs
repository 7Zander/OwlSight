// SPDX-License-Identifier: GPL-3.0-or-later
export const LIMITS = Object.freeze({ fileBytes: 256 * 1024 ** 2, decodedBytes: 1024 * 1024 ** 2, channels: 256, parts: 32, edge: 16384, pixels: 32 * 1024 ** 2 });

// Preflight headers before invoking the native decoder. Metadata also supplies the offsets
// omitted by the pinned exrs JavaScript API. This is not a pixel decoder.
export function inspectExr(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  const need = n => { if (n < 0 || pos + n > bytes.length) throw new Error('EXR 文件不完整或属性长度错误。'); };
  function u32() { need(4); const v = view.getUint32(pos, true); pos += 4; return v; }
  function string() {
    const start = pos;
    while (true) { need(1); if (bytes[pos++] === 0) break; if (pos - start > 4096) throw new Error('EXR 属性名称过长。'); }
    return new TextDecoder().decode(bytes.subarray(start, pos - 1));
  }
  if (u32() !== 20000630) throw new Error('这不是有效的 OpenEXR 文件。');
  const flags = u32();
  if ((flags & 255) !== 2 || (flags & ~0x1fff)) throw new Error('不支持的 EXR 版本或标志。');
  if (flags & 0x800) throw new Error('当前版本不支持 Deep EXR。');
  const multipart = !!(flags & 0x1000), parts = [];
  let decodedBytes = 0;
  do {
    if (parts.length >= LIMITS.parts) throw new Error('EXR Part 数量超过读取上限。');
    const part = { name: '', channels: [], types: [], compression: 0 };
    for (;;) {
      const name = string();
      if (!name) break;
      const type = string(), size = u32();
      need(size);
      const end = pos + size;
      if (name === 'channels' && type === 'chlist') {
        while (pos < end) {
          const channel = string();
          if (!channel) break;
          need(16);
          const pixelType = u32();
          pos += 4;
          const xs = u32(), ys = u32();
          if (![0, 1, 2].includes(pixelType)) throw new Error('未知 EXR 通道数据类型。');
          if (xs !== 1 || ys !== 1) throw new Error('当前版本暂不支持子采样通道。');
          if (part.channels.includes(channel)) throw new Error('EXR 含重复通道名。');
          part.channels.push(channel); part.types.push(pixelType);
          if (part.channels.length > LIMITS.channels) throw new Error('通道数超过读取上限。');
        }
      } else if ((name === 'dataWindow' || name === 'displayWindow') && type === 'box2i' && size === 16) {
        part[name] = { xMin: view.getInt32(pos, true), yMin: view.getInt32(pos + 4, true), xMax: view.getInt32(pos + 8, true), yMax: view.getInt32(pos + 12, true) };
      } else if ((name === 'name' || name === 'type') && type === 'string') {
        part[name] = new TextDecoder().decode(bytes.subarray(pos, end));
      } else if (name === 'compression' && size === 1) part.compression = bytes[pos];
      if (pos > end) throw new Error('EXR 通道属性越界。');
      pos = end;
    }
    if (!part.dataWindow || !part.channels.length) throw new Error('EXR 缺少图像窗口或通道。');
    if (part.type?.startsWith('deep')) throw new Error('当前版本不支持 Deep EXR。');
    const dw = part.dataWindow;
    part.width = dw.xMax - dw.xMin + 1; part.height = dw.yMax - dw.yMin + 1;
    if (part.width < 1 || part.height < 1 || part.width > LIMITS.edge || part.height > LIMITS.edge || part.width * part.height > LIMITS.pixels) throw new Error('EXR 图像尺寸超过读取上限（最长边 16384，最多 3200 万像素）。');
    decodedBytes += part.width * part.height * part.channels.length * 4;
    if (decodedBytes > LIMITS.decodedBytes) throw new Error('EXR 全通道解码超过 1024 MiB 解码预算；请先导出较少通道或较小图像。');
    parts.push(part);
    if (!multipart) break;
    need(1);
  } while (bytes[pos] !== 0);
  return { parts, decodedBytes };
}

