// SPDX-License-Identifier: GPL-3.0-or-later
// Compact source channels are kept in native order until GPU sampling.
export const defaultChannelMap = [0,1,2,3];
export const imageSamplingGLSL = `
uniform ivec4 channelMap;
float mappedValue(vec4 value,int index) { return index < 0 ? 1.0 : value[index]; }
vec4 sourcePixel() {
  vec4 value=texture(image,uv);
  return vec4(mappedValue(value,channelMap.x),mappedValue(value,channelMap.y),
              mappedValue(value,channelMap.z),mappedValue(value,channelMap.w));
}`;
