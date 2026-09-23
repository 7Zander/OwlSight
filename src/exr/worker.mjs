// SPDX-License-Identifier: GPL-3.0-or-later
import { unpackFrame } from './frame.mjs';
import { packView } from '../render/viewer.mjs';
let frame = null;
self.onmessage = async ({ data }) => {
  if (data.type === 'preview') {
    try {
      if (!frame || !frame.parts[data.part]) throw new Error('图像数据已释放。');
      const packed = packView(frame.parts[data.part], data.view, data.maxEdge);
      self.postMessage({ type: 'preview', id: data.id, ok: true, packed }, [packed.rgba.buffer]);
    } catch (error) { self.postMessage({ type: 'preview', id: data.id, ok: false, error: error.message }); }
    return;
  }
  try {
    const start = performance.now();
    frame = unpackFrame(data.bytes);
    const metadata = { ...frame, parts: frame.parts.map(({ pixels, ...part }) => part) };
    self.postMessage({ ok: true, frame: metadata, decodeMs: data.decodeMs + performance.now() - start });
  } catch (error) { self.postMessage({ ok: false, error: error.message || String(error) }); }
};
