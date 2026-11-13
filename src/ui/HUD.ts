import { gearFor } from "./orientation";
import type { LapResult } from "../race/RaceManager";
import type { Standing } from "../net/protocol";

export interface RankRow {
  id: string;
  name: string;
  ms: number;
}

/** Fills an <ol> with ranking rows. Names go in as text, never as markup. */
export function fillRanking(list: HTMLElement, rows: readonly RankRow[], meId: string): void {
  list.replaceChildren();
  rows.forEach((r) => {
    const li = document.createElement("li");
    if (r.id === meId) li.className = "me";
    const name = document.createElement("span");
    name.textContent = r.id === meId ? `${r.name} (you)` : r.name;
    const time = document.createElement("span");
    time.className = "t";
    time.textContent = formatTime(r.ms);
    li.append(name, time);
    list.appendChild(li);
  });
}

export function formatTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "--";
  const total = Math.max(0, Math.round(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const milli = total % 1000;
  return `${m}:${String(s).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

/** All DOM updates for the in-game overlay. Game code never touches the DOM directly. */
export class HUD {
  readonly root = el<HTMLDivElement>("hud");
  private readonly lap = el<HTMLSpanElement>("hud-lap");
  private readonly time = el<HTMLSpanElement>("hud-time");
  private readonly best = el<HTMLSpanElement>("hud-best");
  private readonly last = el<HTMLSpanElement>("hud-last");
  private readonly kmh = el<HTMLSpanElement>("hud-kmh");
  private readonly gearEl = document.getElementById("hud-gear");
  private readonly rpmEl = document.getElementById("hud-rpm");
  private readonly sectors = el<HTMLDivElement>("hud-sectors");
  private readonly toastEl = el<HTMLDivElement>("hud-toast");
  private readonly countdownEl = el<HTMLDivElement>("countdown");
  private readonly results = el<HTMLDivElement>("results");
  private readonly resultsBody = el<HTMLDivElement>("results-body");
  private toastTimer = 0;
  private countdownTimer = 0;
  private lastText = { lap: "", time: "", kmh: "", gear: "" };

  setVisible(v: boolean): void {
    this.root.classList.toggle("hidden", !v);
  }

  setOnlineResultMode(online: boolean): void {
    this.results.classList.toggle("online-result", online);
  }

  /** Free drive hides every timing widget. */
  setMode(mode: "race" | "free"): void {
    this.root.classList.toggle("free", mode === "free");
    el("hud-top").classList.toggle("hidden", mode === "free");
    this.sectors.classList.toggle("hidden", mode === "free");
  }

  /** Race position among the rivals, or null when racing alone. Laps left only shows in the landscape layout. */
  setPosition(pos: number | null, total: number, lapsLeft: number): void {
    const box = document.getElementById("stat-pos");
    const val = document.getElementById("hud-pos");
    const left = document.getElementById("hud-left");
    box?.classList.toggle("hidden", pos === null);
    if (pos !== null && val) {
      const t = `${pos}/${total}`;
      if (t !== val.textContent) val.textContent = t;
    }
    if (left && String(lapsLeft) !== left.textContent) left.textContent = String(lapsLeft);
  }

  setLap(n: number, total: number): void {
    const t = `${n}/${total}`;
    if (t !== this.lastText.lap) {
      this.lap.textContent = t;
      this.lastText.lap = t;
    }
  }

  setTime(ms: number): void {
    const t = formatTime(ms);
    if (t !== this.lastText.time) {
      this.time.textContent = t;
      this.lastText.time = t;
    }
  }

  setBest(ms: number | null): void {
    this.best.textContent = formatTime(ms);
  }

  setLast(ms: number | null, valid = true): void {
    this.last.textContent = formatTime(ms) + (valid || ms === null ? "" : " ✕");
  }

  setSpeed(kmh: number): void {
    const t = String(Math.round(kmh));
    if (t !== this.lastText.kmh) {
      this.kmh.textContent = t;
      this.lastText.kmh = t;
    }
    const { gear, rpm } = gearFor(kmh);
    const g = gear === 0 ? "N" : String(gear);
    if (g !== this.lastText.gear && this.gearEl) {
      this.gearEl.textContent = g;
      this.lastText.gear = g;
    }
    if (this.rpmEl) {
      this.rpmEl.style.width = `${Math.round(rpm * 100)}%`;
      this.rpmEl.classList.toggle("redline", rpm > 0.93);
    }
  }

  /** Shows S1/S2/S3 chips. `state` marks a finished sector and whether it was a best. */
  setSectors(chips: Array<{ text: string; done: boolean; best: boolean }>): void {
    this.sectors.replaceChildren(
      ...chips.map((c, i) => {
        const d = document.createElement("div");
        d.textContent = `S${i + 1} ${c.text}`;
        if (c.done) d.classList.add("done");
        if (c.best) d.classList.add("best");
        return d;
      }),
    );
  }

  toast(text: string, ms = 2200): void {
    this.toastEl.textContent = text;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.textContent = ""), ms);
  }

  countdown(text: string | null, clearAfterMs = 0): void {
    this.countdownEl.textContent = text ?? "";
    window.clearTimeout(this.countdownTimer);
    if (text !== null && clearAfterMs > 0) {
      this.countdownTimer = window.setTimeout(() => (this.countdownEl.textContent = ""), clearAfterMs);
    }
  }

  showResults(trackName: string, laps: readonly LapResult[], bestMs: number | null, driverName = ""): void {
    const rows = laps
      .map(
        (l) =>
          `<tr class="${l.valid ? "" : "invalid"}"><td>${l.lap}</td><td>${formatTime(l.ms)}</td>` +
          `<td>${l.sectors.map((s) => formatTime(s)).join(" · ")}</td><td>${l.valid ? "Valid" : "Invalid"}</td></tr>`,
      )
      .join("");
    this.resultsBody.innerHTML =
      `<p class="sub">${trackName} · simulated game data</p>` +
      (driverName ? `<p>Driver: <strong id="results-driver"></strong> · saved to your race history</p>` : "") +
      `<p>Best valid lap: <strong>${formatTime(bestMs)}</strong></p>` +
      `<table><thead><tr><th>Lap</th><th>Time</th><th>Sectors</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    const nameEl = this.resultsBody.querySelector("#results-driver");
    if (nameEl) nameEl.textContent = driverName;
    this.results.classList.remove("hidden");
  }

  /** Position read-out for 1v1 races; pass null to hide it. */
  setVersus(text: string | null, state: "ahead" | "behind" | "" = ""): void {
    const node = el("hud-versus");
    node.classList.toggle("hidden", text === null);
    node.classList.toggle("ahead", state === "ahead");
    node.classList.toggle("behind", state === "behind");
    if (text !== null) node.textContent = text;
  }

  /** Time gap to your best-lap ghost; pass null to hide it. */
  setGhost(text: string | null, state: "ahead" | "behind" | "" = ""): void {
    const node = el("hud-ghost");
    node.classList.toggle("hidden", text === null);
    node.classList.toggle("ahead", state === "ahead");
    node.classList.toggle("behind", state === "behind");
    if (text !== null) node.textContent = text;
  }

  /** Drift combo pill; pass null to hide. `state` colours it. */
  setDrift(text: string | null, state: "" | "idle" | "bank" | "lost" = "", mult = 1): void {
    const node = el("hud-drift");
    node.classList.toggle("hidden", text === null);
    node.classList.toggle("idle", state === "idle");
    node.classList.toggle("bank", state === "bank");
    node.classList.toggle("lost", state === "lost");
    if (text === null) return;
    node.textContent = text;
    if (mult > 1) {
      const small = document.createElement("small");
      small.textContent = `×${mult}`;
      node.appendChild(small);
    }
  }

  /** Tyre read-out; pass null (tyre wear off) to hide it. */
  setTyres(t: { name: string; color: string; lifePercent: number } | null): void {
    const box = el("hud-tyres");
    box.classList.toggle("hidden", t === null);
    if (!t) return;
    el("tyre-dot").style.borderColor = t.color;
    el("tyre-text").textContent = `${t.name} · ${t.lifePercent}%`;
    const bar = el("tyre-bar");
    bar.style.width = `${t.lifePercent}%`;
    bar.style.background = t.lifePercent > 50 ? "#8dff9b" : t.lifePercent > 25 ? "#ffd21f" : "#ff6b6b";
  }

  /** Car damage read-out: per-zone health (1 = new). Pass null to hide. */
  setDamage(health: Record<string, number> | null, text = ""): void {
    const box = el("hud-damage");
    box.classList.toggle("hidden", health === null);
    if (!health) return;
    box.querySelectorAll<SVGRectElement>("[data-z]").forEach((r) => {
      const h = health[r.dataset.z ?? ""] ?? 1;
      r.setAttribute("fill", h > 0.7 ? "#8dff9b" : h > 0.35 ? "#ffd21f" : h > 0.02 ? "#ff6b3d" : "#555");
      r.setAttribute("fill-opacity", h <= 0.02 ? "0.45" : "1");
    });
    el("dmg-text").textContent = text;
  }

  /** Race-control banner (yellow flag, safety car...). Pass null to hide. */
  setFlag(text: string | null, kind: "yellow" | "sc" | "green" | "red" = "yellow"): void {
    const box = el("hud-flag");
    box.classList.toggle("hidden", text === null);
    if (text === null) return;
    box.className = kind === "yellow" ? "" : kind;
    box.textContent = text;
  }

  /** Pit-stop progress; pass null to hide. */
  setPit(text: string | null, progress = 0): void {
    const box = el("hud-pit");
    box.classList.toggle("hidden", text === null);
    if (text === null) return;
    el("pit-text").textContent = text;
    el("pit-bar").style.width = `${Math.round(progress * 100)}%`;
  }

  /** Achievements earned in the race just finished; pass an empty list to hide. */
  setResultAchievements(items: ReadonlyArray<{ name: string; description: string }>): void {
    const list = el("results-ach");
    list.classList.toggle("hidden", items.length === 0);
    list.replaceChildren();
    for (const a of items) {
      const li = document.createElement("li");
      li.className = "new";
      const strong = document.createElement("strong");
      strong.textContent = `Achievement unlocked: ${a.name}`;
      const span = document.createElement("span");
      span.textContent = a.description;
      li.append(strong, span);
      list.appendChild(li);
    }
  }

  setDriftResult(text: string | null): void {
    const node = el("results-drift");
    node.classList.toggle("hidden", text === null);
    node.textContent = text ?? "";
  }

  /** The "starting grid" ranking shown before the lights go out. */
  showGrid(title: string, rows: readonly RankRow[], meId: string): void {
    el("grid-title").textContent = title;
    fillRanking(el("grid-list"), rows, meId);
    el("grid").classList.toggle("hidden", rows.length === 0);
  }

  hideGrid(): void {
    el("grid").classList.add("hidden");
  }

  setPoints(text: string | null): void {
    const node = el("results-points");
    node.classList.toggle("hidden", text === null);
    node.textContent = text ?? "";
  }

  /** Tell the player we're waiting on the other driver. */
  showVersusWaiting(opponent: string): void {
    const box = el("results-versus");
    box.replaceChildren();
    const p = document.createElement("p");
    p.className = "sub";
    p.textContent = `Waiting for ${opponent} to finish…`;
    box.appendChild(p);
  }

  clearVersus(): void {
    el("results-versus").replaceChildren();
  }

  showVersusResult(standings: readonly Standing[], meId: string, forfeit: boolean): void {
    const box = el("results-versus");
    box.replaceChildren();
    const me = standings.find((s) => s.id === meId);
    const h2 = document.createElement("h2");
    h2.textContent =
      me?.place === 1
        ? forfeit
          ? "You win by forfeit!"
          : "You win! 🏆"
        : me && me.place <= 3 && standings.length > 2
          ? "Podium finish! 🏅"
          : "Good race!";
    box.appendChild(h2);
    const table = document.createElement("table");
    const head = document.createElement("tr");
    for (const c of ["Pos", "Driver", "Time", "Points"]) {
      const th = document.createElement("th");
      th.textContent = c;
      head.appendChild(th);
    }
    table.appendChild(head);
    for (const s of standings) {
      const tr = document.createElement("tr");
      if (s.id === meId) tr.className = "me";
      const cells = [String(s.place), s.name, s.totalMs === null ? "DNF" : formatTime(s.totalMs), `+${s.points}`];
      for (const c of cells) {
        const td = document.createElement("td");
        td.textContent = c;
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    box.appendChild(table);
  }

  setResultsButtons(versus: boolean): void {
    el("results-restart").textContent = versus ? "Back to lobby" : "Race again";
  }

  hideResults(): void {
    this.results.classList.add("hidden");
  }

  clearTransient(): void {
    window.clearTimeout(this.toastTimer);
    window.clearTimeout(this.countdownTimer);
    this.toastEl.textContent = "";
    this.countdownEl.textContent = "";
  }
}
