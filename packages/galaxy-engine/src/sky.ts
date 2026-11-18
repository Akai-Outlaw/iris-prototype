import * as T from "three";
export function createSky() {
  const scene = new T.Scene(),
    camera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const material = new T.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      time: { value: 0 },
      resolution: { value: new T.Vector2(1, 1) },
      response: { value: 0 },
      octaves: { value: 5 },
    },
    vertexShader:
      "varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }",
    fragmentShader: `varying vec2 vUv;uniform vec2 resolution;uniform float time;uniform float response;uniform int octaves;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;mat2 r=mat2(.8,-.6,.6,.8);for(int i=0;i<5;i++){if(i>=octaves)break;v+=a*noise(p);p=r*p*2.02+3.1;a*=.5;}return v;}
void main(){vec2 p=(vUv-.5)*vec2(resolution.x/resolution.y,1.);float t=time*.006;
float a=fbm(p*3.+vec2(t,-t)),b=fbm(p*4.-vec2(t*.6,t*.2)+7.),c=fbm(p*2.+vec2(t*.4,t)+19.);
vec3 color=vec3(.008,.014,.035);color+=vec3(.015,.045,.105)*pow(smoothstep(.35,.78,a),2.);color+=vec3(.07,.02,.12)*pow(smoothstep(.42,.85,b),2.);color+=vec3(.01,.07,.09)*pow(smoothstep(.47,.85,c),3.);
vec2 grid=p*310.,cell=floor(grid),f=fract(grid)-.5;float h=hash(cell);float star=exp(-dot(f,f)*170.)*step(.987,h);star*=.45+.2*sin(time*.35+h*100.);color+=vec3(.55,.7,1.)*star;
vec2 g2=p*90.,c2=floor(g2),q=fract(g2)-.5;float h2=hash(c2+41.);color+=vec3(.65,.8,1.)*exp(-dot(q,q)*80.)*step(.997,h2)*.65;
float bloom=exp(-dot(p,p)*6.);color+=vec3(.015,.045,.09)*bloom*(1.+response*.8);color*=.75+.25*smoothstep(.95,.2,length(vUv-.5));gl_FragColor=vec4(color,1.);}`,
  });
  scene.add(new T.Mesh(new T.PlaneGeometry(2, 2), material));
  return { scene, camera, material };
}
