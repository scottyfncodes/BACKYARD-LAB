import type { Vector3 } from 'three';
import type { MaterialId } from '../data/materials';

/** Everything the simulation reports to audio, effects, HUD and the run journal. */
export type SimEvent =
  | { type: 'impact'; pos: Vector3; mat: MaterialId; other: MaterialId; impulse: number }
  | { type: 'break'; pos: Vector3; machine: number; part: string; other: string; joint: string }
  | { type: 'snap'; pos: Vector3; machine: number; part: string }
  | { type: 'stick'; pos: Vector3; machine: number }
  | { type: 'unstick'; pos: Vector3; machine: number }
  | { type: 'suck'; pos: Vector3; machine: number }
  | { type: 'unsnag'; pos: Vector3; tag: string }
  | { type: 'live'; pos: Vector3; machine: number }
  | { type: 'ignite'; pos: Vector3; machine: number }
  | { type: 'click'; pos: Vector3; machine: number }
  | { type: 'ding'; pos: Vector3; machine: number }
  | { type: 'toggle'; pos: Vector3; machine: number; on: boolean }
  | { type: 'brownout'; pos: Vector3; machine: number }
  | { type: 'batteryDead'; pos: Vector3; machine: number }
  | { type: 'bounce'; pos: Vector3; speed: number }
  | { type: 'pickup'; pos: Vector3; part: string }
  | { type: 'drop'; pos: Vector3; part: string }
  | { type: 'throw'; pos: Vector3; part: string }
  | { type: 'jump'; pos: Vector3 }
  | { type: 'land'; pos: Vector3; speed: number };
