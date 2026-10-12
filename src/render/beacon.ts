import * as THREE from 'three';

/**
 * "Over here": a soft column of light with a bobbing arrow and a ripple on the
 * ground. The coach plants it where the next step happens (the junk pile, the
 * lab door, the wagon) so the kid can find it from across the yard.
 */
export class Beacon {
  group = new THREE.Group();
  private arrow: THREE.Mesh;
  private ring: THREE.Mesh;
  private column: THREE.Mesh;
  private t = 0;
  private target = new THREE.Vector3();
  private shown = 0;

  constructor(scene: THREE.Scene, color = 0xffa53a) {
    const glow = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
    this.column = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 3.2, 24, 1, true), glow);
    this.column.position.y = 1.6;
    const solid = new THREE.MeshBasicMaterial({ color, fog: false });
    const cone = new THREE.ConeGeometry(0.2, 0.34, 4);
    cone.rotateX(Math.PI);
    this.arrow = new THREE.Mesh(cone, solid);
    this.arrow.add(new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.4, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0x2f2418, side: THREE.BackSide, fog: false })));
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, fog: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 40).rotateX(-Math.PI / 2), ringMat);
    this.ring.position.y = 0.03;
    this.group.add(this.column, this.arrow, this.ring);
    this.group.visible = false;
    this.group.renderOrder = 2;
    scene.add(this.group);
  }

  /** Where it should stand, or null to fade it away. */
  set(at: THREE.Vector3 | null) {
    if (at) this.target.copy(at);
    if (at && !this.group.visible) this.group.position.copy(at);
    this.shown = at ? 1 : 0;
  }

  update(dt: number, still = false) {
    const g = this.group;
    const vis = THREE.MathUtils.damp(g.visible ? g.scale.x : 0, this.shown, 8, dt);
    g.visible = vis > 0.02;
    if (!g.visible) return;
    this.t += still ? 0 : dt;
    g.scale.setScalar(vis);
    g.position.lerp(this.target, 1 - Math.exp(-dt * 10));
    this.arrow.position.y = 1.45 + Math.sin(this.t * 3) * 0.12;
    this.arrow.rotation.y = this.t * 1.5;
    const u = (this.t * 0.7) % 1;
    this.ring.scale.setScalar(0.6 + u * 1.2);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - u);
  }
}
