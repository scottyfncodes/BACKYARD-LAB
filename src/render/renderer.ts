import * as THREE from 'three';

export interface Quality {
  pixelRatio: number;
  shadows: boolean;
  shadowSize: number;
  grass: number;
  mobile: boolean;
}

export function detectQuality(): Quality {
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'low') return { mobile, pixelRatio: 1, shadows: false, shadowSize: 512, grass: 0 };
  return {
    mobile,
    pixelRatio: Math.min(window.devicePixelRatio || 1, mobile ? 2 : 2),
    shadows: true,
    shadowSize: mobile ? 1024 : 2048,
    grass: mobile ? 7000 : 16000,
  };
}

/** Three.js setup: warm late-afternoon light, soft sky, fog. */
export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  private sunOffset = new THREE.Vector3(-14, 22, 16);

  constructor(
    public canvas: HTMLCanvasElement,
    public quality: Quality,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !quality.mobile || quality.pixelRatio < 2, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(quality.pixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.03, 400);
    this.scene.fog = new THREE.Fog(0xf3d9b0, 45, 140);
    this.scene.add(this.sky());

    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x6b7a3a, 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffe0b0, 2.6);
    this.sun.castShadow = quality.shadows;
    this.sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    const s = this.sun.shadow.camera;
    s.left = -18;
    s.right = 18;
    s.top = 18;
    s.bottom = -18;
    s.near = 1;
    s.far = 80;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    const fill = new THREE.DirectionalLight(0xb0c8ff, 0.35);
    fill.position.set(20, 10, -10);
    this.scene.add(fill);
    this.resize();
  }

  private sky(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(300, 32, 16);
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x5f9fe0) },
        mid: { value: new THREE.Color(0xa9d0f0) },
        horizon: { value: new THREE.Color(0xffd9a8) },
        sunDir: { value: this.sunOffset.clone().normalize() },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
        void main(){
          float h = vDir.y;
          vec3 c = mix(horizon, mid, smoothstep(-0.02, 0.18, h));
          c = mix(c, top, smoothstep(0.18, 0.75, h));
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          c += vec3(1.0, 0.85, 0.6) * pow(s, 64.0) * 0.8 + vec3(1.0,0.8,0.5) * pow(s, 6.0) * 0.18;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    return mesh;
  }

  /** Keep the shadow frustum centred on whatever we are looking at. */
  followShadows(focus: THREE.Vector3) {
    const snap = 2;
    const fx = Math.round(focus.x / snap) * snap;
    const fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + this.sunOffset.x, this.sunOffset.y, fz + this.sunOffset.z);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep a sensible horizontal field of view in portrait.
    const hfov = 90;
    const vfovFromH = (2 * Math.atan(Math.tan((hfov * Math.PI) / 360) / this.camera.aspect) * 180) / Math.PI;
    this.camera.fov = Math.min(95, Math.max(62, vfovFromH));
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
