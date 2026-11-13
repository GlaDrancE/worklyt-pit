import type { Game, RaceOutcome, RivalOptions } from "../game/Game";
import type { Difficulty } from "../race/Rivals";
import type { TrackDef } from "../track/tracks";
import { loadSetting, saveSetting } from "../race/storage";
import { loadHistory, summarize } from "../race/history";
import { rivalCompanyNames } from "../race/companies";
import { addDailyResult, dailyChallenge, dateKey, sanitizeDaily, stars, streak, type DailyResult } from "../race/daily";
import { CAR_COLOURS, newlyUnlocked, nextColour, pickColour } from "../race/unlocks";
import { currentTrack, isFinished, newSeason, pointsForPlace, recordRound, sanitizeSeason, standings, type Season } from "../race/championship";

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

export interface ModesCtx {
  game: Game;
  tracks: readonly TrackDef[];
  driverId: string;
  difficulty(): Difficulty;
  /** Start a race against rivals on a circuit (closes the menu, shows the touch controls). */
  start(trackId: string, rivals: RivalOptions): void;
}

const SEASON_RIVALS = 5;
const MAX_ROUNDS = 4;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "", cls = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};

/** Daily challenge, championship season and car-colour unlocks. All state stays on this device. */
export function setupModes(ctx: ModesCtx): { clearActive(): void } {
  const { game } = ctx;
  const trackName = (id: string) => ctx.tracks.find((t) => t.id === id)?.name ?? id;
  const panel = byId("challenges");
  const resultsExtra = byId("results-extra");

  let daily: DailyResult[] = (() => {
    try {
      return sanitizeDaily(JSON.parse(loadSetting("daily", "[]")));
    } catch {
      return [];
    }
  })();
  let season: Season | null = (() => {
    try {
      return sanitizeSeason(JSON.parse(loadSetting("season", "null")), ctx.tracks.map((t) => t.id));
    } catch {
      return null;
    }
  })();
  let activeDaily: string | null = null;
  let pendingRound: { id: string; round: number } | null = null;

  const myPoints = () => summarize(loadHistory().filter((r) => r.driverId === ctx.driverId)).points;
  let knownPoints = myPoints();

  // Car colours --------------------------------------------------------------
  const liverySelect = byId<HTMLSelectElement>("livery-select");
  const liveryDesc = byId("livery-desc");
  const fillColours = (): void => {
    const pts = myPoints();
    const keep = loadSetting("livery", CAR_COLOURS[0]!.id);
    liverySelect.replaceChildren(
      ...CAR_COLOURS.map((c) => {
        const o = el("option");
        const open = pts >= c.points;
        o.value = c.id;
        o.disabled = !open;
        o.textContent = open ? c.name : `🔒 ${c.name} · ${c.points} points`;
        return o;
      }),
    );
    const pick = pickColour(keep, pts);
    liverySelect.value = pick.id;
    game.setLivery(pick.livery);
    const next = nextColour(pts);
    const text = next ? `${pts} points so far. Next colour: ${next.name} at ${next.points} points (10 per clean lap, more for finishing high).` : `${pts} points. Every colour is unlocked!`;
    liveryDesc.textContent = text;
    byId("unlock-line").textContent = text;
  };
  liverySelect.addEventListener("change", () => {
    const c = pickColour(liverySelect.value, myPoints());
    saveSetting("livery", c.id);
    game.setLivery(c.livery);
  });
  fillColours();

  // Panel --------------------------------------------------------------------
  const today = () => dateKey(new Date());
  const starText = (n: number) => "★".repeat(n) + "☆".repeat(3 - n);

  const drawDaily = (): void => {
    const box = byId("daily-box");
    const ch = dailyChallenge(today(), ctx.tracks.map((t) => t.id));
    const mine = daily.find((d) => d.key === ch.key);
    const lines = [
      el("p", `${trackName(ch.trackId)} · ${ch.time} · ${ch.weather === "rain" ? "rain" : "dry"} · ${ch.rivals} rivals (${ch.difficulty})`, "points"),
      el("p", mine ? `Today's best: P${mine.place} of ${mine.fieldSize} ${starText(stars(mine.place))}. Try again to beat it.` : "Not raced yet today. Finish it for 1 star, podium for 2, win for 3.", "sub"),
      el("p", `Streak: ${streak(daily, ch.key)} day${streak(daily, ch.key) === 1 ? "" : "s"} in a row. A new challenge appears at midnight.`, "sub"),
    ];
    box.replaceChildren(...lines);
    byId("daily-start").textContent = mine ? "Race today's challenge again" : "Start today's challenge";
  };

  const drawSeason = (): void => {
    const box = byId("season-box");
    const start = byId<HTMLButtonElement>("season-start");
    const reset = byId<HTMLButtonElement>("season-reset");
    if (!season) {
      box.replaceChildren(el("p", `${Math.min(MAX_ROUNDS, ctx.tracks.length)} races on different circuits against ${SEASON_RIVALS} rivals. Points 25-18-15-12-10-8, most points wins the title.`, "sub"));
      start.textContent = "Start a season";
      reset.classList.add("hidden");
      return;
    }
    const rows = standings(season);
    const kids: HTMLElement[] = [];
    if (isFinished(season)) {
      const champ = rows[0];
      kids.push(el("p", champ ? `Season over. Champion: ${champ.id === ctx.driverId ? "you!" : champ.name}` : "Season over.", "points"));
    } else {
      kids.push(el("p", `Round ${season.round + 1} of ${season.rounds.length}: ${trackName(currentTrack(season) ?? "")}`, "points"));
    }
    if (rows.length > 0) {
      const t = el("table");
      const head = el("tr");
      for (const h of ["#", "Driver", "Pts", "Wins"]) head.append(el("th", h));
      t.append(head);
      rows.forEach((r, i) => {
        const tr = el("tr", "", r.id === ctx.driverId ? "me" : "");
        tr.append(el("td", String(i + 1)), el("td", r.id === ctx.driverId ? `${r.name} (you)` : r.name), el("td", String(r.points)), el("td", String(r.wins)));
        t.append(tr);
      });
      kids.push(t);
    }
    box.replaceChildren(...kids);
    start.textContent = isFinished(season) ? "Start a new season" : season.round === 0 ? "Start round 1" : `Start round ${season.round + 1}`;
    reset.classList.toggle("hidden", isFinished(season) || season.round === 0);
  };

  const open = (): void => {
    drawDaily();
    drawSeason();
    fillColours();
    panel.classList.remove("hidden");
  };
  byId("modes-btn").addEventListener("click", open);
  byId("challenges-close").addEventListener("click", () => panel.classList.add("hidden"));

  byId("daily-start").addEventListener("click", () => {
    const ch = dailyChallenge(today(), ctx.tracks.map((t) => t.id));
    panel.classList.add("hidden");
    activeDaily = ch.key;
    pendingRound = null;
    ctx.start(ch.trackId, { count: ch.rivals, difficulty: ch.difficulty, conditions: { time: ch.time, weather: ch.weather } });
  });

  const freshSeason = (): Season => {
    const names = rivalCompanyNames(SEASON_RIVALS, Math.random, SEASON_RIVALS + 2);
    return newSeason(String(Date.now()), ctx.tracks.slice(0, MAX_ROUNDS).map((t) => t.id), names);
  };
  const saveSeason = () => saveSetting("season", JSON.stringify(season));

  byId("season-start").addEventListener("click", () => {
    if (!season || isFinished(season)) {
      season = freshSeason();
      saveSeason();
    }
    const track = currentTrack(season);
    if (!track) return;
    panel.classList.add("hidden");
    activeDaily = null;
    pendingRound = { id: season.id, round: season.round };
    ctx.start(track, { count: SEASON_RIVALS, difficulty: ctx.difficulty(), names: season.names });
  });
  byId("season-reset").addEventListener("click", () => {
    if (!window.confirm("Throw away this season and start a new one?")) return;
    season = null;
    saveSetting("season", "null");
    drawSeason();
  });

  // After a race ----------------------------------------------------------------
  game.onRaceResult = (r: RaceOutcome): void => {
    const lines: string[] = [];
    const mine = r.standings.find((s) => s.id === ctx.driverId);
    if (mine && activeDaily) {
      daily = addDailyResult(daily, { key: activeDaily, place: mine.place, fieldSize: r.standings.length, totalMs: r.totalMs, bestLapMs: r.bestLapMs });
      saveSetting("daily", JSON.stringify(daily));
      const n = streak(daily, activeDaily);
      lines.push(`Daily challenge: P${mine.place} of ${r.standings.length} ${starText(stars(mine.place))} · streak ${n} day${n === 1 ? "" : "s"}`);
    }
    if (mine && season && pendingRound && pendingRound.id === season.id && pendingRound.round === season.round) {
      season = recordRound(season, r.standings.map((s) => ({ id: s.id, name: s.name, place: s.place })));
      saveSeason();
      pendingRound = null;
      const rows = standings(season);
      const rank = rows.findIndex((x) => x.id === ctx.driverId) + 1;
      const pts = rows.find((x) => x.id === ctx.driverId)?.points ?? 0;
      lines.push(`Championship round ${season.round} of ${season.rounds.length}: P${mine.place}, +${pointsForPlace(mine.place)} points. You are ${rank}${["st", "nd", "rd"][rank - 1] ?? "th"} on ${pts}.`);
      if (isFinished(season)) lines.push(rows[0]?.id === ctx.driverId ? "SEASON CHAMPION! 🏆" : `Season over. Champion: ${rows[0]?.name ?? "?"}`);
      else lines.push(`Next: ${trackName(currentTrack(season) ?? "")}. Open "Daily challenge and season" on the menu.`);
    }
    const now = myPoints();
    for (const c of newlyUnlocked(knownPoints, now)) lines.push(`New car colour unlocked: ${c.name}`);
    knownPoints = now;
    fillColours();
    resultsExtra.replaceChildren(...lines.map((l) => el("div", l)));
    resultsExtra.classList.toggle("hidden", lines.length === 0);
  };

  return {
    clearActive(): void {
      activeDaily = null;
      pendingRound = null;
      resultsExtra.classList.add("hidden");
    },
  };
}
