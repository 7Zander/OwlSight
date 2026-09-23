// SPDX-License-Identifier: GPL-3.0-or-later
const { spawn } = require('node:child_process');
const path = require('node:path');
const pixelLimit = 1024 * 1024 ** 2;
const outputLimit = pixelLimit + 1024 ** 2 + 4;
// One owned decoder at a time. Never run a shell or interpolate file names.
function createDecoder(root) {
  let active, serial = Promise.resolve(), revision = 0;
  function cancel() { revision++; active?.kill(); }
  function decode(file, preview) {
    cancel();
    const request = revision;
    const result = serial.then(() => {
      if (request !== revision) throw new Error('解码已取消。');
      return run(file, preview);
    });
    // The queue tail must not retain the last full pixel buffer after delivery.
    serial = result.then(() => {}, () => {});
    return result;
  }
  function run(file, preview) {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      const child = spawn(path.join(root, 'resources/decoder/owlsight-decoder.exe'), ['-I', '-B', '-X', 'utf8', path.join(root, 'resources/decoder/decoder.py'), file, ...(preview ? [JSON.stringify(preview)] : [])], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      active = child;
      let header = Buffer.alloc(0), output, offset = 0, stderr = '', failure;
      const fail = error => { failure ||= error; child.kill(); };
      const timer = setTimeout(() => fail(new Error('解码超过 60 秒，已停止。')), 60000);
      child.stdout.on('data', chunk => {
        if (failure) return;
        try {
          if (!output) {
            header = Buffer.concat([header, chunk]);
            if (header.length < 4) return;
            const length = header.readUInt32LE(0);
            if (length > 1024 ** 2 || length % 4) throw new Error('解码元数据无效。');
            if (header.length < length + 4) return;
            const metadata = JSON.parse(header.subarray(4, 4 + length).toString('utf8'));
            const pixelBytes = metadata.parts.reduce((sum,p) => sum + p.width * p.height * p.channels.length * 4, 0);
            const total = length + 4 + pixelBytes;
            if (!Number.isSafeInteger(total) || pixelBytes <= 0 || pixelBytes > pixelLimit || total > outputLimit) throw new Error('解码输出超过 1 GiB 解码预算。');
            // Allocate once; do not retain every chunk and duplicate a large frame at EOF.
            output = Buffer.allocUnsafe(total);
            chunk = header; header = null;
          }
          if (offset + chunk.length > output.length) throw new Error('解码输出大小不匹配。');
          chunk.copy(output, offset); offset += chunk.length;
        } catch (error) { fail(error); }
      });
      // Stream decoding preserves characters even when a UTF-8 character spans chunks.
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', text => { if (stderr.length < 4096) stderr += text; });
      child.on('error', error => { failure = error; });
      child.on('close', code => {
        clearTimeout(timer);
        if (active === child) active = null;
        if (failure || code !== 0 || !output || offset !== output.length) {
          output = header = null;
          reject(failure || new Error(stderr.trim() || '解码已取消或文件数据不完整。')); return;
        }
        resolve({ bytes: output, decodeMs: performance.now() - start });
      });
    });
  }
  return { decode, cancel };
}
module.exports = { createDecoder };
