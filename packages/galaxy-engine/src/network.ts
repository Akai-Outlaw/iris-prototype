import * as T from "three";
import { constellation, random } from "./math";
export function createNetwork() {
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(60, 1, 0.1, 200);
  camera.position.z = 42;
  const group = new T.Group();
  scene.add(group);
  const data = constellation(),
    positions = new Float32Array(data.points.flat());
  const tint = ["#438ad8", "#7c9ded", "#9b7bc7"];
  const colors = new Float32Array(
    data.colors.flatMap((i) => new T.Color(tint[i]).toArray()),
  );
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.BufferAttribute(positions, 3));
  geo.setAttribute("color", new T.BufferAttribute(colors, 3));
  const material = new T.ShaderMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    uniforms: { response: { value: 0 }, dpr: { value: 1 } },
    vertexShader:
      "uniform float response;uniform float dpr; varying vec3 tint; void main(){tint=color;vec4 p=modelViewMatrix*vec4(position,1.);gl_PointSize=(100.+response*45.)*dpr/-p.z;gl_Position=projectionMatrix*p;}",
    fragmentShader:
      "varying vec3 tint;uniform float response;void main(){float d=length(gl_PointCoord-.5)*2.;float a=exp(-d*d*5.)*smoothstep(1.,.65,d);gl_FragColor=vec4(tint*(1.+response*.8),a*(.62+response*.35));}",
  });
  const nodes = new T.Points(geo, material);
  group.add(nodes);
  const edges = new T.BufferGeometry();
  edges.setAttribute(
    "position",
    new T.Float32BufferAttribute(
      data.edges.flatMap(([i, j]) => [...data.points[i], ...data.points[j]]),
      3,
    ),
  );
  const lines = new T.LineSegments(
    edges,
    new T.LineBasicMaterial({
      color: "#4e77a9",
      opacity: 0.12,
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
    }),
  );
  group.add(lines);
  const rng = random(83),
    dustGeo = new T.BufferGeometry();
  dustGeo.setAttribute(
    "position",
    new T.Float32BufferAttribute(
      Array.from({ length: 540 }, () => [
        (rng() - 0.5) * 100,
        (rng() - 0.5) * 70,
        (rng() - 0.5) * 40,
      ]).flat(),
      3,
    ),
  );
  const dust = new T.Points(
    dustGeo,
    new T.PointsMaterial({
      color: "#7d92bd",
      size: 0.045,
      opacity: 0.25,
      transparent: true,
      depthWrite: false,
    }),
  );
  scene.add(dust);
  return { scene, camera, group, nodes, material, lines, dust };
}
