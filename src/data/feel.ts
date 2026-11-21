/**
 * Game-feel tuning, in one place. Each number was set by playing Mission 0 on
 * a phone; change them here, then play it again.
 */
export const FEEL = {
  /** Head turns toward something worth seeing (the junk pile after the first pull): exponential ease, per second. */
  turnEase: 3.5,
  /** Pitch the view settles at when it turns or lands on a problem (radians, negative looks down). */
  lookPitch: -0.08,
  /** "At the wagon": at least this far (m, kid centre to wagon centre)… */
  wagonReach: 2.6,
  /** …or the wagon's own handle length plus this much, so a long handle you built still reaches your hand. */
  wagonReachSlack: 0.8,
  /** Rounded edge on the wagon's collider (m, capped at half its smallest extent): rides over lips and kerbs at any angle. */
  wagonEdgeRadius: 0.05,
  /** Bench auto-aim for a wheel: how much each wish counts when picking its spot. */
  wheelAim: {
    sideBalance: 4,
    endBalance: 3,
    axlesInLine: 3,
    mirror: 2.5,
    spreadPerMetre: 2,
    stacked: -10,
    lyingFlat: -8,
    firstNearCorner: 3,
  },
  /** Bench auto-aim for a long part on something that rolls: it wants to be the handle. */
  handleAim: {
    perMetreOut: 12,
    maxOut: 0.8,
    belowWheels: -4,
  },
} as const;
