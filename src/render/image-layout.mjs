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

// Apply display transforms to unassociated RGB, then composite in display space.
// EXR may also contain emission (nonzero RGB at zero alpha); retain that color.
export const alphaPreviewGLSL = `
uniform float checkerSize;
vec3 alphaDisplayInput(vec4 pixel) {
  return pixel.a > 0.0 ? pixel.rgb / pixel.a : pixel.rgb;
}
vec3 overChecker(vec3 value, float alpha) {
  vec2 tile = floor(gl_FragCoord.xy / checkerSize);
  vec3 background = vec3(mix(0.18, 0.28, mod(tile.x + tile.y, 2.0)));
  float coverage = clamp(alpha, 0.0, 1.0);
  vec3 foreground = clamp(value, 0.0, 1.0);
  if (alpha > 0.0) foreground *= coverage;
  return clamp(foreground + background * (1.0 - coverage), 0.0, 1.0);
}`;
