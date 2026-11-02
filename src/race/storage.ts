/** Personal bests live in localStorage. Every access is guarded: storage can be blocked or full. */
const key = (trackId: string) => `trackrush.best.${trackId}`;

export function loadBest(trackId: string): number | null {
  try {
    const raw = localStorage.getItem(key(trackId));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function saveBest(trackId: string, ms: number): void {
  try {
    localStorage.setItem(key(trackId), String(Math.round(ms)));
  } catch {
    /* storage unavailable: the best simply isn't remembered */
  }
}

export function loadSetting(name: string, fallback: string): string {
  try {
    return localStorage.getItem(`trackrush.${name}`) ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveSetting(name: string, value: string): void {
  try {
    localStorage.setItem(`trackrush.${name}`, value);
  } catch {
    /* ignore */
  }
}
