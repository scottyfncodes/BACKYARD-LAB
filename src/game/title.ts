import { PROJECT_MAP, PROJECTS } from '../data/projects';
import { Builder, type Blueprint } from '../sim/blueprint';
import type { SaveData } from './save';

/**
 * The opening screen: the yard is the hero and the button is the verb.
 * What the one big button says, and what the little sandbox lock teases.
 */
export interface TitleAction {
  /** The big words: what you're about to do. */
  verb: string;
  /** The small line under them: which project. */
  sub: string;
  /** Pick up the saved session, or start this project fresh. */
  resume: boolean;
  project: string | null;
}

export function titleAction(s: SaveData): TitleAction {
  const sess = s.session;
  if (sess) {
    const sub = sess.mode === 'sandbox' ? '🧪 Sandbox' : (PROJECT_MAP[sess.project ?? '']?.title ?? '');
    return { verb: 'Keep building', sub, resume: true, project: sess.project };
  }
  const next = PROJECTS.find((p) => s.unlocked.includes(p.id) && !s.completed[p.id]) ?? PROJECTS[0];
  // Mission 0 names the thing itself: there is no wagon yet.
  if (next.deliverable === 'wagon') return { verb: 'Build the wagon', sub: 'Project 1 · THE WAGON', resume: false, project: next.id };
  return { verb: 'Start building', sub: `Next up · ${next.title}`, resume: false, project: next.id };
}

/** Locked: which project opens the sandbox. Null once it's open. */
export function sandboxLock(s: SaveData): string | null {
  if (s.sandbox) return null;
  return PROJECTS.find((p) => p.unlocksSandbox !== false && !s.completed[p.id])?.title ?? 'a project';
}

/**
 * The half-built contraption parked by the junk pile on the title screen:
 * a plank on four lawnmower wheels, still waiting for its handle.
 * `spinner` is the wheel the kid keeps flicking.
 */
export function titleContraption(): { bp: Blueprint; spinner: number } {
  const b = new Builder('Half a wagon');
  const pl = b.free('plank');
  const spinner = b.on('lawn_wheel', 'hub', pl, [0.45, 0, 0.075], [0, 0, 1]);
  b.on('lawn_wheel', 'hub', pl, [-0.45, 0, 0.075], [0, 0, 1]);
  b.on('lawn_wheel', 'hub', pl, [0.45, 0, -0.075], [0, 0, -1]);
  b.on('lawn_wheel', 'hub', pl, [-0.45, 0, -0.075], [0, 0, -1]);
  b.on('bucket', 'bottom', pl, [0.15, 0.015, 0], [0, 1, 0]);
  return { bp: b.bp, spinner };
}
