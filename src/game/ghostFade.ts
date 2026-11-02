/** Ghost cars fade out between these distances (metres) to the player so they never smear over the real car. */
export const GHOST_FADE_NEAR = 5;
export const GHOST_FADE_FAR = 16;

/** 0..1 visibility of the best-lap ghost: gone while you are in the pits or when it is right on top of you. */
export function ghostVisibility(distance: number, inPits: boolean): number {
  if (inPits) return 0;
  const k = (distance - GHOST_FADE_NEAR) / (GHOST_FADE_FAR - GHOST_FADE_NEAR);
  return Math.max(0, Math.min(1, k));
}
