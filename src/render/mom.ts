import * as THREE from 'three';
import { WORLD } from '../data/world';
import { M } from './materials';

/**
 * Mom, glimpsed through the kitchen window. She comes and goes, keeps an eye on
 * the yard, waves when something works and throws her hands up when something
 * goes BANG. Just set dressing: she never touches the simulation.
 */
const house = WORLD.solids.find((s) => s.vis === 'house')!;
/** The ground-floor window nearest the deck (the kitchen). */
export const KITCHEN = new THREE.Vector3(house.pos[0] + 3, 1.6, house.pos[2] + house.half![2] + 0.01);
const HALF_W = 0.55;

export class Mom {
  group = new THREE.Group();
  private figure = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private x = 0;
  private goal = 0;
  private visible = 1;
  private wantVisible = true;
  private wanderT = 4;
  private waveT = 0;
  private alarmT = 0;

  constructor(scene: THREE.Scene) {
    const z = KITCHEN.z;
    // A warm, lit kitchen behind the glass.
    const room = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, 0.9), new THREE.MeshBasicMaterial({ color: 0xffe2a8 }));
    room.position.set(KITCHEN.x, KITCHEN.y, z + 0.05);
    const cabinet = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, 0.22), new THREE.MeshBasicMaterial({ color: 0xc98f5a }));
    cabinet.position.set(KITCHEN.x, KITCHEN.y + 0.34, z + 0.055);
    this.group.add(room, cabinet);
    // Mom: hair, face, shirt, arms on shoulder pivots.
    // Only ever seen through the glass: clip her to the window opening (needs renderer.localClippingEnabled).
    const clippingPlanes = [
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -(KITCHEN.y - 0.45)),
      new THREE.Plane(new THREE.Vector3(0, -1, 0), KITCHEN.y + 0.45),
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -(KITCHEN.x - HALF_W)),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), KITCHEN.x + HALF_W),
    ];
    const skin = new THREE.MeshBasicMaterial({ color: 0xe8b48c, clippingPlanes });
    const shirt = new THREE.MeshBasicMaterial({ color: 0x2f9e8f, clippingPlanes });
    const hair = new THREE.MeshBasicMaterial({ color: 0x5a3220, clippingPlanes });
    const part = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, parent: THREE.Object3D = this.figure, zz = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, zz);
      parent.add(mesh);
      return mesh;
    };
    part(new THREE.BoxGeometry(0.36, 0.5, 0.02), shirt, 0, -0.27);
    part(new THREE.BoxGeometry(0.07, 0.07, 0.02), skin, 0, 0.0);
    part(new THREE.SphereGeometry(0.11, 12, 10), hair, 0, 0.15, this.figure, -0.01);
    part(new THREE.SphereGeometry(0.095, 12, 10), skin, 0, 0.13, this.figure, 0.015).scale.z = 0.4;
    part(new THREE.BoxGeometry(0.12, 0.18, 0.02), hair, 0, 0.05, this.figure, -0.02);
    for (const [arm, s] of [
      [this.armL, -1],
      [this.armR, 1],
    ] as const) {
      arm.position.set(s * 0.2, -0.08, 0.012);
      part(new THREE.BoxGeometry(0.07, 0.34, 0.02), shirt, 0, -0.15, arm);
      part(new THREE.BoxGeometry(0.07, 0.08, 0.02), skin, 0, -0.34, arm);
      this.figure.add(arm);
    }
    this.figure.position.set(KITCHEN.x, KITCHEN.y - 0.05, z + 0.07);
    this.group.add(this.figure);
    // Glass and a fresh frame in front of it all.
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF_W * 2, 0.9),
      new THREE.MeshStandardMaterial({ color: 0xbfe0f5, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.2, depthWrite: false }),
    );
    glass.position.set(KITCHEN.x, KITCHEN.y, z + 0.1);
    this.group.add(glass);
    const frame = M.plastic(0xffffff);
    for (const [w, hh, x, y] of [
      [1.3, 0.1, 0, 0.5],
      [1.3, 0.1, 0, -0.5],
      [0.1, 1.1, -0.6, 0],
      [0.1, 1.1, 0.6, 0],
      [0.04, 0.9, 0, 0],
    ]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, hh, 0.06), frame);
      b.position.set(KITCHEN.x + x, KITCHEN.y + y, z + 0.11);
      this.group.add(b);
    }
    scene.add(this.group);
  }

  /** Pop to the window and wave for a bit. */
  wave(secs = 3) {
    this.wantVisible = true;
    this.waveT = secs;
    this.wanderT = secs + 6;
  }

  /** WHAT WAS THAT: rush to the window, hands up. */
  alarm() {
    this.wantVisible = true;
    this.alarmT = 2.2;
    this.goal = 0;
    this.wanderT = 8;
  }

  update(dt: number, time: number) {
    this.wanderT -= dt;
    if (this.wanderT <= 0) {
      // Doing things around the kitchen: drift across, or step away for a while.
      if (this.wantVisible && Math.random() < 0.3) {
        this.wantVisible = false;
        this.wanderT = 6 + Math.random() * 10;
      } else {
        this.wantVisible = true;
        this.goal = (Math.random() * 2 - 1) * 0.3;
        this.wanderT = 4 + Math.random() * 6;
      }
    }
    this.visible += ((this.wantVisible ? 1 : 0) - this.visible) * Math.min(1, dt * 3);
    this.x += (this.goal - this.x) * Math.min(1, dt * 1.5);
    // Stepping out of view = sliding down below the sill.
    this.figure.position.x = KITCHEN.x + this.x;
    this.figure.position.y = KITCHEN.y - 0.05 - (1 - this.visible) * 0.95;
    this.figure.rotation.z = Math.sin(time * 1.3) * 0.03;
    let l = 0.1;
    let r = -0.1;
    if (this.waveT > 0) {
      this.waveT -= dt;
      r = 2.6 + Math.sin(time * 12) * 0.45;
    }
    if (this.alarmT > 0) {
      this.alarmT -= dt;
      l = -2.7 + Math.sin(time * 20) * 0.1;
      r = 2.7 + Math.sin(time * 20) * 0.1;
    }
    this.armL.rotation.z += (l - this.armL.rotation.z) * Math.min(1, dt * 10);
    this.armR.rotation.z += (r - this.armR.rotation.z) * Math.min(1, dt * 10);
  }
}
