/** Size of the game stage in CSS pixels (the window, unless the game is turned 90 degrees). */
export function stageDims(): { w: number; h: number } {
  const el = typeof document !== "undefined" ? document.getElementById("stage") : null;
  const w = el?.offsetWidth || window.innerWidth;
  const h = el?.offsetHeight || window.innerHeight;
  return { w, h };
}
