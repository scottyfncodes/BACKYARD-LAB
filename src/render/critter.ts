import * as THREE from 'three';
import { M } from './materials';

/** Biscuit: a scruffy low-poly terrier. Body along +Z, nose forward. */
export function dogMesh(): THREE.Group {
  const g = new THREE.Group();
  const fur = M.matte(0xd9b27a);
  const dark = M.matte(0x6b4a2a);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.42), fur);
  body.position.y = 0.26;
  body.name = 'body';
  const head = new THREE.Group();
  head.name = 'head';
  head.position.set(0, 0.4, 0.26);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.16), fur);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.1), fur);
  snout.position.set(0, -0.03, 0.12);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.03), M.matte(0x1a1a1a));
  nose.position.set(0, -0.01, 0.175);
  head.add(skull, snout, nose);
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.03), dark);
    ear.position.set(sx * 0.08, 0.08, -0.03);
    ear.rotation.z = -sx * 0.3;
    head.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5), M.matte(0x111111));
    eye.position.set(sx * 0.05, 0.02, 0.085);
    head.add(eye);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.16), dark);
  tail.position.set(0, 0.1, -0.06);
  tail.rotation.x = -0.9;
  const tailPivot = new THREE.Group();
  tailPivot.name = 'tail';
  tailPivot.position.set(0, 0.32, -0.21);
  tailPivot.add(tail);
  const legs = new THREE.Group();
  legs.name = 'legs';
  for (const [x, z] of [[-0.07, 0.14], [0.07, 0.14], [-0.07, -0.14], [0.07, -0.14]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.05), z > 0 ? fur : dark);
    leg.position.set(x, 0.08, z);
    leg.name = z > 0 ? 'front' : 'back';
    legs.add(leg);
  }
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 6, 14), M.plastic(0xd33a2c));
  collar.position.set(0, 0.34, 0.2);
  g.add(body, head, tailPivot, legs, collar);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return g;
}

/** Wag, bob and trot. `gait` is 0 (standing) to 1 (flat out), `t` is time. */
export function animateDog(g: THREE.Group, gait: number, t: number) {
  const tail = g.getObjectByName('tail');
  if (tail) tail.rotation.y = Math.sin(t * (6 + gait * 10)) * 0.6;
  const legs = g.getObjectByName('legs');
  if (legs) {
    legs.children.forEach((leg, i) => {
      const phase = i % 2 === 0 ? 0 : Math.PI;
      leg.rotation.x = Math.sin(t * 14 + phase) * 0.7 * gait;
    });
  }
  const body = g.getObjectByName('body');
  if (body) body.position.y = 0.26 + Math.abs(Math.sin(t * 14)) * 0.03 * gait;
  const head = g.getObjectByName('head');
  if (head) head.rotation.x = -0.1 + Math.sin(t * 2.3) * 0.05 + gait * 0.15;
}
