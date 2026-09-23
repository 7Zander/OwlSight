// SPDX-License-Identifier: GPL-3.0-or-later
import * as wasm from '../../node_modules/exrs/node_modules/exrs-raw-wasm-bindgen/exrs_raw_wasm_bindgen.js';
import { inspectExr, LIMITS } from './header.mjs';
let ready = false;
export function initializeDecoder(wasmBytes) {
  if (!ready) { wasm.initSync({ module: wasmBytes }); ready = true; }
}
export function decodeFrame(bytes) {
  if (bytes.byteLength > LIMITS.fileBytes) throw new Error('文件超过 256 MiB 读取上限。');
  const header = inspectExr(bytes);
  let decoder;
  try {
    decoder = wasm.readExr(bytes);
    if (decoder.layerCount !== header.parts.length) throw new Error('解码器返回的 Part 数量与文件头不一致。');
    const parts = header.parts.map((part, index) => {
      const channels = decoder.getLayerChannelNames(index);
      if (channels.length !== part.channels.length || channels.some(name => !part.channels.includes(name))) throw new Error('解码器未返回完整通道。');
      const pixels = decoder.getLayerPixels(index, channels);
      if (!pixels || pixels.length !== part.width * part.height * channels.length) throw new Error('此文件的 Part 尺寸与解码结果不匹配，暂不能可靠预览。');
      return { ...part, channels, types: channels.map(name => part.types[part.channels.indexOf(name)]), pixels };
    });
    return { parts, decodedBytes: header.decodedBytes };
  } catch (error) {
    throw new Error(`EXR 解码失败：${error?.message || String(error)}`);
  } finally {
    decoder?.free();
  }
}
