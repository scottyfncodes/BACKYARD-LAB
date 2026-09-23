/**
 * Physical materials. Every collider in the game gets one of these, and the
 * audio system uses the same id to decide what an impact sounds like.
 */
export type MaterialId =
  | 'wood'
  | 'metal'
  | 'plastic'
  | 'rubber'
  | 'fabric'
  | 'foam'
  | 'roller'
  | 'bouncy'
  | 'grass'
  | 'dirt'
  | 'concrete'
  | 'player';

export interface MaterialDef {
  friction: number;
  restitution: number;
  /** Timbre hints for the procedural impact synth. */
  sound: { pitch: number; decay: number; noise: number; ring: number };
}

export const MATERIALS: Record<MaterialId, MaterialDef> = {
  wood: { friction: 0.6, restitution: 0.2, sound: { pitch: 180, decay: 0.12, noise: 0.5, ring: 0.2 } },
  metal: { friction: 0.4, restitution: 0.25, sound: { pitch: 620, decay: 0.35, noise: 0.25, ring: 0.9 } },
  plastic: { friction: 0.45, restitution: 0.35, sound: { pitch: 420, decay: 0.08, noise: 0.6, ring: 0.3 } },
  rubber: { friction: 1.0, restitution: 0.55, sound: { pitch: 110, decay: 0.1, noise: 0.3, ring: 0.1 } },
  fabric: { friction: 0.8, restitution: 0.05, sound: { pitch: 90, decay: 0.05, noise: 0.9, ring: 0.0 } },
  foam: { friction: 0.7, restitution: 0.3, sound: { pitch: 140, decay: 0.05, noise: 0.8, ring: 0.0 } },
  // Skateboard / caster wheels modelled as low-friction contacts so they glide.
  roller: { friction: 0.03, restitution: 0.1, sound: { pitch: 260, decay: 0.08, noise: 0.4, ring: 0.3 } },
  bouncy: { friction: 0.8, restitution: 0.92, sound: { pitch: 70, decay: 0.2, noise: 0.2, ring: 0.5 } },
  grass: { friction: 0.75, restitution: 0.15, sound: { pitch: 80, decay: 0.06, noise: 1.0, ring: 0.0 } },
  dirt: { friction: 0.8, restitution: 0.1, sound: { pitch: 70, decay: 0.07, noise: 1.0, ring: 0.0 } },
  concrete: { friction: 0.7, restitution: 0.2, sound: { pitch: 240, decay: 0.07, noise: 0.8, ring: 0.1 } },
  player: { friction: 0.0, restitution: 0.0, sound: { pitch: 100, decay: 0.06, noise: 0.9, ring: 0.0 } },
};
