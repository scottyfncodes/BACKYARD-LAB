/**
 * Game-feel tuning, in one place. Each number was set by playing Mission 0 on
 * a phone; change them here, then play it again.
 */
export const FEEL = {
  /** Head turns toward something worth seeing (the junk pile after the first pull): exponential ease, per second. */
  turnEase: 3.5,
  /** Pitch the view settles at after such a turn (radians, negative looks down). */
  lookPitch: -0.08,
  /** "At the wagon": at least this far (m, kid centre to wagon centre)… */
  wagonReach: 2.6,
  /** …or the wagon's own handle length plus this much, so a long handle you built still reaches your hand. */
  wagonReachSlack: 0.8,
  /** Rounded edge on the wagon's collider (m, capped at half its smallest extent): rides over lips and kerbs at any angle. */
  wagonEdgeRadius: 0.05,
  /** Bench auto-aim: bonus for a wheel that mirrors one already on (across, end to end, or corner to corner). */
  wheelMirror: 5,
  /** Bench auto-aim: how much the first wheel wants to sit near an end of the body rather than mid-side. */
  wheelFirstNearEnd: 4,
} as const;
