/**
 * PHYSICS 101: Mom's old college textbook, found on the shelf in the lab.
 *
 * Everything here is data plus a few pure calculations. The book UI
 * (src/game/physicsbook.ts) turns each chapter into a page with a little
 * experiment: sliders, a drawing, and one plain sentence that says what just
 * happened. No quizzes, no grades. The point of a chapter is "change this and
 * see what happens", so the kid comes back to the bench with a hunch.
 *
 * Adding a chapter: add a ChapterDef here, an experiment in the book UI, and
 * (optionally) point a test-result rule at it in diagnostics.ts.
 */
export type ChapterId = 'motion' | 'forces' | 'levers' | 'projectile' | 'energy';

export interface ChapterDef {
  id: ChapterId;
  n: number;
  title: string;
  /**
   * When the pages come unstuck: the first chapters open with the book; the rest
   * open the moment the kid meets the idea, by putting one of these parts on
   * the bench or by a test result that points at the chapter.
   */
  unlock: { withBook: true } | { withBook?: false; parts: string[]; tease: string };
  /** What this chapter is good for, in the kid's words. Shown in the contents. */
  useFor: string;
  /** THE IDEA, in one or two plain sentences. */
  idea: string;
  /** The words the chapter uses, and what they mean out in the yard. */
  words: { term: string; plain: string }[];
  /** Scribbled in the margin in Mom's handwriting. */
  momsNote: string;
  /** Back to the machine: what to go change. */
  tryIt: string;
  /** Only for kids who want it. Folded away by default. */
  math: { formula: string; plain: string }[];
}

export const CHAPTERS: ChapterDef[] = [
  {
    id: 'motion',
    n: 1,
    title: 'Motion',
    unlock: { withBook: true },
    useFor: 'How far, how fast, which way.',
    idea: 'Speed is how much ground something covers every second. Keep the speed and the distance just keeps adding up. Speeding up or slowing down is acceleration.',
    words: [
      { term: 'distance', plain: 'how far it went' },
      { term: 'speed', plain: 'how far it goes each second' },
      { term: 'direction', plain: 'which way it is pointed. Speed with a direction is velocity' },
      { term: 'acceleration', plain: 'how quickly the speed changes' },
    ],
    momsNote: 'Twice the time at the same speed = twice the distance. That one still gets people.',
    tryIt: 'Did it stop short? It needed more speed, or more time at that speed.',
    math: [
      { formula: 'distance = speed × time', plain: 'at 3 m/s for 4 seconds you cover 12 m' },
      { formula: 'speed = start speed + acceleration × time', plain: 'speeding up by 2 m/s every second, after 3 s you are going 6 m/s faster' },
    ],
  },
  {
    id: 'forces',
    n: 2,
    title: 'Forces',
    unlock: { withBook: true },
    useFor: 'Pushes, pulls, friction, gravity.',
    idea: 'A force is a push or a pull. Things only start moving, stop, or change direction when the pushes and pulls on them do not cancel out. Friction is the push that fights sliding. Gravity is the pull straight down.',
    words: [
      { term: 'push / pull', plain: 'a force. Measured in newtons (N): about the weight of an apple' },
      { term: 'friction', plain: 'the force that fights sliding. Rough things grip, smooth things slide' },
      { term: 'gravity', plain: 'the pull toward the ground. The heavier the thing, the harder the pull' },
      { term: 'net force', plain: 'what is left after all the pushes and pulls fight it out' },
    ],
    momsNote: 'A thing that is not moving is not "no forces". It is forces that cancel. Push harder than friction and it goes.',
    tryIt: 'Did nothing move? Something has to push harder than friction. Did it drift sideways? Look at which way the push points.',
    math: [
      { formula: 'weight = mass × 9.8', plain: 'a 2 kg brick pulls down with about 20 N' },
      { formula: 'friction ≈ grip × weight', plain: 'rubber on grass grips about 0.6 of the weight; ice about 0.05' },
      { formula: 'acceleration = net force ÷ mass', plain: 'the same push moves a light thing faster than a heavy one' },
    ],
  },
  {
    id: 'levers',
    n: 3,
    title: 'Levers & Turning',
    unlock: { parts: ['hinge', 'broom'], tease: 'Something swings, or something tips over.' },
    useFor: 'Lifting heavy things, swinging arms, why machines tip.',
    idea: 'A push makes things turn around a pivot. Push farther from the pivot and the same push makes more turn. That is the whole trick of a lever: a long arm lets a small push beat a big load on a short arm.',
    words: [
      { term: 'fulcrum', plain: 'the pivot. The point the lever turns around' },
      { term: 'lever arm', plain: 'how far from the pivot the push lands' },
      { term: 'torque', plain: 'turning force: push × lever arm' },
      { term: 'mechanical advantage', plain: 'how many times your push gets multiplied (long arm ÷ short arm)' },
    ],
    momsNote: 'Same idea tips your machine over: weight hanging out past the wheels is a lever arm, and gravity is doing the pushing.',
    tryIt: 'Arm swings weakly? Move the pivot closer to the load. Machine tips? Put something heavy on the other side of the pivot, or widen the base.',
    math: [
      { formula: 'torque = force × lever arm', plain: '20 N pushing 0.5 m from the pivot makes 10 N·m of turn' },
      { formula: 'balanced when: push × long arm = load × short arm', plain: 'a 5 kg load 0.3 m out needs 15 N pushing 1 m out' },
    ],
  },
  {
    id: 'projectile',
    n: 4,
    title: 'Projectile Motion',
    unlock: { parts: ['bottle_rocket', 'bungee', 'spring', 'trampoline'], tease: 'Something gets thrown, flung or launched.' },
    useFor: 'Launching, throwing, lobbing things over fences.',
    idea: 'Once something is in the air, only gravity is pulling on it. It keeps its sideways speed and gravity eats its upward speed. Launch faster to go farther. Launch steeper to go higher. About 45° goes farthest.',
    words: [
      { term: 'launch speed', plain: 'how fast it leaves the machine' },
      { term: 'launch angle', plain: 'how steep it leaves. 0° is flat, 90° is straight up' },
      { term: 'gravity', plain: 'what bends the path back down' },
      { term: 'range', plain: 'how far away it lands' },
    ],
    momsNote: 'Too low an angle and it hits the fence. Too high and it comes straight back down on you. (I know this from experience.)',
    tryIt: 'Hit the fence? More launch speed, or a steeper angle. Went straight up? Lower the angle.',
    math: [
      { formula: 'range = speed² × sin(2 × angle) ÷ gravity', plain: '8 m/s at 45° lands about 6.5 m away' },
      { formula: 'highest point = (speed × sin(angle))² ÷ (2 × gravity)', plain: 'the same launch gets about 1.6 m up' },
    ],
  },
  {
    id: 'energy',
    n: 5,
    title: 'Energy',
    unlock: { parts: ['battery_small', 'battery_car', 'bungee', 'spring'], tease: 'Something stores up oomph: a battery, a spring, a bungee.' },
    useFor: 'Stored-up oomph, batteries, springs, what makes things go.',
    idea: 'Energy is stored-up ability to make things move. A stretched bungee, a lifted weight, a charged battery: all stored energy. Let it go and it turns into moving energy. It never disappears; it just moves house (some of it into heat and noise).',
    words: [
      { term: 'stored energy', plain: 'in a stretched spring, a lifted weight, a charged battery' },
      { term: 'kinetic energy', plain: 'moving energy. Faster and heavier means more of it' },
      { term: 'transfer', plain: 'energy moving from one place to another: spring → ball, battery → motor → wheels' },
      { term: 'power', plain: 'how fast energy gets delivered. A small battery cannot deliver fast enough for a hungry motor' },
    ],
    momsNote: 'Stretch a spring twice as far and it stores FOUR times the energy. Springs are sneaky like that.',
    tryIt: 'Didn’t go far enough? Store more: stretch farther, lift higher. Motor fading? The battery can’t hand over energy fast enough: bigger battery, or fewer things drawing on it.',
    math: [
      { formula: 'spring energy = ½ × stiffness × stretch²', plain: 'a 400 N/m bungee stretched 0.3 m stores 18 J' },
      { formula: 'moving energy = ½ × mass × speed²', plain: '18 J makes a 0.4 kg ball go about 9.5 m/s' },
      { formula: 'lifting energy = mass × 9.8 × height', plain: 'the same 18 J lifts that ball about 4.6 m' },
    ],
  },
];

/** Which chapters the bench just made relevant: any chapter whose parts are on it. */
export function chaptersForParts(partIds: Iterable<string>): ChapterId[] {
  const have = new Set(partIds);
  return CHAPTERS.filter((c) => !c.unlock.withBook && c.unlock.parts.some((id) => have.has(id))).map((c) => c.id);
}

export const CHAPTER_MAP: Record<ChapterId, ChapterDef> = Object.fromEntries(CHAPTERS.map((c) => [c.id, c])) as Record<ChapterId, ChapterDef>;

/** Pages further in. Dog-eared, but not needed yet: they open up as the backyard gets more complicated. */
export const LATER_CHAPTERS: { title: string; useFor: string }[] = [
  { title: 'Momentum', useFor: 'Why heavy, fast things are hard to stop.' },
  { title: 'Centre of Mass', useFor: 'Where the weight really sits, and why things tip.' },
  { title: 'Friction, Properly', useFor: 'Grip, slip, and why wheels spin in place.' },
  { title: 'Pulleys & Mechanical Advantage', useFor: 'Trading distance for strength.' },
  { title: 'Collisions', useFor: 'Bounces, thumps and what happens when things hit.' },
  { title: 'Gears', useFor: 'Fast and weak, or slow and strong.' },
  { title: 'Air Resistance', useFor: 'Why light, wide things float down and fast things fight the air.' },
];

// ----------------------------------------------------------------- calculations
// All pure, all in metres, seconds, kilograms and newtons.

export const GRAVITY = 9.81;
const DEG = Math.PI / 180;

/** Where something is after t seconds, starting at v0 and speeding up by a every second. */
export function distanceTravelled(v0: number, a: number, t: number): number {
  return v0 * t + 0.5 * a * t * t;
}

export function speedAfter(v0: number, a: number, t: number): number {
  return v0 + a * t;
}

/** A crate pushed along a surface: does it budge, and how fast does it pick up speed? */
export function slide(pushN: number, massKg: number, grip: number, g = GRAVITY): { weight: number; friction: number; moves: boolean; accel: number } {
  const weight = massKg * g;
  const maxFriction = grip * weight;
  const moves = pushN > maxFriction;
  const friction = moves ? maxFriction : pushN;
  return { weight, friction, moves, accel: moves ? (pushN - maxFriction) / massKg : 0 };
}

export function torque(forceN: number, armM: number): number {
  return forceN * armM;
}

/** A plank over a fulcrum: a push on the long side against a load on the short side. */
export function lever(pushN: number, pushArm: number, loadKg: number, loadArm: number, g = GRAVITY): { pushTorque: number; loadTorque: number; lifts: boolean; advantage: number; pushNeeded: number } {
  const pushTorque = torque(pushN, pushArm);
  const loadTorque = torque(loadKg * g, loadArm);
  const advantage = loadArm > 0 ? pushArm / loadArm : Infinity;
  return { pushTorque, loadTorque, lifts: pushTorque > loadTorque, advantage, pushNeeded: pushArm > 0 ? loadTorque / pushArm : Infinity };
}

/** The flight path of something launched from ground level: points until it lands. */
export function trajectory(speed: number, angleDeg: number, g = GRAVITY, dt = 0.02, y0 = 0): { x: number; y: number }[] {
  const vx = speed * Math.cos(angleDeg * DEG);
  const vy = speed * Math.sin(angleDeg * DEG);
  const pts: { x: number; y: number }[] = [{ x: 0, y: y0 }];
  for (let t = dt; t < 30; t += dt) {
    const y = y0 + vy * t - 0.5 * g * t * t;
    const x = vx * t;
    if (y < 0) {
      // Land exactly on the ground.
      const tl = flightTime(speed, angleDeg, g, y0);
      pts.push({ x: vx * tl, y: 0 });
      break;
    }
    pts.push({ x, y });
  }
  return pts;
}

export function flightTime(speed: number, angleDeg: number, g = GRAVITY, y0 = 0): number {
  const vy = speed * Math.sin(angleDeg * DEG);
  // Solve y0 + vy t - ½ g t² = 0 for the positive root.
  return (vy + Math.sqrt(vy * vy + 2 * g * y0)) / g;
}

/** How far away it lands. */
export function projectileRange(speed: number, angleDeg: number, g = GRAVITY, y0 = 0): number {
  return speed * Math.cos(angleDeg * DEG) * flightTime(speed, angleDeg, g, y0);
}

/** How high it gets. */
export function projectilePeak(speed: number, angleDeg: number, g = GRAVITY, y0 = 0): number {
  const vy = speed * Math.sin(angleDeg * DEG);
  return y0 + (vy > 0 ? (vy * vy) / (2 * g) : 0);
}

/** How high it is when it passes a point `x` metres out, or null if it never gets there. */
export function heightAt(speed: number, angleDeg: number, x: number, g = GRAVITY, y0 = 0): number | null {
  const vx = speed * Math.cos(angleDeg * DEG);
  if (vx <= 1e-6) return null;
  const t = x / vx;
  if (t > flightTime(speed, angleDeg, g, y0)) return null;
  const vy = speed * Math.sin(angleDeg * DEG);
  return y0 + vy * t - 0.5 * g * t * t;
}

export function springEnergy(stiffness: number, stretch: number): number {
  return 0.5 * stiffness * stretch * stretch;
}

export function kineticEnergy(massKg: number, speed: number): number {
  return 0.5 * massKg * speed * speed;
}

export function speedFromEnergy(joules: number, massKg: number): number {
  return Math.sqrt(Math.max(0, (2 * joules) / massKg));
}

export function heightFromEnergy(joules: number, massKg: number, g = GRAVITY): number {
  return joules / (massKg * g);
}
