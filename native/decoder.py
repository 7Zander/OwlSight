# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded, read-only OpenEXR helper. stdout is a length-prefixed float32 frame."""
import json
import os
import struct
import sys
import OpenEXR
import numpy as np


def inspect(filename):
    if os.path.getsize(filename) > 256 * 1024**2:
        raise ValueError('EXR 文件超过 256 MiB 上限。')
    parts = []
    budget = 0
    with OpenEXR.File(filename, separate_channels=True, header_only=True) as headers:
        if len(headers.parts) > 32:
            raise ValueError('EXR Part 数量超过上限。')
        for part in headers.parts:
            h = part.header
            if h.get('type') in (OpenEXR.deepscanline, OpenEXR.deeptile):
                raise ValueError('当前版本不支持 Deep EXR。')
            low, high = h['dataWindow']
            width, height = (int(high[i] - low[i] + 1) for i in (0, 1))
            channels = sorted(c.name for c in h['channels'])
            if not channels or len(channels) > 256 or any(c.xSampling != 1 or c.ySampling != 1 for c in h['channels']):
                raise ValueError('不支持子采样通道，或通道数超过上限。')
            if min(width, height) < 1 or max(width, height) > 16384 or width * height > 32 * 1024**2:
                raise ValueError('EXR 尺寸超过读取上限。')
            budget += width * height * len(channels) * 4
            if budget > 1024 * 1024**2:
                raise ValueError(f'EXR 全通道展开约需 {budget / 1024**2:.0f} MiB，超过当前 1024 MiB 上限。请减少导出通道或降低分辨率。')
            def window(key):
                a, b = h.get(key, h['dataWindow'])
                return dict(xMin=int(a[0]), yMin=int(a[1]), xMax=int(b[0]), yMax=int(b[1]))
            parts.append(dict(name=h.get('name', ''), width=width, height=height, channels=channels,
                              dataWindow=window('dataWindow'), displayWindow=window('displayWindow'),
                              compression=int(h['compression'].value)))
    return parts


def decode(filename, preview=None):
    parts = inspect(filename)
    if preview is not None:
        # Resolve named channels per frame; a different part ordering must not change the view.
        candidates = [i for i, p in enumerate(parts) if p['name'] == preview['partName']] if preview['partName'] else [preview['partIndex']]
        if len(candidates) != 1 or not 0 <= candidates[0] < len(parts):
            raise ValueError('此帧缺少所选 Part，播放已停止。')
        part_index = candidates[0]
        info = parts[part_index]
        names = preview['channels']
        if len(names) != 3 or any(name not in info['channels'] for name in names) or (not preview['partName'] and info['name']):
            raise ValueError('此帧缺少所选通道，播放已停止。')
        scale = min(1, 1024 / max(info['width'], info['height']))
        width, height = max(1, round(info['width']*scale)), max(1, round(info['height']*scale))
        with OpenEXR.File(filename, separate_channels=True) as source:
            # Never create the all-channel interleaved float32 copy for playback.
            pixels = np.ones((height, width, 4), dtype='<f4')
            xs = np.minimum(info['width']-1, (np.arange(width)/scale).astype(int))
            ys = np.minimum(info['height']-1, (np.arange(height)/scale).astype(int))
            for i, name in enumerate(names):
                pixels[:,:,i] = source.parts[part_index].channels[name].pixels[np.ix_(ys,xs)]
        finite = pixels[:,:,:3][np.isfinite(pixels[:,:,:3])]
        low, high = (float(finite.min()), float(finite.max())) if finite.size else (0.,1.)
        metadata = dict(parts=[dict(width=width,height=height,channels=['R','G','B','A'])],
                        sourceParts=parts, range=[low, high if high > low else low+1])
        write_frame(metadata, [pixels])
        return
    metadata = json.dumps(dict(parts=parts), ensure_ascii=False).encode('utf-8')
    metadata += b' ' * (-len(metadata) % 4)
    with OpenEXR.File(filename, separate_channels=True) as source:
        out = sys.stdout.buffer
        out.write(struct.pack('<I', len(metadata)))
        out.write(metadata)
        for part, info in zip(source.parts, parts, strict=True):
            pixels = np.empty((info['height'], info['width'], len(info['channels'])), dtype='<f4')
            for index, name in enumerate(info['channels']):
                pixels[:, :, index] = part.channels[name].pixels
            out.write(memoryview(pixels).cast('B'))
        out.flush()


def write_frame(metadata, arrays):
    data = json.dumps(metadata, ensure_ascii=False).encode('utf-8')
    data += b' ' * (-len(data) % 4)
    out = sys.stdout.buffer
    out.write(struct.pack('<I', len(data)))
    out.write(data)
    for pixels in arrays:
        out.write(memoryview(pixels).cast('B'))
    out.flush()


if __name__ == '__main__':
    try:
        decode(sys.argv[1], json.loads(sys.argv[2]) if len(sys.argv) > 2 else None)
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
