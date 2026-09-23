# SPDX-License-Identifier: GPL-3.0-or-later
"""Persistent, bounded EXR preview service. JSON requests / binary Half/Float replies."""
import collections
import json
import os
import sys
import time
initialization_started = time.perf_counter()
from perf_support import process_sample
import numpy as np
import OpenImageIO as oiio
import OpenEXR
from decoder import inspect, write_frame

oiio.attribute('threads', 4)
# Only small headers and recently requested source Parts are retained, never whole sequences.
headers = collections.OrderedDict()
planes = collections.OrderedDict()
plane_bytes = 0
PLANE_LIMIT = 96 * 1024**2
INITIALIZATION_MS = (time.perf_counter()-initialization_started)*1000


def preview(request):
    global plane_bytes
    started = time.perf_counter()
    measured = lambda: (time.perf_counter()-started)*1000
    timing = {}
    if request.get('warmup') is True:
        write_frame(dict(parts=[], diagnostics=dict(timing=dict(initializationMs=INITIALIZATION_MS), resources=process_sample())), [])
        return
    filename = request['file']
    stamp = os.stat(filename)
    key = (filename, stamp.st_mtime_ns, stamp.st_size)
    header_hit = key in headers
    if key not in headers:
        headers[key] = inspect(filename)
        while len(headers) > 256:
            headers.popitem(last=False)
    parts = headers[key]
    headers.move_to_end(key)
    timing['headerMs'] = measured()
    descriptor = request.get('view')
    if descriptor is None:
        write_frame(dict(parts=[], sourceParts=parts, diagnostics=dict(timing=timing,headerCacheHit=header_hit,resources=process_sample())), [])
        return
    candidates = [i for i,p in enumerate(parts) if p['name'] == descriptor['partName']] if descriptor['partName'] else [descriptor['partIndex']]
    if len(candidates) != 1 or not 0 <= candidates[0] < len(parts):
        raise ValueError('此帧缺少所选 Part。')
    index = candidates[0]
    info = parts[index]
    names = descriptor['channels']
    if len(names) not in (3,4) or any(c not in info['channels'] for c in names) or (not descriptor['partName'] and info['name']):
        raise ValueError('此帧缺少所选通道。')
    divisor = request.get('divisor', 1)
    edge = request.get('maxEdge', 0)
    if divisor not in (1,2,3,4,8) or edge not in (0,300):
        raise ValueError('预览分辨率无效。')
    # Keep all channels of a small Part for instantaneous R/G/B/A and AOV reuse.
    plane_key = None
    cached = None
    for candidate, value in reversed(planes.items()):
        if candidate[:2] == (key,index) and all(name in value[1] for name in names):
            plane_key, cached = candidate, value
            break
    source_started = time.perf_counter()
    plane_hit = cached is not None
    if cached is None:
        all_bytes = info['width'] * info['height'] * len(info['channels']) * 4
        if info['compression'] in (10,11):
            # This OIIO wheel cannot decode HTJ2K; retain the verified OpenEXR path.
            channel_names = info['channels'] if all_bytes <= PLANE_LIMIT else list(dict.fromkeys(names))
            with OpenEXR.File(filename,separate_channels=True) as source:
                arrays = [source.parts[index].channels[c].pixels for c in channel_names]
                dtype = np.float16 if all(a.dtype == np.float16 for a in arrays) else np.float32
                pixels = np.stack(arrays,axis=-1).astype(dtype,copy=False)
            cached = (pixels,channel_names)
        else:
            open_started = time.perf_counter()
            source = oiio.ImageInput.open(filename)
            timing['sourceOpenMs'] = (time.perf_counter()-open_started)*1000
            if source is None:
                raise ValueError(oiio.geterror() or '无法读取 EXR。')
            try:
                select_started = time.perf_counter()
                if not source.seek_subimage(index,0):
                    raise ValueError('无法读取 EXR Part。')
                spec = source.spec()
                channel_names = list(spec.channelnames)
                # Large single Parts read the minimum needed contiguous channel range.
                indexes = [channel_names.index(name) for name in names]
                all_bytes = info['width'] * info['height'] * len(channel_names) * 4
                begin, end = (0,len(channel_names)) if all_bytes <= PLANE_LIMIT else (min(indexes),max(indexes)+1)
                types = list(spec.channelformats) or [spec.format]*len(channel_names)
                pixel_type = oiio.HALF if all(str(t)=='half' for t in types[begin:end]) else oiio.FLOAT
                timing['partSelectMs'] = (time.perf_counter()-select_started)*1000
                pixels_started = time.perf_counter()
                pixels = source.read_image(index,0,begin,end,pixel_type)
                timing['pixelReadDecodeMs'] = (time.perf_counter()-pixels_started)*1000
                if pixels is None:
                    raise ValueError(source.geterror() or 'EXR 像素读取失败。')
                cached = (pixels,channel_names[begin:end])
            finally:
                close_started = time.perf_counter()
                source.close()
                timing['sourceCloseMs'] = (time.perf_counter()-close_started)*1000
        # Retain a bounded decoded subset too; large Parts need not be reread for
        # the same layer just because their unrelated channels exceed the budget.
        plane_key = (key,index,tuple(cached[1]))
        if pixels.nbytes <= PLANE_LIMIT:
            while planes and plane_bytes + pixels.nbytes > PLANE_LIMIT:
                _, old = planes.popitem(last=False); plane_bytes -= old[0].nbytes
            planes[plane_key] = cached; plane_bytes += pixels.nbytes
    else:
        planes.move_to_end(plane_key)
    timing['sourceReadDecodeMs'] = (time.perf_counter()-source_started)*1000
    prepare_started = time.perf_counter()
    source_pixels, channels = cached
    scale = min(1/divisor, edge/max(info['width'],info['height'])) if edge else 1/divisor
    width, height = (max(1,round(info['width']*scale)), max(1,round(info['height']*scale))) if edge else ((info['width']+divisor-1)//divisor,(info['height']+divisor-1)//divisor)
    # Preserve source order and precision. The shader maps these channels to RGBA.
    # Whole RGB/RGBA Parts at full resolution can leave the decoder without a
    # second image allocation; scalar AOVs are sent once instead of four times.
    channel_names = [name for name in channels if name in names]
    indices = [channels.index(name) for name in channel_names]
    if indices == list(range(indices[0], indices[-1] + 1)):
        selected = source_pixels[:, :, indices[0]:indices[-1] + 1]
    else:
        selected = None
    if edge:
        xs = np.minimum(info['width']-1,(np.arange(width)/scale).astype(int))
        ys = np.minimum(info['height']-1,(np.arange(height)/scale).astype(int))
        pixels = source_pixels[ys[:,None,None],xs[None,:,None],np.asarray(indices)[None,None,:]]
    elif selected is not None:
        pixels = selected[:height*divisor:divisor,:width*divisor:divisor,:]
    else:
        pixels = np.take(source_pixels[:height*divisor:divisor,:width*divisor:divisor,:],indices,axis=2)
    pixels = np.ascontiguousarray(pixels)
    mapping = [channel_names.index(name) for name in names]
    if len(mapping) == 3:
        mapping.append(-1)  # Opaque alpha is supplied by the shader.
    metadata = dict(parts=[dict(width=width,height=height,channels=channel_names,
                               pixelType='half' if pixels.dtype == np.float16 else 'float')],
                    sourceParts=parts,channelMap=mapping,divisor=divisor)
    timing['selectResizePackMs'] = (time.perf_counter()-prepare_started)*1000
    range_started = time.perf_counter()
    # Range mapping is a separate request/cache context. Ordinary Raw/sRGB/OCIO
    # playback does not scan every pixel or create finite-value copies.
    if descriptor.get('range', False):
        extrema = []
        for c in range(len(channel_names)):
            values = pixels[:,:,c]
            finite = np.isfinite(values)
            low = float(np.min(values,where=finite,initial=np.inf))
            high = float(np.max(values,where=finite,initial=-np.inf))
            extrema.append((low,high))
        def display_range(low,high):
            if not np.isfinite(low):
                return [0.,1.]
            return [low,high if high > low else low+1]
        metadata['ranges'] = [display_range(*extrema[c]) if c >= 0 else [1.,2.] for c in mapping]
        rgb = [extrema[c] for c in mapping[:3] if np.isfinite(extrema[c][0])]
        metadata['range'] = display_range(min((p[0] for p in rgb),default=0.),
                                          max((p[1] for p in rgb),default=1.))
    timing['rangeMs'] = (time.perf_counter()-range_started)*1000
    timing['nativeBeforeWriteMs'] = measured()
    metadata['diagnostics'] = dict(timing=timing, headerCacheHit=header_hit, planeCacheHit=plane_hit,
        sourceWidth=info['width'], sourceHeight=info['height'], compression=info['compression'],
        decodedPixelType=str(source_pixels.dtype), outputPixelType=str(pixels.dtype), outputBytes=pixels.nbytes,
        planeCacheBytes=plane_bytes, fileBytes=stamp.st_size, resources=process_sample())
    write_frame(metadata,[pixels])



for line in sys.stdin.buffer:
    try:
        if len(line)>65536: raise ValueError('请求过长。')
        preview(json.loads(line))
    except Exception as error:
        write_frame(dict(parts=[],error=str(error)),[])
