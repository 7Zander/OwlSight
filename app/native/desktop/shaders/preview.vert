#version 440
layout(location=0) out vec2 uv;
layout(std140,binding=0) uniform Params {
    mat4 correction;
    vec4 canvas;
    vec4 image;
    vec4 view;
    vec4 options;
    vec4 channelMap;
} p;
void main() {
    uv=vec2(float((gl_VertexIndex << 1) & 2),float(gl_VertexIndex & 2));
    gl_Position=p.correction*vec4(uv.x*2.0-1.0,1.0-uv.y*2.0,0.0,1.0);
}
