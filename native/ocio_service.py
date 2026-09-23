# SPDX-License-Identifier: GPL-3.0-or-later
"""Build OCIO GPU resources on configuration changes only; never process video frames."""
import json, sys, os, hashlib, collections
import numpy as np
import PyOpenColorIO as ocio
BUILTIN = 'cg-config-v2.2.0_aces-v1.3_ocio-v2.4'
configs = collections.OrderedDict()

def config_for(source, reload=False):
    if reload:
        ocio.ClearAllCaches()
        configs.pop(source, None)
    if source not in configs:
        cfg = ocio.Config.CreateFromBuiltinConfig(BUILTIN) if source == 'builtin' else ocio.Config.CreateFromFile(source)
        configs[source] = cfg
        while len(configs) > 4: configs.popitem(last=False)
    configs.move_to_end(source)
    return configs[source]

def catalog(source):
    cfg = config_for(source, True)
    spaces = list(cfg.getColorSpaceNames())
    preferred = next((cfg.getColorSpace(n).getName() for n in ['Linear Rec.709 (sRGB)', 'Linear Rec.709', 'Linear sRGB'] if cfg.getColorSpace(n)), None)
    scene = cfg.getColorSpace('scene_linear')
    selected = preferred or (scene.getName() if scene else None) or next((n for n in spaces if cfg.getColorSpace(n).isData()), spaces[0] if spaces else '')
    displays = {d: list(cfg.getViews(d)) for d in cfg.getDisplays()}
    defaults = {d: cfg.getDefaultView(d) for d in displays}
    if not spaces or not displays: raise ValueError('配置没有可用的颜色空间或 Display / View。')
    return dict(source=source, name='内置 ACES 1.3' if source == 'builtin' else os.path.basename(source), spaces=spaces, dataSpaces=[n for n in spaces if cfg.getColorSpace(n).isData()], displays=displays, defaults=defaults, input=selected, display=cfg.getDefaultDisplay(), looks=list(cfg.getLookNames()), scene=scene.getName() if scene else None, version=ocio.__version__)

def processors(cfg, request):
    src, display, view = (request[k] for k in ('input', 'display', 'view'))
    if not cfg.getColorSpace(src): raise ValueError('输入颜色空间不存在。')
    if display not in list(cfg.getDisplays()) or view not in list(cfg.getViews(display)): raise ValueError('Display / View 不存在。')
    if cfg.getColorSpace(src).isData():
        identity = cfg.getProcessor(src, src)
        return identity, identity
    if not cfg.getColorSpace('scene_linear'): raise ValueError('配置缺少 scene_linear，无法确定曝光工作空间；请使用 Raw 或补充配置。')
    mode, look = request.get('lookMode', 'config'), request.get('look', '')
    if mode not in ('config', 'none', 'override'): raise ValueError('Look 模式无效。')
    group = ocio.GroupTransform()
    if mode == 'override':
        if look not in list(cfg.getLookNames()): raise ValueError('Look 不存在。')
        group.appendTransform(ocio.LookTransform(src='scene_linear', dst='scene_linear', looks=look))
    transform = ocio.DisplayViewTransform(src='scene_linear', display=display, view=view)
    transform.setLooksBypass(mode != 'config')
    group.appendTransform(transform)
    return cfg.getProcessor(src, 'scene_linear'), cfg.getProcessor(group)

def shader(processor, function):
    desc = ocio.GpuShaderDesc.CreateShaderDesc()
    desc.setLanguage(ocio.GPU_LANGUAGE_GLSL_ES_3_0)
    desc.setAllowTexture1D(False)
    desc.setTextureMaxWidth(4096)
    desc.setFunctionName(function)
    desc.setResourcePrefix(function + '_')
    processor.getDefaultGPUProcessor().extractGpuShaderInfo(desc)
    if len(list(desc.getUniforms())): raise ValueError('此配置包含暂不支持的动态 OCIO 参数。')
    textures = []
    total = 0
    def values(t, count):
        nonlocal total
        total += count
        if total > 2*1024**2: raise ValueError("配置 LUT 超过当前 GPU 预览资源上限。")
        return t.getValues().astype(np.float32).ravel().tolist()
    for t in desc.getTextures():
        channels = 1 if t.channel == ocio.GpuShaderDesc.TEXTURE_RED_CHANNEL else 3
        textures.append(dict(sampler=t.samplerName, dimension=2, width=t.width, height=t.height, channels=channels, linear=t.interpolation == ocio.INTERP_LINEAR, values=values(t, t.width*t.height*channels)))
    for t in desc.get3DTextures():
        textures.append(dict(sampler=t.samplerName, dimension=3, width=t.edgeLen, height=t.edgeLen, depth=t.edgeLen, channels=3, linear=t.interpolation == ocio.INTERP_LINEAR, values=values(t, t.edgeLen**3*3)))
    return dict(code=desc.getShaderText(), textures=textures)

def build(request):
    cfg = config_for(request['source'])
    first, second = processors(cfg, request)
    a, b = shader(first, 'owlInput'), shader(second, 'owlDisplay')
    textures = a['textures'] + b['textures']
    if len(textures)>14 or sum(len(t['values']) for t in textures)>2*1024**2: raise ValueError('配置 LUT 超过当前 GPU 预览资源上限。')
    code = a['code'] + '\n' + b['code']
    data_input = cfg.getColorSpace(request['input']).isData()
    fingerprint = hashlib.sha256((first.getCacheID()+second.getCacheID()+code+str(data_input)).encode()).hexdigest()
    return dict(id=fingerprint, dataInput=data_input, code=code, textures=textures, selection={k:request.get(k) for k in ('input','display','view','lookMode','look')})

def run(request):
    if request['action']=='catalog': return catalog(request['source'])
    if request['action']=='build': return build(request)
    if request['action']=='reference':
        cfg=config_for(request['source'])
        if cfg.getColorSpace(request['input']).isData(): return request['samples']
        a,b=processors(cfg,request)
        a,b=a.getDefaultCPUProcessor(),b.getDefaultCPUProcessor()
        return [b.applyRGB([v*2**request.get('exposure',0) for v in a.applyRGB(rgb)]) for rgb in request['samples']]
    raise ValueError('未知 OCIO 请求。')

if __name__ == '__main__':
    for line in sys.stdin.buffer:
        try:
            if len(line)>1024**2: raise ValueError('OCIO 请求过长。')
            response=dict(ok=True,result=run(json.loads(line)))
        except Exception as error: response=dict(ok=False,error=str(error))
        print(json.dumps(response,ensure_ascii=False,allow_nan=False,separators=(',',':')),flush=True)
