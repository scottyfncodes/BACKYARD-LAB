import { PART_MAP, PARTS } from '../data/parts';
import { PROJECT_MAP, PROJECTS } from '../data/projects';
import { parseBlueprint, type Blueprint } from '../sim/blueprint';
import type { MachinePlacement } from '../sim/machine';

/** Everything that survives closing the tab. No account needed. */
export interface SaveData {
  v: 1;
  discovered: string[];
  unlocked: string[];
  completed: Record<string, { bestTime: number; bonuses: string[] }>;
  sandbox: boolean;
  creations: { name: string; bp: Blueprint; savedAt: number }[];
  settings: { sound: boolean; sensitivity: number; hints: boolean };
  /** How many hints the player has chosen to reveal, per project. */
  hintsSeen: Record<string, number>;
  session: SessionData | null;
}

/** Where a machine was last set down to test, and where the kid stood to watch. */
export interface TestSpot {
  placement: MachinePlacement;
  player: [number, number, number];
  yaw: number;
}

export interface SessionData {
  mode: 'project' | 'sandbox';
  project: string | null;
  bench: Blueprint | null;
  machines: { bp: Blueprint; placement: MachinePlacement }[];
  stash: Record<string, number>;
  /** The bench machine's last test spot, so "test again" puts it straight back. */
  spot?: TestSpot | null;
}

export const SAVE_KEY = 'backyardlab.save.v1';
const FIRST_PROJECT = PROJECTS[0].id;

export function defaultSave(): SaveData {
  return {
    v: 1,
    discovered: [],
    unlocked: [FIRST_PROJECT],
    completed: {},
    sandbox: false,
    creations: [],
    settings: { sound: true, sensitivity: 1, hints: true },
    hintsSeen: {},
    session: null,
  };
}

interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const strList = (x: unknown, valid: (s: string) => boolean): string[] =>
  Array.isArray(x) ? [...new Set(x.filter((s): s is string => typeof s === 'string' && valid(s)))] : [];

/** Validate anything that came out of storage; never trust it. */
export function parseSave(raw: string | null): SaveData {
  const d = defaultSave();
  if (!raw) return d;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw);
  } catch {
    return d;
  }
  if (!j || typeof j !== 'object' || j.v !== 1) return d;
  d.discovered = strList(j.discovered, (s) => !!PART_MAP[s]);
  d.unlocked = strList(j.unlocked, (s) => !!PROJECT_MAP[s]);
  if (!d.unlocked.includes(FIRST_PROJECT)) d.unlocked.unshift(FIRST_PROJECT);
  if (j.completed && typeof j.completed === 'object') {
    for (const [k, v] of Object.entries(j.completed as Record<string, unknown>)) {
      if (!PROJECT_MAP[k] || !v || typeof v !== 'object') continue;
      const c = v as { bestTime?: unknown; bonuses?: unknown };
      d.completed[k] = {
        bestTime: typeof c.bestTime === 'number' && Number.isFinite(c.bestTime) ? c.bestTime : 0,
        bonuses: strList(c.bonuses, () => true),
      };
    }
  }
  d.sandbox = j.sandbox === true || Object.keys(d.completed).length > 0;
  if (Array.isArray(j.creations)) {
    for (const c of j.creations.slice(0, 24)) {
      const bp = parseBlueprint(c?.bp);
      if (bp) d.creations.push({ name: typeof c.name === 'string' ? c.name.slice(0, 40) : bp.name, bp, savedAt: typeof c.savedAt === 'number' ? c.savedAt : 0 });
    }
  }
  const s = j.settings as Record<string, unknown> | undefined;
  if (s && typeof s === 'object') {
    if (typeof s.sound === 'boolean') d.settings.sound = s.sound;
    if (typeof s.sensitivity === 'number' && s.sensitivity >= 0.2 && s.sensitivity <= 3) d.settings.sensitivity = s.sensitivity;
    if (typeof s.hints === 'boolean') d.settings.hints = s.hints;
  }
  if (j.hintsSeen && typeof j.hintsSeen === 'object') {
    for (const [k, v] of Object.entries(j.hintsSeen as Record<string, unknown>)) {
      if (PROJECT_MAP[k] && typeof v === 'number' && v > 0) d.hintsSeen[k] = Math.min(4, Math.floor(v));
    }
  }
  d.session = parseSession(j.session);
  return d;
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const isV3 = (x: unknown): x is [number, number, number] => Array.isArray(x) && x.length === 3 && x.every(isNum);

function parseSpot(x: unknown): TestSpot | null {
  if (!x || typeof x !== 'object') return null;
  const s = x as Record<string, unknown>;
  const pl = s.placement as Record<string, unknown> | undefined;
  if (!pl || !isV3(pl.pos) || !isV3(s.player)) return null;
  return { placement: { pos: [...pl.pos], yaw: isNum(pl.yaw) ? pl.yaw : 0 }, player: [...s.player], yaw: isNum(s.yaw) ? s.yaw : 0 };
}

function parseSession(x: unknown): SessionData | null {
  if (!x || typeof x !== 'object') return null;
  const s = x as Record<string, unknown>;
  const mode = s.mode === 'sandbox' ? 'sandbox' : s.mode === 'project' ? 'project' : null;
  if (!mode) return null;
  const project = typeof s.project === 'string' && PROJECT_MAP[s.project] ? s.project : null;
  if (mode === 'project' && !project) return null;
  const machines: SessionData['machines'] = [];
  if (Array.isArray(s.machines)) {
    for (const m of s.machines.slice(0, 12)) {
      const bp = parseBlueprint(m?.bp);
      const pl = m?.placement;
      if (!bp || !pl || !Array.isArray(pl.pos) || pl.pos.length !== 3 || !pl.pos.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))) continue;
      machines.push({ bp, placement: { pos: [pl.pos[0], pl.pos[1], pl.pos[2]], yaw: typeof pl.yaw === 'number' ? pl.yaw : 0 } });
    }
  }
  const stash: Record<string, number> = {};
  if (s.stash && typeof s.stash === 'object') {
    for (const [k, v] of Object.entries(s.stash as Record<string, unknown>)) {
      if (PART_MAP[k] && typeof v === 'number' && v > 0 && v < 1000) stash[k] = Math.floor(v);
    }
  }
  return { mode, project, bench: s.bench ? parseBlueprint(s.bench) : null, machines, stash, spot: parseSpot(s.spot) };
}

export function loadSave(store: KV | null = typeof localStorage !== 'undefined' ? localStorage : null): SaveData {
  try {
    return parseSave(store?.getItem(SAVE_KEY) ?? null);
  } catch {
    return defaultSave();
  }
}

export function writeSave(data: SaveData, store: KV | null = typeof localStorage !== 'undefined' ? localStorage : null): boolean {
  try {
    store?.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------- progression

/** Mark a part as found. Returns true the first time. */
export function discover(save: SaveData, partId: string): boolean {
  if (!PART_MAP[partId]?.buildable || save.discovered.includes(partId)) return false;
  save.discovered.push(partId);
  return true;
}

/** Record a solved project; returns ids of anything newly unlocked. */
export function completeProject(save: SaveData, projectId: string, time: number, bonuses: string[]): { projects: string[]; sandbox: boolean } {
  const p = PROJECT_MAP[projectId];
  const prev = save.completed[projectId];
  save.completed[projectId] = {
    bestTime: prev ? Math.min(prev.bestTime || time, time) : time,
    bonuses: [...new Set([...(prev?.bonuses ?? []), ...bonuses])],
  };
  const projects = p.unlocks.filter((id) => !save.unlocked.includes(id));
  save.unlocked.push(...projects);
  const sandbox = !save.sandbox;
  save.sandbox = true;
  return { projects, sandbox };
}

export function isUnlocked(save: SaveData, projectId: string): boolean {
  return save.unlocked.includes(projectId);
}

/** Sandbox: the whole library, unlimited. Go absolutely nuts. */
export function sandboxParts(): string[] {
  return PARTS.filter((p) => p.buildable).map((p) => p.id);
}

/** Reveal the next hint for a project (up to all four). Returns how many are now showing. */
export function revealHint(save: SaveData, projectId: string): number {
  const n = Math.min(4, (save.hintsSeen[projectId] ?? 0) + 1);
  save.hintsSeen[projectId] = n;
  return n;
}

export function totalBonuses(save: SaveData): { earned: number; possible: number } {
  let earned = 0;
  let possible = 0;
  for (const p of PROJECTS) {
    possible += p.bonuses.length;
    earned += save.completed[p.id]?.bonuses.length ?? 0;
  }
  return { earned, possible };
}
