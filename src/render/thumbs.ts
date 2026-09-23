import * as THREE from 'three';
import { getPart } from '../data/parts';
import { partMesh } from './parts';

const cache = new Map<string, string>();

/** Little rendered portraits of parts for the workbench tray. */
export function partThumb(renderer: THREE.WebGLRenderer, defId: string, size = 128): string {
  const hit = cache.get(defId);
  if (hit) return hit;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x886644, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(2, 3, 2);
  scene.add(sun);
  const g = partMesh(defId);
  const str = g.getObjectByName('string');
  if (str) str.visible = false;
  const def = getPart(defId);
  if (def.link) g.scale.setScalar(1.6);
  scene.add(g);
  const box = new THREE.Box3().setFromObject(g);
  const c = box.getCenter(new THREE.Vector3());
  const r = box.getSize(new THREE.Vector3()).length() * 0.5 || 0.2;
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  const dir = new THREE.Vector3(1, 0.8, 1.3).normalize();
  cam.position.copy(c).addScaledVector(dir, r / Math.sin((15 * Math.PI) / 180));
  cam.lookAt(c);
  const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  const px = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearAlpha(prevClear);
  rt.dispose();
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    // flip vertically, and linear -> sRGB so thumbnails match the scene
    const row = px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4);
    for (let i = 0; i < row.length; i += 4) {
      for (let c = 0; c < 3; c++) row[i + c] = Math.round(Math.pow(row[i + c] / 255, 1 / 2.2) * 255);
    }
    img.data.set(row, y * size * 4);
  }
  ctx.putImageData(img, 0, 0);
  const url = cv.toDataURL();
  cache.set(defId, url);
  return url;
}
