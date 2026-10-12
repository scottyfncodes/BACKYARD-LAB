import * as THREE from 'three';

const MAX = 240;
const SPACING = 0.12;

/**
 * Where something went: a dotted path that stays behind it (the shape of the
 * motion is the physics), and a little tag at the end with the number that
 * matters ("0.9 m"). Cheap: one instanced mesh and one sprite.
 */
export class Trail {
  group = new THREE.Group();
  private dots: THREE.InstancedMesh;
  private tag: THREE.Sprite;
  private tagCanvas: HTMLCanvasElement;
  private tagTex: THREE.CanvasTexture;
  private n = 0;
  private last: THREE.Vector3 | null = null;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private grow: number[] = [];
  /** Beads before this one have finished popping in. */
  private growFrom = 0;
  private tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene, color = 0xfff1a8) {
    // Little beads: readable from any angle, on the floor or up in the air.
    const disc = new THREE.IcosahedronGeometry(0.03, 0);
    this.dots = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, fog: false }), MAX);
    this.dots.count = 0;
    this.dots.frustumCulled = false;
    this.dots.renderOrder = 3;
    this.tagCanvas = document.createElement('canvas');
    this.tagCanvas.width = 256;
    this.tagCanvas.height = 96;
    this.tagTex = new THREE.CanvasTexture(this.tagCanvas);
    this.tagTex.colorSpace = THREE.SRGBColorSpace;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tagTex, depthTest: false, transparent: true, fog: false }));
    this.tag.scale.set(0.5, 0.19, 1);
    this.tag.renderOrder = 4;
    this.tag.visible = false;
    this.group.add(this.dots, this.tag);
    this.group.visible = false;
    scene.add(this.group);
  }

  clear() {
    this.n = 0;
    this.dots.count = 0;
    this.last = null;
    this.grow = [];
    this.growFrom = 0;
    this.tag.visible = false;
    this.group.visible = false;
  }

  /** Follow a point; drops a bead every few centimetres. With `ground`, the beads sit on the floor under it. */
  add(p: THREE.Vector3, ground: number | null = null) {
    this.group.visible = true;
    if (this.last && this.last.distanceToSquared(p) < SPACING * SPACING) return;
    if (this.n >= MAX) return;
    this.last = p.clone();
    this.q.identity();
    this.m.compose(new THREE.Vector3(p.x, ground === null ? p.y : ground + 0.03, p.z), this.q, this.s.setScalar(0.01));
    this.dots.setMatrixAt(this.n, this.m);
    this.grow[this.n] = 0;
    this.n++;
    this.dots.count = this.n;
    this.dots.instanceMatrix.needsUpdate = true;
  }

  /** The tag at the end: the measurement, hovering over where it stopped. */
  label(text: string, at: THREE.Vector3, good = true) {
    const c = this.tagCanvas.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, 256, 96);
    c.fillStyle = good ? '#3aa65a' : '#ff8a1a';
    c.strokeStyle = '#2f2418';
    c.lineWidth = 8;
    c.beginPath();
    if (c.roundRect) c.roundRect(6, 6, 244, 72, 24);
    else c.rect(6, 6, 244, 72);
    c.fill();
    c.stroke();
    c.fillStyle = '#fff';
    c.font = '900 44px ui-rounded, "Nunito", "Trebuchet MS", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, 128, 44);
    this.tagTex.needsUpdate = true;
    this.tag.position.copy(at).setY(at.y + 0.55);
    this.tag.visible = true;
    this.group.visible = true;
  }

  update(dt: number) {
    if (!this.group.visible) return;
    // New dots pop in, so the path draws itself behind the machine.
    let dirty = false;
    while (this.growFrom < this.n && this.grow[this.growFrom] >= 1) this.growFrom++;
    for (let i = this.growFrom; i < this.n; i++) {
      if (this.grow[i] >= 1) continue;
      this.grow[i] = Math.min(1, this.grow[i] + dt * 6);
      this.dots.getMatrixAt(i, this.m);
      const pos = this.tmp.setFromMatrixPosition(this.m);
      const k = 1 - Math.pow(1 - this.grow[i], 3);
      this.m.compose(pos, this.q.identity(), this.s.setScalar(Math.max(0.01, k)));
      this.dots.setMatrixAt(i, this.m);
      dirty = true;
    }
    if (dirty) this.dots.instanceMatrix.needsUpdate = true;
  }
}
