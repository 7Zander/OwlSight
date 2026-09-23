// SPDX-License-Identifier: GPL-3.0-or-later
import {imageSamplingGLSL,defaultChannelMap,alphaPreviewGLSL} from './image-layout.mjs';
export function disposeOcio(gl,bundle){if(!bundle)return;for(const t of bundle.textures)gl.deleteTexture(t.texture);gl.deleteProgram(bundle.program);}
export function prepareOcio(gl,vertex,data){
 const textures=[],shaders=[];let program;
 try{
  if(data.textures.length+1>gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS))throw new Error('OCIO LUT 数量超过显卡能力。');
  const source=`#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
uniform sampler2D image;
uniform float exposure;
in vec2 uv;
out vec4 outputColor;
${imageSamplingGLSL}
${alphaPreviewGLSL}
${data.code}
void main(){
 vec4 pixel=sourcePixel();
 bool showAlpha=channelMap.w>=0;
 vec3 value=showAlpha?alphaDisplayInput(pixel):pixel.rgb;
 if(any(isnan(value))||any(isinf(value))||(showAlpha&&(isnan(pixel.a)||isinf(pixel.a)))){outputColor=vec4(1,0,1,1);return;}
 value=owlInput(vec4(value,1)).rgb*${data.dataInput?'1.0':'exp2(exposure)'};
 value=owlDisplay(vec4(value,1)).rgb;
 outputColor=vec4(showAlpha?overChecker(value,pixel.a):clamp(value,0.0,1.0),1);
}`;
  const compile=(type,text)=>{const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,text);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error('OCIO GPU 编译失败：'+gl.getShaderInfoLog(shader));return shader;};
  const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,source);
  program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.bindAttribLocation(program,0,'position');gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('OCIO GPU 链接失败：'+gl.getProgramInfoLog(program));
  gl.useProgram(program);gl.uniform1i(gl.getUniformLocation(program,'image'),0);
  for(const [i,entry] of data.textures.entries()){
   const target=entry.dimension===3?gl.TEXTURE_3D:gl.TEXTURE_2D,limit=gl.getParameter(entry.dimension===3?gl.MAX_3D_TEXTURE_SIZE:gl.MAX_TEXTURE_SIZE);
   if(entry.width>limit||entry.height>limit||(entry.depth||1)>limit)throw new Error('OCIO LUT 尺寸超过显卡能力。');
   if(entry.linear&&!gl.getExtension('OES_texture_float_linear'))throw new Error('显卡不支持 OCIO 所需的浮点 LUT 线性插值。');
   const texture=gl.createTexture(),unit=i+1;textures.push({texture,target,unit});gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(target,texture);
   gl.texParameteri(target,gl.TEXTURE_MIN_FILTER,entry.linear?gl.LINEAR:gl.NEAREST);gl.texParameteri(target,gl.TEXTURE_MAG_FILTER,entry.linear?gl.LINEAR:gl.NEAREST);
   gl.texParameteri(target,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(target,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);if(entry.dimension===3)gl.texParameteri(target,gl.TEXTURE_WRAP_R,gl.CLAMP_TO_EDGE);
   const format=entry.channels===1?gl.RED:gl.RGB,internal=entry.channels===1?gl.R32F:gl.RGB32F,values=new Float32Array(entry.values);
   if(values.length!==entry.width*entry.height*(entry.depth||1)*entry.channels)throw new Error('OCIO LUT 数据尺寸不一致。');
   if(entry.dimension===3)gl.texImage3D(target,0,internal,entry.width,entry.height,entry.depth,0,format,gl.FLOAT,values);
   else gl.texImage2D(target,0,internal,entry.width,entry.height,0,format,gl.FLOAT,values);
   if(gl.getError()!==gl.NO_ERROR)throw new Error('OCIO LUT 上传失败。');
   gl.uniform1i(gl.getUniformLocation(program,entry.sampler),unit);
  }
  return {id:data.id,program,textures,exposure:gl.getUniformLocation(program,'exposure'),channelMap:gl.getUniformLocation(program,'channelMap'),checkerSize:gl.getUniformLocation(program,'checkerSize')};
 }catch(error){for(const t of textures)gl.deleteTexture(t.texture);if(program)gl.deleteProgram(program);throw error;}
 finally{for(const shader of shaders)gl.deleteShader(shader);gl.activeTexture(gl.TEXTURE0);}
}
export function drawOcio(gl,bundle,exposure,channelMap=defaultChannelMap,checkerSize=12){
 gl.useProgram(bundle.program);gl.uniform1f(bundle.exposure,exposure);gl.uniform4iv(bundle.channelMap,channelMap);gl.uniform1f(bundle.checkerSize,checkerSize);
 for(const t of bundle.textures){gl.activeTexture(gl.TEXTURE0+t.unit);gl.bindTexture(t.target,t.texture);}
 gl.activeTexture(gl.TEXTURE0);gl.drawArrays(gl.TRIANGLES,0,6);
}
