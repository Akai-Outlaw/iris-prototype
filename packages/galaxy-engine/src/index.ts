import * as T from "three";
import type {
  AgentVisualState,
  AudioFeatures,
  OrbState,
  SpecialistId,
} from "@iris/contracts";
import { stateTargets, palette } from "@iris/design-tokens";
import { clamp, ease } from "./math";
import { createSky } from "./sky";
import { createNetwork } from "./network";
import simplex from "./simplex.glsl?raw";
export type Quality = "auto" | "high" | "low";
const vertex = `${simplex}
uniform float time; uniform float energy; uniform float bass; uniform float treble; uniform float amplitude; uniform float lowQuality; varying vec3 vNormal; varying vec3 vPosition;
void main(){float n=snoise(position*2.+time*.15)*.5+snoise(position*4.-time*.12)*.3;if(lowQuality<.5)n+=snoise(position*8.+time*.2)*.2*energy;float wave=sin(position.y*12.-time*4.)*(energy*.05+bass*.035);vec3 p=position*(1.+clamp(n*amplitude+sin(time*.7)*.018+wave+treble*.008,-.45,.45));vNormal=normalize(normalMatrix*normal);vPosition=(modelViewMatrix*vec4(p,1.)).xyz;gl_Position=projectionMatrix*vec4(vPosition,1.);}`;
const fragment = `uniform vec3 color;uniform float opacity;varying vec3 vNormal;varying vec3 vPosition;void main(){float f=pow(1.-abs(dot(normalize(vNormal),normalize(-vPosition))),1.8);gl_FragColor=vec4(color,opacity*(.28+f*.72));}`;
const haloFragment = `uniform vec3 color;uniform float opacity;varying vec3 vNormal;varying vec3 vPosition;void main(){float f=pow(1.-abs(dot(normalize(vNormal),normalize(-vPosition))),4.);gl_FragColor=vec4(color,f*opacity*.26);}`;
export class GalaxyEngine {
  private renderer: T.WebGLRenderer;
  private scene = new T.Scene();
  private camera = new T.PerspectiveCamera(45, 1, 0.1, 100);
  private sky = createSky();
  private network = createNetwork();
  private satellites: T.Mesh<T.IcosahedronGeometry, T.MeshBasicMaterial>[] = [];
  private agentStates: readonly AgentVisualState[] = [];
  private active?: SpecialistId;
  private starts = new Map<SpecialistId, number>();
  private serial = 0;
  private pointer = new T.Vector2();
  private raycaster = new T.Raycaster();
  private onClick = (event: PointerEvent) => {
    const box = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - box.left) / box.width) * 2 - 1,
      (-(event.clientY - box.top) / box.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.satellites)[0];
    if (hit) this.select?.(hit.object.userData.id);
  };
  private orb: T.Mesh<T.IcosahedronGeometry, T.ShaderMaterial>;
  private halo: T.Mesh;
  private rings: T.Group;
  private frame = 0;
  private last = 0;
  private clock = 0;
  private state: OrbState = "idle";
  private reduced = false;
  private quality: Quality = "auto";
  private low = false;
  private energy = 0;
  private audio?: AudioFeatures;
  private destroyed = false;
  private hidden = false;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private frames = 0;
  private fps = 0;
  private sampleTime = 0;
  private slowTime = 0;
  private warm = 0;
  private onLost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(this.frame);
    this.onAvailability?.(false);
  };
  private onRestored = () => {
    this.onAvailability?.(true);
    this.last = 0;
    this.frame = requestAnimationFrame(this.tick);
  };
  private onVisibility = () => {
    this.hidden = document.hidden;
    cancelAnimationFrame(this.frame);
    this.last = 0;
    if (!this.hidden && !this.destroyed)
      this.frame = requestAnimationFrame(this.tick);
  };
  onAvailability?: (available: boolean) => void;
  constructor(
    private canvas: HTMLCanvasElement,
    private select?: (id: SpecialistId) => void,
    private frozen = false,
    private layer = 5,
    private demo = false,
  ) {
    this.renderer = new T.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(palette.background);
    this.renderer.autoClear = false;
    this.camera.position.set(0, 0, 4.9);
    const uniforms = {
      time: { value: 0 },
      energy: { value: 0 },
      bass: { value: 0 },
      treble: { value: 0 },
      lowQuality: { value: 0 },
      amplitude: { value: 0.055 },
      color: { value: new T.Color(palette.blue) },
      opacity: { value: 0.6 },
    };
    this.orb = new T.Mesh(
      new T.IcosahedronGeometry(1, 8),
      new T.ShaderMaterial({
        uniforms,
        vertexShader: vertex,
        fragmentShader: fragment,
        wireframe: true,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
      }),
    );
    this.orb.rotation.set(0.3, 0.2, -0.08);
    this.scene.add(this.orb);
    this.halo = new T.Mesh(
      new T.IcosahedronGeometry(1.05, 3),
      new T.ShaderMaterial({
        uniforms: { ...uniforms, opacity: { value: 0.36 } },
        vertexShader: vertex,
        fragmentShader: haloFragment,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        side: T.BackSide,
      }),
    );
    this.scene.add(this.halo);
    this.rings = new T.Group();
    for (let i = 0; i < 3; i++) {
      const points = Array.from(
        { length: 181 },
        (_, j) =>
          new T.Vector3(
            Math.cos((j / 180) * Math.PI * 2) * (1.48 + i * 0.12),
            Math.sin((j / 180) * Math.PI * 2) * (1.48 + i * 0.12),
            0,
          ),
      );
      const line = new T.Line(
        new T.BufferGeometry().setFromPoints(points),
        new T.LineBasicMaterial({
          color: i === 1 ? palette.cyan : palette.blue,
          transparent: true,
          opacity: 0.13,
          depthWrite: false,
        }),
      );
      line.rotation.set(0.85 + i * 0.55, i * 0.8, i * 0.7);
      this.rings.add(line);
    }
    this.scene.add(this.rings);
    for (const [i, id] of (
      ["coding", "research", "file-task"] as const
    ).entries()) {
      const satellite = new T.Mesh(
        new T.IcosahedronGeometry(0.105, 2),
        new T.MeshBasicMaterial({
          color: [palette.cyan, palette.violet, "#89b8ff"][i],
          wireframe: true,
          transparent: true,
          opacity: 0.8,
        }),
      );
      satellite.userData.id = id;
      satellite.visible = this.layer >= 4;
      this.scene.add(satellite);
      this.satellites.push(satellite);
    }
    canvas.addEventListener("pointerup", this.onClick);
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.frame = requestAnimationFrame(this.tick);
  }
  setState(state: OrbState) {
    this.state = state;
  }
  setAudioFeatures(features: AudioFeatures) {
    this.audio = features;
  }
  setAgents(agents: readonly AgentVisualState[]) {
    for (const agent of agents)
      if (
        agent.status === "running" &&
        this.agentStates.find((old) => old.id === agent.id)?.status !==
          "running"
      )
        this.starts.set(agent.id, ++this.serial);
    this.agentStates = agents;
    const focused = agents.find((a) => a.selected && a.status === "running");
    this.active =
      focused?.id ??
      [...agents]
        .filter((a) => a.status === "running")
        .sort(
          (a, b) => (this.starts.get(b.id) ?? 0) - (this.starts.get(a.id) ?? 0),
        )[0]?.id;
  }
  setQuality(mode: Quality) {
    this.quality = mode;
    this.low = mode === "low";
    this.slowTime = 0;
    this.resize(this.width, this.height, this.dpr);
  }
  setReducedMotion(enabled: boolean) {
    this.reduced = enabled;
  }
  resize(width: number, height: number, pixelRatio: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = pixelRatio;
    this.renderer.setPixelRatio(this.low ? 1 : Math.min(2, pixelRatio));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.network.camera.aspect = this.camera.aspect;
    this.network.camera.updateProjectionMatrix();
    this.sky.material.uniforms.resolution.value.set(this.width, this.height);
    this.sky.material.uniforms.octaves.value = this.low ? 2 : 5;
    this.orb.material.uniforms.lowQuality.value = this.low ? 1 : 0;
    const detail = this.low ? 3 : 8;
    if (this.orb.geometry.parameters.detail !== detail) {
      this.orb.geometry.dispose();
      this.orb.geometry = new T.IcosahedronGeometry(1, detail);
    }
    this.network.material.uniforms.dpr.value = this.renderer.getPixelRatio();
    this.network.nodes.geometry.setDrawRange(0, this.low ? 55 : 96);
    this.network.dust.geometry.setDrawRange(0, this.low ? 180 : 540);
  }
  stats() {
    return {
      fps: Math.round(this.fps),
      quality: this.low ? "low" : "high",
      geometries: this.renderer.info.memory.geometries,
      contexts: this.destroyed ? 0 : 1,
    };
  }
  private tick = (now: number) => {
    if (this.destroyed || this.hidden) return;
    const dt = this.last ? clamp((now - this.last) / 1000, 0, 0.1) : 1 / 60;
    this.last = now;
    const target = stateTargets[this.state];
    if (!this.frozen) this.clock += dt * (this.reduced ? 0.03 : 1);
    const audio = this.audio,
      valid =
        audio?.available &&
        now - audio.timestampMs < 200 &&
        now >= audio.timestampMs &&
        (audio.source !== "demo" || this.demo);
    this.energy = ease(
      this.energy,
      valid ? clamp(audio.level) : 0,
      valid && audio.level > this.energy ? 36 : 5,
      dt,
    );
    const u = this.orb.material.uniforms;
    u.bass.value = ease(u.bass.value, valid ? clamp(audio.bass) : 0, 5, dt);
    u.treble.value = ease(
      u.treble.value,
      valid ? clamp(audio.treble) : 0,
      5,
      dt,
    );
    u.time.value = this.clock;
    u.energy.value = this.energy;
    u.amplitude.value = ease(
      u.amplitude.value,
      target.displacement + this.energy * 0.22,
      5,
      dt,
    );
    u.color.value.lerp(new T.Color(target.primary), 1 - Math.exp(-5 * dt));
    const playbackEnergy =
      this.state === "speaking" &&
      valid &&
      (audio.source === "playback" || (this.demo && audio.source === "demo"))
        ? this.energy
        : 0;
    const galaxy = this.network.material.uniforms.response;
    galaxy.value = ease(galaxy.value, playbackEnergy, 5, dt);
    this.network.lines.material.opacity = 0.12 + galaxy.value * 0.5;
    this.sky.material.uniforms.response.value = galaxy.value;
    this.network.group.scale.setScalar(1 + galaxy.value * 0.035);
    for (const [i, satellite] of this.satellites.entries()) {
      const phase = (i * Math.PI * 2) / 3 + this.clock * 0.08;
      const targetPosition =
        satellite.userData.id === this.active
          ? new T.Vector3(1.48, 0.28, 0.65)
          : new T.Vector3(
              Math.cos(phase) * 1.65,
              Math.sin(phase) * 0.8,
              Math.sin(phase + i) * 0.75,
            );
      satellite.position.lerp(
        targetPosition,
        this.frozen ? 1 : 1 - Math.exp(-3 * dt),
      );
      const agent = this.agentStates.find(
        (a) => a.id === satellite.userData.id,
      );
      satellite.material.opacity =
        agent?.selected || agent?.status === "running" ? 1 : 0.65;
      satellite.scale.setScalar(agent?.status === "running" ? 1.15 : 1);
      if (!this.reduced) satellite.rotation.y += dt * 0.2;
    }
    const haloUniforms = (this.halo.material as T.ShaderMaterial).uniforms;
    haloUniforms.opacity.value = ease(
      haloUniforms.opacity.value,
      target.glow,
      5,
      dt,
    );
    if (!this.frozen) {
      this.orb.rotation.y += dt * target.speed * (this.reduced ? 0.04 : 1);
      this.rings.rotation.y += dt * 0.025 * (this.reduced ? 0 : 1);
    }
    this.renderer.clear();
    if (this.layer >= 2) {
      this.sky.material.uniforms.time.value = this.clock;
      this.renderer.render(this.sky.scene, this.sky.camera);
    }
    if (this.layer >= 3) {
      if (!this.frozen && !this.reduced)
        this.network.group.rotation.y += dt * 0.006;
      this.renderer.render(this.network.scene, this.network.camera);
    }
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
    this.frames++;
    this.sampleTime += dt;
    this.warm += dt;
    if (this.sampleTime >= 1) {
      this.fps = this.frames / this.sampleTime;
      this.slowTime =
        this.warm > 4 && this.fps < 45 ? this.slowTime + this.sampleTime : 0;
      this.frames = 0;
      this.sampleTime = 0;
      if (this.quality === "auto" && this.slowTime >= 3 && !this.low) {
        this.low = true;
        this.resize(this.width, this.height, this.dpr);
      }
    }
    this.frame = requestAnimationFrame(this.tick);
  };
  dispose() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.canvas.removeEventListener("pointerup", this.onClick);
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    for (const scene of [this.scene, this.sky.scene, this.network.scene])
      scene.traverse((obj) => {
        const mesh = obj as T.Mesh;
        mesh.geometry?.dispose();
        if (mesh.material)
          for (const m of Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material])
            m.dispose();
      });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
