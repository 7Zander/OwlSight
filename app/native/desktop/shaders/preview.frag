#version 440
layout(location=0) in vec2 uv;
layout(location=0) out vec4 fragColor;
layout(std140,binding=0) uniform Params {
    mat4 correction;
    vec4 canvas;
    vec4 image;
    vec4 view;
    vec4 options;
    vec4 channelMap;
} p;
layout(binding=1) uniform sampler2D sourcePixels;
bool invalid(float v) { return isnan(v)||isinf(v); }
float srgb(float v) {
    if(invalid(v))return v;
    if(v<=0.0)return 0.0;
    if(v>=1.0)return 1.0;
    return v<=0.0031308 ? 12.92*v : 1.055*pow(v,1.0/2.4)-0.055;
}
void main() {
    float scale=min(p.canvas.x/p.image.x,p.canvas.y/p.image.y)*p.view.x;
    vec2 pos=(uv*p.canvas.xy-p.canvas.xy*0.5-p.view.yz*p.canvas.zw)/(p.image.xy*scale)+0.5;
    if(any(lessThan(pos,vec2(0.0)))||any(greaterThanEqual(pos,vec2(1.0)))) {
        fragColor=vec4(0.0);return;
    }
    ivec2 texel=min(ivec2(pos*p.image.xy),ivec2(p.image.xy)-ivec2(1));
    vec4 stored=texelFetch(sourcePixels,texel,0);
    vec4 raw=vec4(1.0);
    for(int c=0;c<4;++c){int channel=int(p.channelMap[c]);if(channel>=0)raw[c]=stored[channel];}
    vec3 rgb=raw.rgb;
    if(p.options.y>0.5&&raw.a>0.0)rgb/=raw.a;
    if(p.options.x>0.5)rgb=vec3(srgb(rgb.r*p.image.z),srgb(rgb.g*p.image.z),srgb(rgb.b*p.image.z));
    if(any(isnan(rgb))||any(isinf(rgb)))rgb=vec3(1.0,0.0,1.0);
    rgb=clamp(rgb,0.0,1.0);
    if(p.options.y>0.5) {
        float a=invalid(raw.a)?0.0:clamp(raw.a,0.0,1.0);
        float bg=((texel.x/12+texel.y/12)%2)==0?0.18:0.28;
        rgb=rgb*a+vec3(bg)*(1.0-a);
    }
    fragColor=vec4(rgb,1.0);
}
