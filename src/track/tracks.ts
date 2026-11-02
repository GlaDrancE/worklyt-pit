/**
 * Original, fictional circuits. Coordinates are metres on the XZ plane.
 * The first control point is the start of the main straight; the car
 * drives from point 0 towards point 1.
 */
export interface TrackDef {
  id: string;
  name: string;
  location: string;
  description: string;
  /** Full road width in metres. */
  width: number;
  /** Closed loop of control points [x, z]. */
  controlPoints: ReadonlyArray<readonly [number, number]>;
  /** Fractions of the lap (0..1) where sector 1 and sector 2 end. */
  sectorFractions: readonly [number, number];
  laps: number;
  /** Short practice circuit that drills one skill (straights, turns or corners). Max 2 km a lap. */
  training?: boolean;
  /** Look of the surroundings: open parkland with trees, or city blocks. */
  scenery?: "park" | "city";
  /** Time of day and weather used when the player leaves them on "track default". */
  defaultConditions?: { time: "day" | "dusk" | "night"; weather: "clear" | "rain" };
}

/**
 * The circuits were lengthened on this date (laps are roughly three times longer). Races saved before it
 * are kept in the history but left out of the fastest-lap tables, and old ghosts and personal bests are not
 * reused, because those times belong to the old, shorter layouts.
 */
export const LAYOUT_EPOCH = "2026-10-29T00:00:00.000Z";

/** Stretch a layout drawn on a small grid up to full circuit size. Corner shapes stay the same, the road just gets longer. */
function stretch(points: ReadonlyArray<readonly [number, number]>, k: number): Array<readonly [number, number]> {
  return points.map(([x, z]) => [Math.round(x * k), Math.round(z * k)] as const);
}

export const TRACKS: readonly TrackDef[] = [
  {
    id: "apex-park",
    name: "Apex Park",
    location: "Fictional · open parkland",
    description: "Fast sweepers, a tight hairpin and a long main straight.",
    width: 14,
    laps: 3,
    sectorFractions: [0.34, 0.68],
    controlPoints: stretch([
      [-60, 0], [20, 0], [100, 0], [170, 10], [230, 50], [250, 120],
      [220, 180], [150, 200], [100, 170], [60, 190], [50, 250], [0, 290],
      [-70, 270], [-110, 210], [-90, 150], [-140, 100], [-170, 40], [-130, -10],
    ], 3.2),
  },
  {
    id: "harbour-loop",
    name: "Harbour Loop",
    location: "Fictional · dockside",
    description: "A short, technical loop that rewards smooth braking.",
    width: 12,
    laps: 4,
    sectorFractions: [0.33, 0.66],
    controlPoints: stretch([
      [-40, 0], [40, 0], [110, 20], [140, 80], [110, 140], [40, 160],
      [-20, 130], [-60, 150], [-120, 120], [-130, 50], [-90, 10],
    ], 3.6),
  },
  {
    id: "neon-street",
    name: "Neon Street",
    location: "Fictional · city centre",
    description: "Tight city blocks lined with buildings and street lamps. Barriers everywhere, so keep it clean.",
    width: 10,
    laps: 5,
    scenery: "city",
    defaultConditions: { time: "dusk", weather: "clear" },
    sectorFractions: [0.34, 0.68],
    controlPoints: stretch([
      [-50, 0], [60, 0], [150, 0], [205, 25], [225, 80], [205, 135], [155, 160],
      [130, 205], [145, 260], [105, 305], [40, 310], [-5, 275], [-10, 215],
      [-60, 190], [-115, 205], [-160, 175], [-165, 110], [-130, 55], [-95, 20],
    ], 2.8),
  },
  {
    id: "midnight-wet",
    name: "Midnight Wet",
    location: "Fictional · coastal night circuit",
    description: "Fast sweepers under floodlights in the rain. Grip is low and the braking zones are long.",
    width: 13,
    laps: 3,
    scenery: "park",
    defaultConditions: { time: "night", weather: "rain" },
    sectorFractions: [0.34, 0.67],
    controlPoints: stretch([
      [-60, 0], [40, 0], [140, -10], [225, 15], [285, 75], [275, 150], [215, 195],
      [150, 185], [110, 135], [55, 125], [25, 175], [50, 240], [10, 295],
      [-70, 290], [-125, 235], [-115, 160], [-165, 105], [-150, 35],
    ], 3),
  },
  {
    id: "training-straights",
    name: "Straights Training",
    location: "Training ground · straights",
    description: "Straight-line practice: two long straights for flat-out speed, braking points and launches.",
    width: 14,
    laps: 5,
    training: true,
    scenery: "park",
    defaultConditions: { time: "day", weather: "clear" },
    sectorFractions: [0.34, 0.68],
    controlPoints: [
      [0, 0], [70, 0], [140, 0], [210, 0], [280, 0], [350, 0],
      [420, 0], [490, 0], [560, 0], [572, 1], [583, 3], [594, 6],
      [605, 11], [615, 16], [624, 23], [633, 31], [640, 40], [647, 50],
      [652, 60], [656, 71], [658, 83], [660, 94], [660, 106], [658, 117],
      [656, 129], [652, 140], [647, 150], [640, 160], [633, 169], [624, 177],
      [615, 184], [605, 189], [594, 194], [583, 197], [572, 199], [560, 200],
      [490, 200], [420, 200], [350, 200], [280, 200], [210, 200], [140, 200],
      [70, 200], [0, 200], [-12, 199], [-23, 197], [-34, 194], [-45, 189],
      [-55, 184], [-64, 177], [-73, 169], [-80, 160], [-87, 150], [-92, 140],
      [-96, 129], [-98, 117], [-100, 106], [-100, 94], [-98, 83], [-96, 71],
      [-92, 60], [-87, 50], [-80, 40], [-73, 31], [-64, 23], [-55, 16],
      [-45, 11], [-34, 6], [-23, 3], [-12, 1],
    ],
  },
  {
    id: "training-turns",
    name: "Turns Training",
    location: "Training ground · turns",
    description: "Flowing sweepers and S-bends in a row. Practise smooth lines, turn-in and keeping speed through the esses.",
    width: 13,
    laps: 5,
    training: true,
    scenery: "park",
    defaultConditions: { time: "day", weather: "clear" },
    sectorFractions: [0.34, 0.68],
    controlPoints: [
      [0, 0], [70, 0], [140, 0], [152, 1], [163, 3], [174, 7],
      [184, 12], [194, 19], [202, 27], [210, 36], [217, 45], [225, 53],
      [235, 60], [245, 65], [256, 69], [268, 72], [279, 72], [291, 72],
      [302, 69], [313, 65], [324, 60], [333, 53], [342, 45], [349, 36],
      [356, 27], [365, 19], [374, 12], [385, 7], [395, 3], [407, 1],
      [419, 0], [449, 0], [459, 1], [470, 3], [480, 8], [490, 13],
      [498, 21], [505, 29], [511, 38], [515, 48], [518, 59], [519, 70],
      [519, 125], [519, 180], [518, 191], [515, 202], [511, 212], [505, 221],
      [498, 229], [490, 237], [480, 242], [470, 247], [459, 249], [449, 250],
      [399, 250], [349, 250], [299, 250], [287, 251], [275, 253], [265, 257],
      [254, 262], [245, 269], [236, 277], [229, 286], [222, 295], [213, 303],
      [204, 310], [193, 315], [182, 319], [171, 322], [159, 322], [148, 322],
      [136, 319], [125, 315], [115, 310], [105, 303], [97, 295], [90, 286],
      [82, 277], [74, 269], [64, 262], [54, 257], [43, 253], [32, 251],
      [20, 250], [0, 250], [-11, 249], [-22, 247], [-32, 242], [-41, 237],
      [-49, 229], [-57, 221], [-62, 212], [-67, 202], [-69, 191], [-70, 180],
      [-70, 125], [-70, 70], [-69, 59], [-67, 48], [-62, 38], [-57, 29],
      [-49, 21], [-41, 13], [-32, 8], [-22, 3], [-11, 1],
    ],
  },
  {
    id: "training-corners",
    name: "Corners Training",
    location: "Training ground · corners",
    description: "Tight 90° corners, a chicane and a hairpin. Practise late braking, rotation and getting back on the power.",
    width: 11,
    laps: 5,
    training: true,
    scenery: "park",
    defaultConditions: { time: "day", weather: "clear" },
    sectorFractions: [0.34, 0.68],
    controlPoints: [
      [0, 0], [67, 0], [133, 0], [200, 0], [210, 1], [220, 5],
      [229, 11], [238, 16], [247, 20], [258, 21], [268, 20], [278, 16],
      [287, 11], [296, 5], [305, 1], [316, 0], [376, 0], [387, 3],
      [395, 11], [398, 22], [398, 82], [398, 142], [398, 202], [398, 262],
      [396, 274], [392, 284], [385, 294], [375, 301], [364, 305], [353, 307],
      [291, 307], [229, 307], [167, 307], [105, 307], [44, 307], [-18, 307],
      [-80, 307], [-90, 305], [-99, 298], [-103, 288], [-103, 278], [-99, 268],
      [-90, 261], [-80, 259], [-35, 259], [10, 259], [20, 257], [29, 250],
      [33, 240], [33, 230], [29, 220], [20, 213], [10, 211], [-30, 211],
      [-41, 209], [-51, 202], [-58, 192], [-60, 181], [-60, 121], [-60, 60],
      [-59, 48], [-55, 37], [-50, 27], [-42, 18], [-33, 10], [-23, 5],
      [-12, 1],
    ],
  },
];

export function getTrack(id: string): TrackDef {
  const t = TRACKS.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown track: ${id}`);
  return t;
}
