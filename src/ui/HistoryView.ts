import { formatTime } from "./HUD";
import { leaderboard, summarize, type RaceRecord } from "../race/history";
import type { TrackDef } from "../track/tracks";

function h<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function row(cells: string[], header = false, cls = ""): HTMLTableRowElement {
  const tr = h("tr");
  if (cls) tr.className = cls;
  for (const c of cells) tr.appendChild(h(header ? "th" : "td", c));
  return tr;
}

function table(head: string[], rows: HTMLTableRowElement[]): HTMLTableElement {
  const t = h("table");
  const thead = h("thead");
  thead.appendChild(row(head, true));
  const tbody = h("tbody");
  rows.forEach((r) => tbody.appendChild(r));
  t.append(thead, tbody);
  return t;
}

function dateText(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Fills `root` with the race history. Every value goes in through textContent,
 * so a driver name can never inject markup.
 */
export function renderHistory(
  root: HTMLElement,
  all: readonly RaceRecord[],
  tracks: readonly TrackDef[],
  myDriverId: string,
  scope: "mine" | "all",
): void {
  root.replaceChildren();
  const records = scope === "mine" ? all.filter((r) => r.driverId === myDriverId) : all;

  if (records.length === 0) {
    root.appendChild(h("p", scope === "mine" ? "No races yet. Finish a lap in Circuit Racing mode and it will show up here." : "Nothing saved on this device yet.", "sub"));
    return;
  }

  const s = summarize(records);
  const stats = h("div", undefined, "hist-stats");
  const stat = (label: string, value: string) => {
    const box = h("div", undefined, "hist-stat");
    box.append(h("strong", value), h("span", label));
    stats.appendChild(box);
  };
  stat("Races", String(s.races));
  stat("Finished", String(s.completed));
  stat("Laps", String(s.laps));
  stat("Points", String(s.points));
  stat("1v1 wins", String(s.wins));
  stat("Top speed", `${s.topSpeedKmh} km/h`);
  root.appendChild(stats);

  // Fastest laps per track on this device.
  const boards = tracks
    .map((t) => ({ t, board: leaderboard(records, t.id, 5) }))
    .filter((b) => b.board.length > 0);
  if (boards.length) {
    root.appendChild(h("h2", "Fastest laps on this device"));
    for (const { t, board } of boards) {
      root.appendChild(h("h3", t.name));
      root.appendChild(
        table(
          ["#", "Driver", "Best lap"],
          board.map((b, i) => row([String(i + 1), b.driver, formatTime(b.bestMs)], false, b.driverId === myDriverId ? "me" : "")),
        ),
      );
    }
  }

  root.appendChild(h("h2", "Previous races"));
  const list = h("div", undefined, "hist-list");
  records.forEach((r, i) => {
    const d = h("details");
    const sum = h("summary");
    const status = r.completed ? "Finished" : "Left early";
    const vs = r.versus ? ` · vs ${r.versus.opponentName}${r.versus.place ? ` (P${r.versus.place})` : ""}` : "";
    sum.textContent = `${dateText(r.startedAt)} · ${r.trackName} · ${r.driver}${vs} · best ${formatTime(r.bestMs)} · ${status}${r.points ? ` · ${r.points} pts` : ""}`;
    d.appendChild(sum);
    const info = h(
      "p",
      `Race ${records.length - i} · ${r.laps.length} of ${r.totalLaps} laps · total ${formatTime(r.totalMs)} · top speed ${r.topSpeedKmh} km/h · ${r.collisions} barrier hits`,
      "sub",
    );
    d.appendChild(info);
    d.appendChild(
      table(
        ["Lap", "Time", "Sectors", ""],
        r.laps.map((l) =>
          row([String(l.lap), formatTime(l.ms), l.sectors.map((x) => formatTime(x)).join(" · "), l.valid ? "Valid" : "Invalid"], false, l.valid ? "" : "invalid"),
        ),
      ),
    );
    list.appendChild(d);
  });
  root.appendChild(list);
}
