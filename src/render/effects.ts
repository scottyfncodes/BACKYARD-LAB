import * as THREE from 'three';

/** A single pooled particle system for dust, sparks, chips, smoke, confetti, wind. */
export type FxKind = 'dust' | 'spark' | 'chip' | 'smoke' | 'confetti' | 'air' | 'flame' | 'water';

interface P {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  grow: number;
  color: THREE.Color;
  gravity: number;
  drag: number;
  alpha: number;
}

const MAX = 1600;

export class Effects {
  points: THREE.Points;
  private ps: P[] = [];
  private geo: THREE.BufferGeometry;
  private posA: Float32Array;
  private colA: Float32Array;
  private sizeA: Float32Array;
  private alphaA: Float32Array;
  marks: THREE.InstancedMesh;
  private markAge: number[] = [];
  private markN = 0;

  constructor(scene: THREE.Scene) {
    this.geo = new THREE.BufferGeometry();
    this.posA = new Float32Array(MAX * 3);
    this.colA = new Float32Array(MAX * 3);
    this.sizeA = new Float32Array(MAX);
    this.alphaA = new Float32Array(MAX);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.posA, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colA, 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.sizeA, 1));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alphaA, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      uniforms: { scale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; varying vec3 vColor; varying float vAlpha; uniform float scale;
        void main(){ vColor = color; vAlpha = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vColor; varying float vAlpha;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard; gl_FragColor = vec4(vColor, vAlpha * (1.0 - r * 3.2)); }`,
    });
    this.points = new THREE.Points(this.geo, m);
    this.points.frustumCulled = false;
    scene.add(this.points);

    this.marks = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.05, 0.12), new THREE.MeshBasicMaterial({ color: 0x2a2014, transparent: true, opacity: 0.35, depthWrite: false }), 400);
    this.marks.count = 0;
    this.marks.frustumCulled = false;
    scene.add(this.marks);
  }

  setScale(h: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = h * 0.9;
  }

  emit(kind: FxKind, at: THREE.Vector3, n: number, opts: { dir?: THREE.Vector3; speed?: number; color?: number } = {}) {
    for (let i = 0; i < n; i++) {
      if (this.ps.length >= MAX) this.ps.shift();
      const r = () => Math.random() * 2 - 1;
      const dir = opts.dir ?? new THREE.Vector3(0, 1, 0);
      const sp = opts.speed ?? 1;
      const p: P = {
        pos: at.clone(),
        vel: new THREE.Vector3(),
        life: 0,
        max: 1,
        size: 0.05,
        grow: 0,
        color: new THREE.Color(0xffffff),
        gravity: 0,
        drag: 1,
        alpha: 1,
      };
      switch (kind) {
        case 'dust':
          p.vel.set(r() * 0.8, Math.random() * 0.7, r() * 0.8).multiplyScalar(sp);
          p.max = 0.8 + Math.random() * 0.6;
          p.size = 0.08 + Math.random() * 0.06;
          p.grow = 0.25;
          p.color.set(opts.color ?? 0xc9b48a);
          p.drag = 2.5;
          p.alpha = 0.55;
          break;
        case 'spark':
          p.vel.set(r() * 2, Math.random() * 2.5, r() * 2).multiplyScalar(sp);
          p.max = 0.3 + Math.random() * 0.3;
          p.size = 0.025;
          p.color.set(0xffd27a);
          p.gravity = 9;
          p.drag = 0.5;
          break;
        case 'chip':
          p.vel.set(r() * 2, 1 + Math.random() * 2.5, r() * 2).multiplyScalar(sp);
          p.max = 1.0 + Math.random() * 0.5;
          p.size = 0.04;
          p.color.set(opts.color ?? 0xb0844f);
          p.gravity = 9.8;
          p.drag = 0.3;
          break;
        case 'smoke':
          p.vel.copy(dir).multiplyScalar(sp * (0.5 + Math.random() * 0.5)).add(new THREE.Vector3(r() * 0.3, 0.3, r() * 0.3));
          p.max = 1.2 + Math.random();
          p.size = 0.12;
          p.grow = 0.6;
          p.color.set(0xe8e4dc);
          p.drag = 1.5;
          p.alpha = 0.5;
          break;
        case 'flame':
          p.vel.copy(dir).multiplyScalar(sp * (2 + Math.random() * 2)).add(new THREE.Vector3(r() * 0.4, r() * 0.4, r() * 0.4));
          p.max = 0.25;
          p.size = 0.09;
          p.grow = -0.2;
          p.color.set(Math.random() > 0.5 ? 0xffc25a : 0xff7a2a);
          p.drag = 1;
          break;
        case 'confetti':
          p.vel.set(r() * 3, 3 + Math.random() * 4, r() * 3);
          p.max = 2.5 + Math.random();
          p.size = 0.05;
          p.color.setHSL(Math.random(), 0.8, 0.55);
          p.gravity = 4;
          p.drag = 1.2;
          break;
        case 'air':
          p.vel.copy(dir).multiplyScalar(sp * (2.5 + Math.random()));
          p.pos.add(new THREE.Vector3(r() * 0.18, r() * 0.18, r() * 0.18));
          p.max = 0.8;
          p.size = 0.02;
          p.color.set(0xffffff);
          p.alpha = 0.5;
          p.drag = 0.4;
          break;
        case 'water':
          p.vel.copy(dir).multiplyScalar(sp).add(new THREE.Vector3(r() * 0.5, r() * 0.5, r() * 0.5));
          p.max = 1;
          p.size = 0.03;
          p.color.set(0x7fc4f0);
          p.gravity = 9.8;
          p.drag = 0.2;
          break;
      }
      this.ps.push(p);
    }
  }

  mark(at: THREE.Vector3, heading: THREE.Vector3) {
    const i = this.markN % 400;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(at.x, 0.012, at.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.atan2(heading.x, heading.z), 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
    this.marks.setMatrixAt(i, m);
    this.markAge[i] = 0;
    this.markN++;
    this.marks.count = Math.min(400, this.markN);
    this.marks.instanceMatrix.needsUpdate = true;
  }

  update(dt: number) {
    let n = 0;
    this.ps = this.ps.filter((p) => (p.life += dt) < p.max);
    for (const p of this.ps) {
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      if (p.gravity > 0 && p.pos.y < 0.01) {
        p.pos.y = 0.01;
        p.vel.multiplyScalar(0.3);
      }
      const t = p.life / p.max;
      this.posA.set([p.pos.x, p.pos.y, p.pos.z], n * 3);
      this.colA.set([p.color.r, p.color.g, p.color.b], n * 3);
      this.sizeA[n] = Math.max(0.005, p.size + p.grow * p.life);
      this.alphaA[n] = p.alpha * (1 - t) * Math.min(1, p.life * 20);
      n++;
    }
    this.geo.setDrawRange(0, n);
    (['position', 'color', 'size', 'alpha'] as const).forEach((k) => (this.geo.attributes[k].needsUpdate = true));
  }
}
