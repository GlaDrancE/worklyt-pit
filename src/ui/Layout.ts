import { resolveLayout, stageSize, type Layout, type LayoutPref } from "./orientation";

/**
 * Owns the screen layout. Sets `data-layout` on <html> (the CSS reads it), and when the player forces an
 * orientation the device is not in, turns the #stage element 90 degrees so the game still shows that way.
 * Nothing here touches the race: a layout change only resizes things, so the race carries on.
 */
export class ScreenLayout {
  private pref: LayoutPref = "auto";
  private current: Layout = "landscape";
  private turned = false;
  private readonly canRotate: boolean;
  onChange: (layout: Layout) => void = () => {};

  constructor(
    private readonly stage: HTMLElement,
    private readonly root: HTMLElement = document.documentElement,
  ) {
    this.canRotate = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
    window.addEventListener("resize", this.apply);
    window.addEventListener("orientationchange", this.apply);
    window.visualViewport?.addEventListener("resize", this.apply);
    this.apply();
  }

  get layout(): Layout {
    return this.current;
  }

  /** True while the game is turned on screen, so touch positions need turning back. */
  get rotated(): boolean {
    return this.turned;
  }

  setPref(pref: LayoutPref): void {
    this.pref = pref;
    // A real orientation lock only works in full screen on most phones; where it does not, the turn below covers it.
    try {
      const o = screen.orientation as ScreenOrientation & { lock?: (t: string) => Promise<void>; unlock?: () => void };
      if (pref === "auto") o.unlock?.();
      else void o.lock?.(pref)?.catch(() => {});
    } catch {
      /* not supported */
    }
    this.apply();
  }

  /** Stage point from a pointer position on screen. */
  toStage(clientX: number, clientY: number): { x: number; y: number } {
    if (!this.turned) return { x: clientX, y: clientY };
    return { x: clientY, y: window.innerWidth - clientX };
  }

  private readonly apply = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const r = resolveLayout(this.pref, w, h, this.canRotate);
    const size = stageSize(w, h, r.rotate);
    const st = this.stage.style;
    st.width = `${size.w}px`;
    st.height = `${size.h}px`;
    st.transform = r.rotate ? `translateX(${w}px) rotate(90deg)` : "none";
    this.root.style.setProperty("--sw", `${size.w}px`);
    this.root.style.setProperty("--sh", `${size.h}px`);
    this.turned = r.rotate;
    this.root.dataset.compact = r.layout === "landscape" && size.h <= 520 ? "1" : "0";
    this.root.dataset.rotated = r.rotate ? "1" : "0";
    const changed = r.layout !== this.current || this.root.dataset.layout === undefined;
    this.current = r.layout;
    this.root.dataset.layout = r.layout;
    // The renderer listens for resize; send one so it picks up the stage size (also after a turn).
    if (r.rotate || changed) window.dispatchEvent(new Event("trackrush-stage"));
    if (changed) this.onChange(r.layout);
  };

  dispose(): void {
    window.removeEventListener("resize", this.apply);
    window.removeEventListener("orientationchange", this.apply);
  }
}
