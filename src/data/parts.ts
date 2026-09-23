import type { MaterialId } from './materials';

/**
 * Data-driven part catalogue.
 *
 * A part is *only* data: collision shapes, mass, where it can be mounted, where
 * other parts can plug into it, and a list of generic behaviours. The engine
 * never checks a part id to decide what happens - it only reads these fields.
 * New junk can be added here without touching the simulation.
 *
 * Conventions (part-local space): +Y is up, +Z is "forward", metres / kg / N.
 */
export type V3 = [number, number, number];

export type JointKind = 'weld' | 'axle' | 'hinge' | 'driven' | 'tether';

export interface ShapeDef {
  kind: 'box' | 'cyl' | 'ball';
  half?: V3; // box
  r?: number; // cyl / ball
  halfH?: number; // cyl
  axis?: 'x' | 'y' | 'z'; // cyl axis (default y)
  pos?: V3;
  rot?: V3; // euler, degrees
  mat?: MaterialId;
  /** Relative share of the part's mass. Defaults to shape volume. */
  share?: number;
}

/** A place on THIS part that can be pressed against another part. */
export interface SocketDef {
  id: string;
  label: string;
  pos: V3;
  normal: V3; // points out of the part
  up?: V3; // tangent used as the spin reference
  joint?: 'weld' | 'axle' | 'tether';
  tether?: number; // string length for tether sockets
}

/** A special place on this part that OTHER parts can plug into. */
export interface TargetDef {
  id: string;
  label: string;
  pos: V3;
  normal: V3;
  joint: 'driven' | 'hinge' | 'reel';
  pivot?: V3;
  axis?: V3;
  radius?: number; // snap radius
}

export type BehaviorDef =
  | { type: 'motor'; torque: number; rpm: number; watts: number }
  | { type: 'thrust'; force: number; axis: V3; at?: V3; watts?: number; burn?: number }
  | { type: 'airflow'; axis: V3; at: V3; range: number; pressure: number; cone: number }
  | { type: 'suction'; axis: V3; at: V3; range: number; force: number; hold: number; watts: number; cone: number }
  | { type: 'buoyancy'; lift: number }
  | { type: 'battery'; energy: number; maxWatts: number }
  | { type: 'sticky'; hold: number }
  | { type: 'bounce'; boost: number }
  | { type: 'timer'; delay: number; options: number[] }
  | { type: 'pressure'; threshold: number }
  | { type: 'receiver' }
  | { type: 'winch'; speed: number; force: number; watts: number };

export interface LinkDef {
  kind: 'rope' | 'elastic' | 'spring';
  /** Rope: length. Elastic / spring: rest length. */
  length: number;
  lengthOptions?: number[];
  stiffness: number;
  damping: number;
  breakForce: number;
  /** Longest span the link can be installed across. */
  maxSpan: number;
  minLength?: number;
  radius: number; // visual thickness
}

export interface PartDef {
  id: string;
  name: string;
  /** Kid-voice thought when you look at it. */
  hint: string;
  /** Physical properties you can read off the object. */
  traits: string[];
  material: MaterialId;
  mass: number;
  shapes: ShapeDef[];
  sockets: SocketDef[];
  targets?: TargetDef[];
  /** Force (N) its attachments survive. */
  strength: number;
  behaviors: BehaviorDef[];
  link?: LinkDef;
  /** Aerodynamic drag area Cd*A (m^2). */
  drag?: number;
  linearDamping?: number;
  angularDamping?: number;
  visual: string;
  color?: number;
  buildable: boolean;
  stage: number;
}

const bucketWalls = (): ShapeDef[] => {
  const walls: ShapeDef[] = [
    { kind: 'cyl', r: 0.12, halfH: 0.012, pos: [0, -0.138, 0], share: 0.25 },
  ];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 0.132;
    walls.push({
      kind: 'box',
      half: [0.055, 0.15, 0.008],
      pos: [Math.sin(a) * r, 0, Math.cos(a) * r],
      rot: [0, (a * 180) / Math.PI, 0],
      share: 0.75 / n,
    });
  }
  return walls;
};

export const PARTS: PartDef[] = [
  {
    id: 'plank',
    name: 'Wooden Plank',
    hint: 'A lever. Or a ramp. Or a really long arm.',
    traits: ['long', 'rigid', 'lever'],
    material: 'wood',
    mass: 1.6,
    shapes: [{ kind: 'box', half: [0.6, 0.015, 0.075] }],
    sockets: [
      { id: 'flat', label: 'flat side', pos: [0, -0.015, 0], normal: [0, -1, 0], up: [1, 0, 0] },
      { id: 'end', label: 'end', pos: [-0.6, 0, 0], normal: [-1, 0, 0], up: [0, 1, 0] },
      { id: 'edge', label: 'edge', pos: [0, 0, -0.075], normal: [0, 0, -1], up: [1, 0, 0] },
    ],
    strength: 900,
    behaviors: [],
    drag: 0.05,
    visual: 'plank',
    color: 0xc79a62,
    buildable: true,
    stage: 1,
  },
  {
    id: 'crate',
    name: 'Old Crate',
    hint: 'Sturdy. Heavy. Something to build on.',
    traits: ['sturdy', 'heavy', 'stackable'],
    material: 'wood',
    mass: 3.5,
    shapes: [{ kind: 'box', half: [0.25, 0.2, 0.25] }],
    sockets: [
      { id: 'bottom', label: 'bottom', pos: [0, -0.2, 0], normal: [0, -1, 0], up: [0, 0, 1] },
      { id: 'side', label: 'side', pos: [0, 0, -0.25], normal: [0, 0, -1], up: [0, 1, 0] },
      { id: 'top', label: 'top', pos: [0, 0.2, 0], normal: [0, 1, 0], up: [0, 0, 1] },
    ],
    strength: 1600,
    behaviors: [],
    drag: 0.2,
    visual: 'crate',
    color: 0xa87a45,
    buildable: true,
    stage: 1,
  },
  {
    id: 'broom',
    name: 'Broom',
    hint: 'Long reach. Good for poking things you cannot get to.',
    traits: ['long reach', 'pole', 'pivot'],
    material: 'wood',
    mass: 0.9,
    shapes: [
      { kind: 'cyl', r: 0.016, halfH: 0.62, axis: 'x', pos: [-0.08, 0, 0], share: 0.55 },
      { kind: 'box', half: [0.05, 0.13, 0.035], pos: [0.6, 0, 0], mat: 'fabric', share: 0.45 },
    ],
    sockets: [
      { id: 'grip', label: 'handle end', pos: [-0.7, 0, 0], normal: [-1, 0, 0], up: [0, 1, 0] },
      { id: 'shaft', label: 'handle side', pos: [-0.2, -0.016, 0], normal: [0, -1, 0], up: [1, 0, 0] },
      { id: 'head', label: 'bristles', pos: [0.65, 0, 0], normal: [1, 0, 0], up: [0, 1, 0] },
    ],
    strength: 700,
    behaviors: [],
    drag: 0.04,
    visual: 'broom',
    buildable: true,
    stage: 1,
  },
  {
    id: 'skateboard',
    name: 'Skateboard',
    hint: 'Already has wheels. Rolls if you breathe on it.',
    traits: ['rolls', 'platform', 'chassis'],
    material: 'wood',
    mass: 2.2,
    shapes: [
      { kind: 'box', half: [0.4, 0.012, 0.105], pos: [0, 0.1, 0], share: 0.7 },
      { kind: 'ball', r: 0.028, pos: [0.27, 0.028, 0.075], mat: 'roller', share: 0.075 },
      { kind: 'ball', r: 0.028, pos: [0.27, 0.028, -0.075], mat: 'roller', share: 0.075 },
      { kind: 'ball', r: 0.028, pos: [-0.27, 0.028, 0.075], mat: 'roller', share: 0.075 },
      { kind: 'ball', r: 0.028, pos: [-0.27, 0.028, -0.075], mat: 'roller', share: 0.075 },
    ],
    sockets: [
      { id: 'wheels', label: 'wheels down', pos: [0, 0, 0], normal: [0, -1, 0], up: [1, 0, 0] },
      { id: 'deck', label: 'deck face', pos: [0, 0.112, 0], normal: [0, 1, 0], up: [1, 0, 0] },
    ],
    strength: 1200,
    behaviors: [],
    drag: 0.04,
    visual: 'skateboard',
    color: 0x2f7fc1,
    buildable: true,
    stage: 1,
  },
  {
    id: 'bucket',
    name: 'Bucket',
    hint: 'Holds stuff. Catches air. Heavy when full.',
    traits: ['container', 'catches air', 'counterweight'],
    material: 'plastic',
    mass: 1.0,
    shapes: bucketWalls(),
    sockets: [
      { id: 'bottom', label: 'bottom', pos: [0, -0.15, 0], normal: [0, -1, 0], up: [0, 0, 1] },
      { id: 'side', label: 'side', pos: [0, 0, -0.14], normal: [0, 0, -1], up: [0, 1, 0] },
      { id: 'rim', label: 'rim (upside down)', pos: [0, 0.15, 0], normal: [0, 1, 0], up: [0, 0, 1] },
    ],
    strength: 600,
    behaviors: [],
    drag: 0.35,
    visual: 'bucket',
    color: 0xe8b830,
    buildable: true,
    stage: 1,
  },
  {
    id: 'lawn_wheel',
    name: 'Lawnmower Wheel',
    hint: 'Spins on an axle. Grippy rubber.',
    traits: ['rolls', 'axle', 'grip'],
    material: 'rubber',
    mass: 0.55,
    shapes: [{ kind: 'cyl', r: 0.1, halfH: 0.025, axis: 'z' }],
    sockets: [{ id: 'hub', label: 'hub', pos: [0, 0, -0.03], normal: [0, 0, -1], up: [0, 1, 0], joint: 'axle' }],
    strength: 650,
    behaviors: [],
    angularDamping: 0.05,
    visual: 'lawn_wheel',
    buildable: true,
    stage: 1,
  },
  {
    id: 'bike_wheel',
    name: 'Bike Wheel',
    hint: 'Big and light. Spins forever once it gets going.',
    traits: ['rolls', 'flywheel', 'big'],
    material: 'rubber',
    mass: 1.4,
    shapes: [{ kind: 'cyl', r: 0.3, halfH: 0.02, axis: 'z' }],
    sockets: [{ id: 'hub', label: 'hub', pos: [0, 0, -0.05], normal: [0, 0, -1], up: [0, 1, 0], joint: 'axle' }],
    strength: 1100,
    behaviors: [],
    angularDamping: 0.02,
    visual: 'bike_wheel',
    buildable: true,
    stage: 1,
  },
  {
    id: 'motor',
    name: 'Drill Motor',
    hint: 'Pulled out of a dead drill. Spins whatever you stick on the shaft.',
    traits: ['spins', 'torque', 'needs power'],
    material: 'metal',
    mass: 1.1,
    shapes: [
      { kind: 'cyl', r: 0.045, halfH: 0.08, axis: 'z', share: 0.85 },
      { kind: 'box', half: [0.05, 0.01, 0.06], pos: [0, -0.055, 0], share: 0.15 },
    ],
    sockets: [
      { id: 'base', label: 'mounting foot', pos: [0, -0.065, 0], normal: [0, -1, 0], up: [0, 0, 1] },
      { id: 'back', label: 'back end', pos: [0, 0, -0.08], normal: [0, 0, -1], up: [0, 1, 0] },
    ],
    targets: [
      { id: 'shaft', label: 'shaft', pos: [0, 0, 0.1], normal: [0, 0, 1], joint: 'driven', pivot: [0, 0, 0.1], axis: [0, 0, 1], radius: 0.1 },
    ],
    strength: 900,
    behaviors: [{ type: 'motor', torque: 5.5, rpm: 230, watts: 110 }],
    visual: 'motor',
    buildable: true,
    stage: 1,
  },
  {
    id: 'battery_small',
    name: 'Lantern Battery',
    hint: 'Light. Enough juice for a motor or two.',
    traits: ['power', 'light', 'small capacity'],
    material: 'plastic',
    mass: 0.9,
    shapes: [{ kind: 'box', half: [0.055, 0.06, 0.055] }],
    sockets: [
      { id: 'bottom', label: 'bottom', pos: [0, -0.06, 0], normal: [0, -1, 0], up: [0, 0, 1] },
      { id: 'side', label: 'side', pos: [0, 0, -0.055], normal: [0, 0, -1], up: [0, 1, 0] },
    ],
    strength: 600,
    behaviors: [{ type: 'battery', energy: 18000, maxWatts: 260 }],
    visual: 'battery_small',
    buildable: true,
    stage: 1,
  },
  {
    id: 'battery_car',
    name: 'Car Battery',
    hint: 'SO heavy. But it could run anything.',
    traits: ['lots of power', 'very heavy'],
    material: 'plastic',
    mass: 12,
    shapes: [{ kind: 'box', half: [0.13, 0.1, 0.09] }],
    sockets: [
      { id: 'bottom', label: 'bottom', pos: [0, -0.1, 0], normal: [0, -1, 0], up: [0, 0, 1] },
      { id: 'side', label: 'side', pos: [0, 0, -0.09], normal: [0, 0, -1], up: [0, 1, 0] },
    ],
    strength: 1800,
    behaviors: [{ type: 'battery', energy: 250000, maxWatts: 1600 }],
    visual: 'battery_car',
    buildable: true,
    stage: 1,
  },
  {
    id: 'box_fan',
    name: 'Box Fan',
    hint: 'Makes wind. Wind pushes things. The fan gets pushed too.',
    traits: ['airflow', 'thrust', 'needs power'],
    material: 'plastic',
    mass: 2.4,
    shapes: [{ kind: 'box', half: [0.23, 0.23, 0.06] }],
    sockets: [
      { id: 'bottom', label: 'bottom', pos: [0, -0.23, 0], normal: [0, -1, 0], up: [0, 0, 1] },
      { id: 'back', label: 'back grille', pos: [0, 0, -0.06], normal: [0, 0, -1], up: [0, 1, 0] },
    ],
    strength: 500,
    behaviors: [
      { type: 'thrust', force: 16, axis: [0, 0, -1], watts: 100 },
      { type: 'airflow', axis: [0, 0, 1], at: [0, 0, 0.07], range: 4.5, pressure: 140, cone: 22 },
    ],
    drag: 0.25,
    visual: 'box_fan',
    buildable: true,
    stage: 1,
  },
  {
    id: 'vacuum',
    name: 'Shop Vac',
    hint: 'Sucks up anything light. Needs a LOT of power.',
    traits: ['suction', 'grabs light things', 'power hungry'],
    material: 'plastic',
    mass: 4.5,
    shapes: [
      { kind: 'cyl', r: 0.16, halfH: 0.18, share: 0.85 },
      { kind: 'box', half: [0.035, 0.035, 0.17], pos: [0, -0.08, 0.33], share: 0.15 },
    ],
    sockets: [
      { id: 'bottom', label: 'bottom', pos: [0, -0.18, 0], normal: [0, -1, 0], up: [0, 0, 1] },
      { id: 'back', label: 'back', pos: [0, 0, -0.16], normal: [0, 0, -1], up: [0, 1, 0] },
      { id: 'top', label: 'lid', pos: [0, 0.18, 0], normal: [0, 1, 0], up: [0, 0, 1] },
    ],
    strength: 800,
    behaviors: [
      { type: 'suction', axis: [0, 0, 1], at: [0, -0.08, 0.5], range: 2.6, force: 16, hold: 32, watts: 700, cone: 35 },
    ],
    visual: 'vacuum',
    buildable: true,
    stage: 1,
  },
  {
    id: 'balloons',
    name: 'Party Balloons',
    hint: 'They pull UP. A few of them could lift something small.',
    traits: ['lift', 'buoyant', 'fragile string'],
    material: 'foam',
    mass: 0.06,
    shapes: [{ kind: 'ball', r: 0.26 }],
    sockets: [
      { id: 'string', label: 'string', pos: [0, -1.1, 0], normal: [0, -1, 0], up: [0, 0, 1], joint: 'tether', tether: 0.84 },
    ],
    strength: 60,
    behaviors: [{ type: 'buoyancy', lift: 3.4 }],
    drag: 0.22,
    linearDamping: 0.3,
    angularDamping: 0.6,
    visual: 'balloons',
    buildable: true,
    stage: 1,
  },
  {
    id: 'rope',
    name: 'Rope',
    hint: 'Pulls, never pushes. Goes over things.',
    traits: ['tension', 'tether', 'flexible'],
    material: 'fabric',
    mass: 0.35,
    shapes: [{ kind: 'box', half: [0.08, 0.04, 0.08] }],
    sockets: [],
    strength: 700,
    behaviors: [],
    link: { kind: 'rope', length: 3, lengthOptions: [0.5, 1, 2, 3, 4, 6], stiffness: 4000, damping: 0.6, breakForce: 700, maxSpan: 6, radius: 0.01 },
    visual: 'rope',
    buildable: true,
    stage: 1,
  },
  {
    id: 'bungee',
    name: 'Bungee Cord',
    hint: 'Stretch it and let go. Stores a surprising amount of energy.',
    traits: ['elastic', 'stores energy', 'snaps back'],
    material: 'rubber',
    mass: 0.25,
    shapes: [{ kind: 'box', half: [0.08, 0.03, 0.05] }],
    sockets: [],
    strength: 900,
    behaviors: [],
    link: { kind: 'elastic', length: 0.4, stiffness: 420, damping: 0.25, breakForce: 900, maxSpan: 1.8, radius: 0.012 },
    visual: 'bungee',
    buildable: true,
    stage: 1,
  },
  {
    id: 'spring',
    name: 'Big Spring',
    hint: 'From an old trampoline. Squash it and it wants to un-squash.',
    traits: ['pushes', 'pulls', 'stores energy'],
    material: 'metal',
    mass: 0.4,
    shapes: [{ kind: 'box', half: [0.05, 0.05, 0.05] }],
    sockets: [],
    strength: 2500,
    behaviors: [],
    link: { kind: 'spring', length: 0.35, stiffness: 2200, damping: 0.2, breakForce: 2500, maxSpan: 0.8, minLength: 0.1, radius: 0.035 },
    visual: 'spring',
    buildable: true,
    stage: 1,
  },
  {
    id: 'hinge',
    name: 'Door Hinge',
    hint: 'Whatever you attach on top can swing.',
    traits: ['pivot', 'swings', 'lever point'],
    material: 'metal',
    mass: 0.25,
    shapes: [{ kind: 'box', half: [0.06, 0.012, 0.05] }],
    sockets: [{ id: 'base', label: 'back leaf', pos: [0, -0.012, 0], normal: [0, -1, 0], up: [1, 0, 0] }],
    targets: [
      { id: 'swing', label: 'swinging leaf', pos: [0, 0.012, 0], normal: [0, 1, 0], joint: 'hinge', pivot: [0, 0.012, 0], axis: [1, 0, 0], radius: 0.1 },
    ],
    strength: 1000,
    behaviors: [],
    visual: 'hinge',
    buildable: true,
    stage: 1,
  },
  {
    id: 'duct_tape',
    name: 'Duct Tape Wad',
    hint: 'Sticky side out. Grabs whatever it bumps into.',
    traits: ['sticky', 'grabs', 'light'],
    material: 'fabric',
    mass: 0.08,
    shapes: [{ kind: 'box', half: [0.055, 0.015, 0.055] }],
    sockets: [{ id: 'back', label: 'back', pos: [0, -0.015, 0], normal: [0, -1, 0], up: [0, 0, 1] }],
    strength: 450,
    behaviors: [{ type: 'sticky', hold: 55 }],
    visual: 'duct_tape',
    buildable: true,
    stage: 1,
  },
  {
    id: 'bottle_rocket',
    name: 'Soda Bottle Rocket',
    hint: 'Shake it. Point it. Stand back.',
    traits: ['thrust', 'one shot', 'no power needed'],
    material: 'plastic',
    mass: 0.7,
    shapes: [{ kind: 'cyl', r: 0.05, halfH: 0.17 }],
    sockets: [
      { id: 'side', label: 'side', pos: [-0.05, 0, 0], normal: [-1, 0, 0], up: [0, 1, 0] },
      { id: 'base', label: 'bottom', pos: [0, -0.17, 0], normal: [0, -1, 0], up: [0, 0, 1] },
    ],
    strength: 500,
    behaviors: [{ type: 'thrust', force: 60, axis: [0, 1, 0], burn: 0.9 }],
    drag: 0.01,
    visual: 'bottle_rocket',
    buildable: true,
    stage: 1,
  },
  {
    id: 'timer',
    name: 'Egg Timer',
    hint: 'Tick... tick... DING. Makes the machine wait before it starts.',
    traits: ['delay', 'trigger'],
    material: 'plastic',
    mass: 0.15,
    shapes: [{ kind: 'box', half: [0.05, 0.04, 0.05] }],
    sockets: [{ id: 'bottom', label: 'bottom', pos: [0, -0.04, 0], normal: [0, -1, 0], up: [0, 0, 1] }],
    strength: 400,
    behaviors: [{ type: 'timer', delay: 3, options: [1, 2, 3, 5, 8] }],
    visual: 'timer',
    buildable: true,
    stage: 1,
  },
  {
    id: 'pressure_plate',
    name: 'Squeaky Doormat',
    hint: 'Squeaks when something lands on it. Could that switch something on?',
    traits: ['trigger', 'pressure switch'],
    material: 'rubber',
    mass: 0.8,
    shapes: [{ kind: 'box', half: [0.25, 0.02, 0.18] }],
    sockets: [{ id: 'bottom', label: 'bottom', pos: [0, -0.02, 0], normal: [0, -1, 0], up: [0, 0, 1] }],
    strength: 800,
    behaviors: [{ type: 'pressure', threshold: 10 }],
    visual: 'pressure_plate',
    buildable: true,
    stage: 1,
  },
  {
    id: 'rc_receiver',
    name: 'RC Truck Brain',
    hint: 'From a smashed RC truck. Lets you steer motors and flip switches from far away.',
    traits: ['remote control', 'steering', 'switch'],
    material: 'plastic',
    mass: 0.15,
    shapes: [{ kind: 'box', half: [0.05, 0.025, 0.07] }],
    sockets: [{ id: 'bottom', label: 'bottom', pos: [0, -0.025, 0], normal: [0, -1, 0], up: [0, 0, 1] }],
    strength: 500,
    behaviors: [{ type: 'receiver' }],
    visual: 'rc_receiver',
    buildable: true,
    stage: 1,
  },
  {
    id: 'winch',
    name: 'Boat Winch',
    hint: 'Reels in any rope tied to its drum. Slow but strong.',
    traits: ['reels rope', 'strong', 'needs power'],
    material: 'metal',
    mass: 1.8,
    shapes: [
      { kind: 'cyl', r: 0.05, halfH: 0.07, axis: 'x', share: 0.6 },
      { kind: 'box', half: [0.09, 0.015, 0.07], pos: [0, -0.065, 0], share: 0.4 },
    ],
    sockets: [{ id: 'bottom', label: 'base', pos: [0, -0.08, 0], normal: [0, -1, 0], up: [0, 0, 1] }],
    targets: [{ id: 'drum', label: 'drum', pos: [0, 0.05, 0], normal: [0, 1, 0], joint: 'reel', radius: 0.12 }],
    strength: 1200,
    behaviors: [{ type: 'winch', speed: 0.6, force: 450, watts: 140 }],
    visual: 'winch',
    buildable: true,
    stage: 1,
  },
  {
    id: 'trampoline',
    name: 'Mini Trampoline',
    hint: 'Boing. Jump on it at the right moment and you go higher every time.',
    traits: ['bouncy', 'launch pad'],
    material: 'bouncy',
    mass: 8,
    shapes: [{ kind: 'cyl', r: 0.5, halfH: 0.125, pos: [0, 0.125, 0] }],
    sockets: [{ id: 'bottom', label: 'legs', pos: [0, 0, 0], normal: [0, -1, 0], up: [0, 0, 1] }],
    strength: 1500,
    behaviors: [{ type: 'bounce', boost: 3.4 }],
    visual: 'trampoline',
    buildable: true,
    stage: 1,
  },
  {
    id: 'brick',
    name: 'Brick',
    hint: 'Heavy for its size. Perfect ballast.',
    traits: ['heavy', 'ballast', 'counterweight'],
    material: 'concrete',
    mass: 2.3,
    shapes: [{ kind: 'box', half: [0.1, 0.032, 0.048] }],
    sockets: [
      { id: 'flat', label: 'flat side', pos: [0, -0.032, 0], normal: [0, -1, 0], up: [1, 0, 0] },
      { id: 'end', label: 'end', pos: [-0.1, 0, 0], normal: [-1, 0, 0], up: [0, 1, 0] },
    ],
    strength: 1500,
    behaviors: [],
    visual: 'brick',
    buildable: true,
    stage: 1,
  },

  // ---- Props: things the world cares about, not building material ----
  {
    id: 'playground_ball',
    name: 'Your Ball',
    hint: 'THE ball. You need it back.',
    traits: ['bouncy', 'light', 'rolls'],
    material: 'rubber',
    mass: 0.4,
    shapes: [{ kind: 'ball', r: 0.11 }],
    sockets: [],
    strength: 1e9,
    behaviors: [],
    drag: 0.02,
    linearDamping: 0.12,
    angularDamping: 0.6,
    visual: 'playground_ball',
    buildable: false,
    stage: 1,
  },
  {
    id: 'kite',
    name: 'Your Kite',
    hint: 'Tangled up in the branches.',
    traits: ['light', 'catches air'],
    material: 'fabric',
    mass: 0.3,
    shapes: [{ kind: 'box', half: [0.32, 0.02, 0.42] }],
    sockets: [],
    strength: 1e9,
    behaviors: [],
    drag: 0.5,
    linearDamping: 0.3,
    angularDamping: 1.0,
    visual: 'kite',
    buildable: false,
    stage: 1,
  },
  {
    id: 'tennis_ball',
    name: "Biscuit's Ball",
    hint: 'The dog wants it. It is under the shed.',
    traits: ['tiny', 'light', 'rolls'],
    material: 'rubber',
    mass: 0.06,
    shapes: [{ kind: 'ball', r: 0.034 }],
    sockets: [],
    strength: 1e9,
    behaviors: [],
    drag: 0.004,
    linearDamping: 0.2,
    angularDamping: 0.8,
    visual: 'tennis_ball',
    buildable: false,
    stage: 1,
  },
];

export const PART_MAP: Record<string, PartDef> = Object.fromEntries(PARTS.map((p) => [p.id, p]));

export function getPart(id: string): PartDef {
  const p = PART_MAP[id];
  if (!p) throw new Error(`Unknown part: ${id}`);
  return p;
}

export function behavior<T extends BehaviorDef['type']>(def: PartDef, type: T): Extract<BehaviorDef, { type: T }> | undefined {
  return def.behaviors.find((b) => b.type === type) as Extract<BehaviorDef, { type: T }> | undefined;
}
