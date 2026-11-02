import type { Livery } from "../vehicle/CarView";

export interface CarColour {
  id: string;
  name: string;
  /** Total points needed (10 per valid lap, race points, personal bests). */
  points: number;
  livery: Livery;
}

const L = (body: number, accent: number, helmet: number, compound: number, pod: number): Livery => ({ body, accent, helmet, compound, pod });

/** Paint schemes, earned by racing. The first one is always available. */
export const CAR_COLOURS: readonly CarColour[] = [
  { id: "signal-red", name: "Signal red", points: 0, livery: L(0xc8141f, 0xf4f4f2, 0xf2f2f2, 0xffd21f, 0xc6ff2a) },
  { id: "midnight", name: "Midnight blue", points: 40, livery: L(0x14306b, 0xf4f4f2, 0xffd21f, 0xffd21f, 0x4db8ff) },
  { id: "papaya", name: "Papaya", points: 100, livery: L(0xff7a00, 0x111111, 0xffffff, 0xffd21f, 0x1d6fd8) },
  { id: "forest", name: "Forest green", points: 180, livery: L(0x0f6b3c, 0xffe27a, 0xffffff, 0xffd21f, 0xffd21f) },
  { id: "silver", name: "Silver arrow", points: 280, livery: L(0xb9bec7, 0x111111, 0x111111, 0xffd21f, 0x00d2be) },
  { id: "violet", name: "Violet storm", points: 400, livery: L(0x5b2bbf, 0xffffff, 0xffffff, 0xffd21f, 0xff4fd8) },
  { id: "gold", name: "Champion gold", points: 600, livery: L(0xd9a400, 0x111111, 0x111111, 0xffd21f, 0xffffff) },
  { id: "ghost", name: "Ghost white", points: 900, livery: L(0xf2f4f8, 0xc8141f, 0x111111, 0xffd21f, 0xc8141f) },
];

/** The colour a rival is shown in when nothing better is known (or when it would clash with yours). */
const RIVAL_BLUE: Livery = L(0x1d6fd8, 0xffffff, 0xffd21f, 0xf4f4f2, 0xff4fd8);

export function colourName(id: string | undefined): string | null {
  return CAR_COLOURS.find((c) => c.id === id)?.name ?? null;
}

/**
 * The paint an online opponent's car is drawn in. Their choice is used as long as it is a known scheme and
 * does not look like your own car; otherwise a clearly different one is picked so you can always tell the cars apart.
 */
export function opponentLivery(id: string | undefined, mine: Livery | undefined): Livery {
  const theirs = CAR_COLOURS.find((c) => c.id === id)?.livery;
  const mineBody = mine?.body ?? CAR_COLOURS[0]!.livery.body;
  if (theirs && theirs.body !== mineBody) return theirs;
  if (RIVAL_BLUE.body !== mineBody && RIVAL_BLUE.body !== theirs?.body) return RIVAL_BLUE;
  return CAR_COLOURS.find((c) => c.livery.body !== mineBody && c.livery.body !== theirs?.body)!.livery;
}

export function unlockedColours(points: number): CarColour[] {
  return CAR_COLOURS.filter((c) => points >= c.points);
}

export function nextColour(points: number): CarColour | null {
  return CAR_COLOURS.find((c) => points < c.points) ?? null;
}

/** Colours that became available between two point totals. */
export function newlyUnlocked(before: number, after: number): CarColour[] {
  return CAR_COLOURS.filter((c) => before < c.points && after >= c.points);
}

/** A saved choice only counts if it is still unlocked. */
export function pickColour(id: string, points: number): CarColour {
  const c = CAR_COLOURS.find((x) => x.id === id);
  return c && points >= c.points ? c : CAR_COLOURS[0]!;
}
