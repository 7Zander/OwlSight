// SPDX-License-Identifier: GPL-3.0-or-later
import {prepareOcio,disposeOcio,drawOcio} from './ocio.mjs';
import {Samples} from '../core/perf-metrics.mjs';
import {imageSamplingGLSL,defaultChannelMap,alphaPreviewGLSL} from './image-layout.mjs';
const vertex = `#version 300 es
in vec2 position;
out vec2 uv;
void main() { uv = vec2((position.x+1.0)*0.5, (1.0-position.y)*0.5); gl_Position=vec4(position,0,1); }`;
const fragment = `#version 300 es
precision highp float;
uniform sampler2D image;
uniform float exposure;
uniform int mode;
uniform int component;
uniform vec2 range;
in vec2 uv;
out vec4 outputColor;
${imageSamplingGLSL}
${alphaPreviewGLSL}
vec3 srgb(vec3 x) { return mix(12.92*x,1.055*pow(max(x,vec3(0)),vec3(1.0/2.4))-0.055,greaterThan(x,vec3(0.0031308))); }
void main() {
  vec4 pixel=sourcePixel();
  bool showAlpha=component<0 && channelMap.w>=0 && mode!=2;
  vec3 value=component<0?(showAlpha?alphaDisplayInput(pixel):pixel.rgb):vec3(pixel[component]);
  if(any(isnan(value)) || any(isinf(value)) || (showAlpha && (isnan(pixel.a) || isinf(pixel.a)))) { outputColor=vec4(1,0,1,1); return; }
  if(mode==2) value=(value-range.x)/max(range.y-range.x,0.000001);
  else if(mode==1) value=srgb(value*exp2(exposure));
  outputColor=vec4(showAlpha?overChecker(value,pixel.a):clamp(value,0.0,1.0),1);
}`;

export function packView(part, view, maxEdge = Infinity) {
  const scale = Math.min(1, maxEdge / Math.max(part.width, part.height));
  const width = Math.max(1, Math.round(part.width * scale)), height = Math.max(1, Math.round(part.height * scale));
  const rgba = new Float32Array(width * height * 4);
  let low = Infinity, high = -Infinity;
  const stride = part.channels.length;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = (Math.min(part.height - 1, Math.floor(y / scale)) * part.width + Math.min(part.width - 1, Math.floor(x / scale))) * stride;
    const target = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) {
      const v = part.pixels[source + view.components[c]];
      rgba[target + c] = v;
      if (Number.isFinite(v)) { low = Math.min(low, v); high = Math.max(high, v); }
    }
    rgba[target + 3] = view.color && view.channels?.A !== undefined ? part.pixels[source + view.channels.A] : 1;
  }
  if (!Number.isFinite(low)) { low = 0; high = 1; }
  return { width, height, rgba, range: [low, high > low ? high : low + 1] };
}

export class GpuViewer {
  constructor(canvas, {cacheBytes = 1024 * 1024**2, cacheFrames = 2048, preserveDrawingBuffer = false} = {}) {
    this.canvas = canvas;
    const gl = this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer });
    if (!gl) throw new Error('无法创建 WebGL2。请检查显卡驱动与硬件加速。');
    const compile = (type, source) => {
      const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragment);
    this.program = gl.createProgram(); gl.attachShader(this.program, vs); gl.attachShader(this.program, fs); gl.bindAttribLocation(this.program,0,'position'); gl.linkProgram(this.program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
    gl.useProgram(this.program);
    this.buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const attr = gl.getAttribLocation(this.program, 'position'); gl.enableVertexAttribArray(attr); gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
    this.texture = null;
    this.resident = new Map(); this.identities = new WeakMap(); this.nextIdentity = 0;
    this.cacheBytes = cacheBytes; this.cacheFrames = cacheFrames; this.residentBytes = 0;
    this.uploadSamples=new Samples();this.drawSamples=new Samples();
    this.stats = {uploads:0,hits:0,prepared:0,allocations:0,reuses:0,prepareErrors:0,budgetReductions:0}; this.prepareDisabled = false;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.exposure = gl.getUniformLocation(this.program, 'exposure'); this.mode = gl.getUniformLocation(this.program, 'mode'); this.range = gl.getUniformLocation(this.program, 'range');
    this.component=gl.getUniformLocation(this.program,'component');
    this.checkerSize=gl.getUniformLocation(this.program,'checkerSize');
    this.channelMap=gl.getUniformLocation(this.program,'channelMap');
    gl.uniform1i(gl.getUniformLocation(this.program, 'image'), 0);
  }
  prepareColor(data) { return this.ocio?.id===data.id?this.ocio:prepareOcio(this.gl,vertex,data); }
  commitColor(bundle) { if(this.ocio===bundle)return;disposeOcio(this.gl,this.ocio);this.ocio=bundle; }
  discardColor(bundle) { if(bundle!==this.ocio)disposeOcio(this.gl,bundle); }
  _identity(packed) {
    let id=this.identities.get(packed);
    if(id===undefined){id=++this.nextIdentity;this.identities.set(packed,id);}
    return id;
  }
  _remove(id,entry) {
    this.gl.deleteTexture(entry.texture); this.resident.delete(id); this.residentBytes-=entry.bytes;
  }
  _textureBytes(packed) {
    const channels=packed.channels||4;
    return packed.width*packed.height*(channels===3?4:channels)*(packed.rgba instanceof Uint16Array?2:4);
  }
  _resident(packed, speculative=false, protectedIds=null) {
    const id=this._identity(packed), cached=this.resident.get(id);
    if(cached){this.resident.delete(id);this.resident.set(id,cached);return cached;}
    const uploadStarted=performance.now();
    const gl=this.gl, half=packed.rgba instanceof Uint16Array, channels=packed.channels||4;
    if(![1,2,3,4].includes(channels)||packed.rgba.length!==packed.width*packed.height*channels)throw new Error('预览通道大小不一致。');
    // Drivers may expand RGB storage to RGBA. Charge that conservative size.
    const bytes=this._textureBytes(packed);
    const visible=[...this.resident.values()].find(entry=>entry.texture===this.texture);
    if(speculative&&(bytes+(visible?.bytes||0)>this.cacheBytes||this.cacheFrames<2))return null;
    if(packed.width>this.maxTextureSize||packed.height>this.maxTextureSize)throw new Error('图像超过当前 GPU 纹理上限。');
    if(speculative){
      let lockedBytes=bytes,lockedCount=1;
      for(const [other,entry] of this.resident){
        if(entry.texture===this.texture||protectedIds?.has(other)){lockedBytes+=entry.bytes;lockedCount++;}
      }
      if(lockedBytes>this.cacheBytes||lockedCount>this.cacheFrames)return null;
    }
    let reused=null;
    // Recycle an evicted slot of the same layout, never the displayed texture.
    for(const [old,entry] of this.resident){
      if(this.residentBytes+bytes<=this.cacheBytes&&this.resident.size<this.cacheFrames)break;
      if(entry.texture===this.texture||protectedIds?.has(old))continue;
      if(!reused&&entry.width===packed.width&&entry.height===packed.height&&entry.channels===channels&&entry.half===half){
        reused=entry.texture;this.resident.delete(old);this.residentBytes-=entry.bytes;
      }else this._remove(old,entry);
    }
    const texture=reused||gl.createTexture();
    const format=[gl.RED,gl.RG,gl.RGB,gl.RGBA][channels-1];
    const internal=(half?[gl.R16F,gl.RG16F,gl.RGB16F,gl.RGBA16F]:[gl.R32F,gl.RG32F,gl.RGB32F,gl.RGBA32F])[channels-1];
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
    try{
      if(!reused){
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texStorage2D(gl.TEXTURE_2D,1,internal,packed.width,packed.height);
      }
      // Half RGB/scalar rows need not be aligned to four bytes.
      gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
      gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,packed.width,packed.height,format,half?gl.HALF_FLOAT:gl.FLOAT,packed.rgba);
      // Check allocation/format errors when creating a slot; reused slots have
      // the same validated dimensions/type and avoid a per-frame error query.
      if(!reused){
        const error=gl.getError();
        if(error!==gl.NO_ERROR)throw Object.assign(new Error('GPU 浮点纹理上传失败，可能显存不足。'),{allocationFailed:error===gl.OUT_OF_MEMORY});
      }
    }catch(error){gl.deleteTexture(texture);throw error;}
    finally{gl.pixelStorei(gl.UNPACK_ALIGNMENT,4);gl.bindTexture(gl.TEXTURE_2D,this.texture);}
    if(reused)this.stats.reuses++;else this.stats.allocations++;
    // Only a weak identity references CPU pixels; resident entries keep metadata.
    const entry={texture,bytes,width:packed.width,height:packed.height,range:packed.range,ranges:packed.ranges,
      channelMap:packed.channelMap||defaultChannelMap,channels,half};
    this.resident.set(id,entry);this.residentBytes+=bytes;this.stats.uploads++;this.uploadSamples.add(performance.now()-uploadStarted);
    return entry;
  }
  _reduceCache() {
    this.cacheBytes=Math.max(16*1024**2,Math.floor(this.cacheBytes/2));this.stats.budgetReductions++;
    // Keep the visible image valid while making room for one foreground retry.
    for(const [id,entry] of this.resident)if(entry.texture!==this.texture)this._remove(id,entry);
  }
  prepare(candidates) {
    if(this.prepareDisabled)return;
    const protectedIds=new Set(),admitted=[];
    let bytes=this.size?.bytes||0,count=this.size?1:0;
    // Admit a prefix that fits with the displayed frame. Every nearer candidate
    // is protected before an upload can evict a resident frame from the cache.
    for(const packed of candidates){
      const id=this._identity(packed);
      if(protectedIds.has(id)||this.resident.get(id)?.texture===this.texture)continue;
      const cost=this._textureBytes(packed);
      if(bytes+cost>this.cacheBytes||count+1>this.cacheFrames)break;
      bytes+=cost;count++;protectedIds.add(id);admitted.push(packed);
    }
    for(const packed of admitted){
      if(this.resident.has(this._identity(packed)))continue;
      try{if(this._resident(packed,true,protectedIds))this.stats.prepared++;}
      catch(error){this.stats.prepareErrors++;if(error.allocationFailed)this._reduceCache();else this.prepareDisabled=true;}
      break;
    }
  }
  upload(packed) {
    if(this.resident.has(this._identity(packed)))this.stats.hits++;
    let entry;
    try{entry=this._resident(packed);}
    catch(error){if(!error.allocationFailed)throw error;this._reduceCache();entry=this._resident(packed);}
    this.texture=entry.texture;this.size=entry;
    for(const [id,other] of this.resident){
      if(this.residentBytes<=this.cacheBytes&&this.resident.size<=this.cacheFrames)break;
      if(other!==entry)this._remove(id,other);
    }
    this.gl.activeTexture(this.gl.TEXTURE0);this.gl.bindTexture(this.gl.TEXTURE_2D,this.texture);
    this.canvas.title=`预览 ${packed.width} × ${packed.height}`;
  }
  clearImages() {
    for(const [id,entry] of this.resident)this._remove(id,entry);
    this.texture=null;this.size=null;this.prepareDisabled=false;
  }
  draw({ width, height, zoom = 1, panX = 0, panY = 0, exposure = 0, mode = 1, component = -1, fit = true, checkerSize = 12 }) {
    if (!this.size || (mode===2&&!this.size.range)) return;
    const drawStarted=performance.now(),gl = this.gl;
    const wCanvas = Math.max(1, Math.round(width)), hCanvas = Math.max(1, Math.round(height));
    if (this.canvas.width !== wCanvas) this.canvas.width = wCanvas;
    if (this.canvas.height !== hCanvas) this.canvas.height = hCanvas;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.clearColor(0.065,0.073,0.082,1); gl.clear(gl.COLOR_BUFFER_BIT);
    const scale = (fit ? Math.min(width / this.size.width, height / this.size.height) : 1) * zoom;
    const w = this.size.width * scale, h = this.size.height * scale;
    gl.viewport(Math.round((width - w) / 2 + panX), Math.round((height - h) / 2 - panY), Math.max(1,Math.round(w)), Math.max(1,Math.round(h)));
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);
    if(mode===3&&component<0&&this.ocio){drawOcio(gl,this.ocio,exposure,this.size.channelMap,checkerSize);this.drawSamples.add(performance.now()-drawStarted);return true;}
    gl.useProgram(this.program); gl.uniform1f(this.exposure, exposure); gl.uniform1i(this.mode, mode); gl.uniform1i(this.component,component); gl.uniform1f(this.checkerSize,checkerSize); gl.uniform4iv(this.channelMap,this.size.channelMap); gl.uniform2fv(this.range,component>=0&&this.size.ranges?this.size.ranges[component]:(this.size.range||[0,1]));
    gl.drawArrays(gl.TRIANGLES, 0, 6);this.drawSamples.add(performance.now()-drawStarted);return true;
  }
  perfSnapshot(){return {textureFrames:this.resident.size,budgetMiB:this.cacheBytes/1024**2,frameLimit:this.cacheFrames,uploadSubmit:this.uploadSamples.snapshot(true),drawSubmit:this.drawSamples.snapshot(true),timingBoundary:'CPU calls; no GPU synchronization'};}
  dispose() { const gl = this.gl; disposeOcio(gl,this.ocio); this.clearImages(); gl.deleteBuffer(this.buffer); gl.deleteProgram(this.program); }
}
