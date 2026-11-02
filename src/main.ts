import "./style.css";
import RAPIER from "@dimforge/rapier3d-compat";
import { Game, type GameMode } from "./game/Game";
import { resolveConditions, type Conditions } from "./game/conditions";
import { setupModes } from "./ui/modes";
import { ScreenLayout } from "./ui/Layout";
import { InputManager } from "./game/InputManager";
import { QUALITY_ORDER, defaultQuality, type QualityLevel } from "./game/QualitySettings";
import { loadSetting, saveSetting } from "./race/storage";
import { CAR_COLOURS, colourName } from "./race/unlocks";
import { syncPlayer } from "./net/playerSync";
import { historyEvents } from "./race/history";
import { cleanName, clearHistory, generateDriverName, leaderboard, loadHistory, loadProfile, saveProfile } from "./race/history";
import { Multiplayer, type MatchInfo } from "./net/Multiplayer";
import { Confetti } from "./ui/Confetti";
import { renderHistory } from "./ui/HistoryView";
import { TRACKS } from "./track/tracks";
import { DEFAULT_ENGINE, ENGINES, getEngine } from "./audio/engineProfiles";
import type { Difficulty } from "./race/Rivals";
import { loadCarModel } from "./vehicle/carModel";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type CompoundId, type Settings } from "./game/settings";
import { ACHIEVEMENTS, loadUnlocked } from "./race/achievements";
import { tryNativeShare } from "./ui/ShareCard";
import { HUD, fillRanking, formatTime, type RankRow } from "./ui/HUD";

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

function showError(message: string): void {
  byId("loading").classList.add("hidden");
  byId("error-text").textContent = message;
  byId("error").classList.remove("hidden");
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  if (!webglAvailable()) {
    showError("This browser or device can't run WebGL, which the 3D game needs. Try a recent Chrome, Edge or Firefox.");
    return;
  }

  // The menu does not need the physics engine or the car model, only a race does, so they load in the
  // background while the player looks around. Starting a race waits for them (see startWhenReady).
  byId("loading-text").textContent = "Starting…";
  const engineReady = Promise.all([RAPIER.init(), loadCarModel()]).then(() => undefined);
  let engineLoaded = false;
  void engineReady.then(
    () => (engineLoaded = true),
    () => showError("The physics engine couldn't load. Check your connection and reload the page."),
  );
  const startWhenReady = (go: () => void): void => {
    if (engineLoaded) return go();
    const btn = document.getElementById("start-btn");
    const label = btn?.textContent ?? "";
    if (btn) btn.textContent = "Loading engine…";
    void engineReady.then(() => {
      if (btn) btn.textContent = label;
      go();
    });
  };

  const hud = new HUD();
  const touch = byId("touch");
  const isTouch = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
  const input = new InputManager(touch);

  const saved = loadSetting("quality", defaultQuality()) as QualityLevel;
  const quality = QUALITY_ORDER.includes(saved) ? saved : defaultQuality();
  const game = new Game(byId<HTMLCanvasElement>("game"), hud, input, quality, byId<HTMLCanvasElement>("minimap"));

  // Menu wiring -------------------------------------------------------------
  const trackSelect = byId<HTMLSelectElement>("track-select");
  const soloModeSelect = byId<HTMLSelectElement>("solo-mode-select");
  const qualitySelect = byId<HTMLSelectElement>("quality-select");
  const trackDesc = byId("track-desc");
  const raceGroup = document.createElement("optgroup");
  raceGroup.label = "Circuits";
  const trainGroup = document.createElement("optgroup");
  trainGroup.label = "Training grounds (short drills)";
  for (const t of TRACKS) {
    const o = document.createElement("option");
    o.value = t.id;
    o.textContent = `${t.name} · ${t.laps} laps`;
    (t.training ? trainGroup : raceGroup).appendChild(o);
  }
  trackSelect.append(raceGroup, trainGroup);
  const describe = () => {
    const t = TRACKS.find((x) => x.id === trackSelect.value);
    trackDesc.textContent = t ? `${t.location} — ${t.description}` : "";
  };
  trackSelect.addEventListener("change", () => {
    describe();
    drawRanking();
    mp?.requestBoard(trackSelect.value);
  });
  const rivalsSelect = byId<HTMLSelectElement>("rivals-select");
  const difficultySelect = byId<HTMLSelectElement>("difficulty-select");
  rivalsSelect.value = ["1", "3", "5"].includes(loadSetting("rivals", "3")) ? loadSetting("rivals", "3") : "3";
  soloModeSelect.value = loadSetting("soloMode", "race") === "free" ? "free" : "race";
  soloModeSelect.addEventListener("change", () => saveSetting("soloMode", soloModeSelect.value));
  difficultySelect.value = ["easy", "medium", "hard"].includes(loadSetting("difficulty", "medium")) ? loadSetting("difficulty", "medium") : "medium";
  rivalsSelect.addEventListener("change", () => saveSetting("rivals", rivalsSelect.value));
  difficultySelect.addEventListener("change", () => saveSetting("difficulty", difficultySelect.value));
  qualitySelect.value = game.qualityLevel;
  qualitySelect.addEventListener("change", () => {
    const level = qualitySelect.value as QualityLevel;
    game.setQuality(level);
    saveSetting("quality", level);
  });
  // Optional frame-rate badge, so players can see how their device copes.
  const fpsBox = byId<HTMLInputElement>("set-fps");
  const fpsBadge = byId("fps-badge");
  fpsBox.checked = loadSetting("showFps", "0") === "1";
  fpsBox.addEventListener("change", () => saveSetting("showFps", fpsBox.checked ? "1" : "0"));
  window.setInterval(() => {
    const show = fpsBox.checked && menu.classList.contains("hidden");
    fpsBadge.classList.toggle("hidden", !show);
    if (!show) return;
    const f = Math.round(game.fps);
    fpsBadge.textContent = `${f} FPS · ${game.qualityLevel}`;
    fpsBadge.classList.toggle("warn", f < 50 && f >= 35);
    fpsBadge.classList.toggle("bad", f < 35);
  }, 500);
  game.onQualityChange = (level) => {
    qualitySelect.value = level;
    saveSetting("quality", level);
  };

  // Handling ----------------------------------------------------------------
  const handlingSelect = byId<HTMLSelectElement>("handling-select");
  handlingSelect.value = loadSetting("handling", "grip") === "drift" ? "drift" : "grip";
  game.setHandling(handlingSelect.value);
  handlingSelect.addEventListener("change", () => {
    game.setHandling(handlingSelect.value);
    saveSetting("handling", handlingSelect.value);
  });

  // Settings, race conditions, tyres ----------------------------------------------
  let settings: Settings = loadSettings();
  let applyScreen: () => void = () => {};
  const persist = () => {
    saveSettings(settings);
    game.applySettings(settings);
    applyScreen();
  };
  const timeSelect = byId<HTMLSelectElement>("time-select");
  const weatherSelect = byId<HTMLSelectElement>("weather-select");
  const tyreSelect = byId<HTMLSelectElement>("tyre-select");
  const damageSelect = byId<HTMLSelectElement>("damage-select");
  const syncMenuSelects = () => {
    timeSelect.value = ["track", "day", "dusk", "night"].includes(settings.time) ? settings.time : "track";
    weatherSelect.value = ["track", "clear", "rain"].includes(settings.weather) ? settings.weather : "track";
    tyreSelect.value = settings.tyreWear ? settings.compound : "off";
    damageSelect.value = settings.damage;
  };
  syncMenuSelects();
  timeSelect.addEventListener("change", () => {
    settings = { ...settings, time: timeSelect.value };
    persist();
  });
  weatherSelect.addEventListener("change", () => {
    settings = { ...settings, weather: weatherSelect.value };
    persist();
  });
  tyreSelect.addEventListener("change", () => {
    settings =
      tyreSelect.value === "off"
        ? { ...settings, tyreWear: false }
        : { ...settings, tyreWear: true, compound: tyreSelect.value as CompoundId };
    persist();
  });

  damageSelect.addEventListener("change", () => {
    settings = { ...settings, damage: damageSelect.value as Settings["damage"] };
    persist();
  });

  const settingsPanel = byId("settings");
  const steerIn = byId<HTMLInputElement>("set-steer");
  const sensIn = byId<HTMLInputElement>("set-sens");
  const assistIn = byId<HTMLSelectElement>("set-assist");
  const feelIn = byId<HTMLSelectElement>("set-feel");
  const volumeIn = byId<HTMLInputElement>("set-volume");
  const deadIn = byId<HTMLInputElement>("set-dead");
  const curveIn = byId<HTMLInputElement>("set-curve");
  const vibeIn = byId<HTMLInputElement>("set-vibe");
  const padStatus = byId("pad-status");
  const layoutIn = byId<HTMLSelectElement>("set-layout");
  const styleIn = byId<HTMLSelectElement>("set-ctrlstyle");
  const swapIn = byId<HTMLInputElement>("set-swap");
  const easyIn = byId<HTMLInputElement>("set-easy");
  const lampsIn = byId<HTMLInputElement>("set-lamps");
  lampsIn.checked = settings.streetLights;
  const scaleIn = byId<HTMLInputElement>("set-scale");
  const opacityIn = byId<HTMLInputElement>("set-opacity");
  const raiseIn = byId<HTMLInputElement>("set-raise");
  const tiltIn = byId<HTMLInputElement>("set-tilt");
  const tiltSensIn = byId<HTMLInputElement>("set-tiltsens");
  const tiltInvIn = byId<HTMLInputElement>("set-tiltinv");
  const screenLayout = new ScreenLayout(byId("stage"));
  input.setStageMapper((x, y) => screenLayout.toStage(x, y));
  const showSettings = () => {
    steerIn.value = String(settings.steerSpeed);
    sensIn.value = String(settings.steerSens);
    byId("set-sens-val").textContent = `${Math.round(settings.steerSens * 100)}%`;
    assistIn.value = settings.assist;
    feelIn.value = settings.steerFeel;
    volumeIn.value = String(settings.volume);
    deadIn.value = String(settings.deadzone);
    curveIn.value = String(settings.stickCurve);
    vibeIn.checked = settings.vibration;
    byId("set-steer-val").textContent = `${Math.round(settings.steerSpeed * 100)}%`;
    byId("set-volume-val").textContent = `${Math.round(settings.volume * 100)}%`;
    byId("set-dead-val").textContent = settings.deadzone.toFixed(2);
    byId("set-curve-val").textContent = settings.stickCurve.toFixed(1);
    layoutIn.value = settings.layout;
    styleIn.value = settings.ctrlStyle;
    swapIn.checked = settings.swapSides;
    easyIn.checked = settings.easyDrive;
    lampsIn.checked = settings.streetLights;
    const c = settings.controls[screenLayout.layout];
    byId("set-which").textContent = screenLayout.layout;
    scaleIn.value = String(c.scale);
    opacityIn.value = String(c.opacity);
    raiseIn.value = String(c.raise);
    byId("set-scale-val").textContent = `${Math.round(c.scale * 100)}%`;
    byId("set-opacity-val").textContent = `${Math.round(c.opacity * 100)}%`;
    byId("set-raise-val").textContent = `${c.raise}px`;
    tiltIn.checked = settings.tilt;
    tiltSensIn.value = String(settings.tiltSens);
    tiltInvIn.checked = settings.tiltInvert;
    byId("set-tiltsens-val").textContent = `${Math.round(settings.tiltSens * 100)}%`;
    byId("tilt-opts").classList.toggle("hidden", !settings.tilt);
  };
  const pollPad = () => {
    const name = game.controllerName;
    padStatus.textContent = name
      ? `Controller connected: ${name.replace(/\s*\(.*$/, "")}`
      : "No controller detected. Connect one and press any button on it.";
  };
  let padTimer: number | undefined;
  byId("settings-btn").addEventListener("click", () => {
    showSettings();
    pollPad();
    window.clearInterval(padTimer);
    padTimer = window.setInterval(pollPad, 700);
    settingsPanel.classList.remove("hidden");
  });
  byId("settings-close").addEventListener("click", () => {
    window.clearInterval(padTimer);
    settingsPanel.classList.add("hidden");
  });
  const fromInputs = () => {
    settings = {
      ...settings,
      steerSpeed: Number(steerIn.value),
      steerSens: Number(sensIn.value),
      assist: assistIn.value as Settings["assist"],
      steerFeel: feelIn.value as Settings["steerFeel"],
      volume: Number(volumeIn.value),
      deadzone: Number(deadIn.value),
      stickCurve: Number(curveIn.value),
      vibration: vibeIn.checked,
      layout: layoutIn.value as Settings["layout"],
      ctrlStyle: styleIn.value as Settings["ctrlStyle"],
      swapSides: swapIn.checked,
      easyDrive: easyIn.checked,
      streetLights: lampsIn.checked,
      tilt: tiltIn.checked,
      tiltSens: Number(tiltSensIn.value),
      tiltInvert: tiltInvIn.checked,
      controls: {
        ...settings.controls,
        [screenLayout.layout]: { scale: Number(scaleIn.value), opacity: Number(opacityIn.value), raise: Number(raiseIn.value) },
      },
    };
    persist();
    settings = loadSettings();
    showSettings();
  };
  for (const el of [steerIn, sensIn, assistIn, feelIn, volumeIn, deadIn, curveIn, vibeIn, layoutIn, styleIn, swapIn, easyIn, lampsIn, scaleIn, opacityIn, raiseIn, tiltSensIn, tiltInvIn]) el.addEventListener("input", fromInputs);
  const tiltStatus = byId("tilt-status");
  tiltIn.addEventListener("change", async () => {
    if (tiltIn.checked) {
      // Asked inside the tap: iPhones only show their motion-sensor permission prompt from a user gesture.
      const r = await input.enableTilt();
      if (r !== "ok") {
        tiltIn.checked = false;
        tiltStatus.textContent = r === "denied" ? "Motion access was declined, so tilt steering stays off." : "This device has no motion sensor the browser can read.";
      } else {
        tiltStatus.textContent = "Tilt steering on. Hold the phone how you like and tap Calibrate.";
        input.calibrateTilt();
      }
    }
    fromInputs();
  });
  byId("tilt-cal").addEventListener("click", () => {
    input.calibrateTilt();
    tiltStatus.textContent = input.tiltReading ? "Calibrated. This is now straight ahead." : "No motion reading yet. Move the phone a little and try again.";
  });
  byId("settings-reset").addEventListener("click", () => {
    settings = { ...DEFAULT_SETTINGS, time: settings.time, weather: settings.weather, tyreWear: settings.tyreWear, compound: settings.compound, damage: settings.damage };
    persist();
    showSettings();
  });
  applyScreen = () => {
    screenLayout.setPref(settings.layout);
    const c = settings.controls[screenLayout.layout];
    touch.style.setProperty("--ctl-scale", String(c.scale));
    touch.style.setProperty("--ctl-opacity", String(c.opacity));
    touch.style.setProperty("--ctl-raise", `${c.raise}px`);
    touch.classList.toggle("swap", settings.swapSides);
    touch.classList.toggle("wheel", settings.ctrlStyle === "wheel");
    byId("wheel").classList.toggle("hidden", settings.ctrlStyle !== "wheel");
    game.followCam.setLayout(screenLayout.layout);
  };
  // A turn of the phone only re-fits the screen. The race, the car and the lap carry on.
  screenLayout.onChange = () => {
    applyScreen();
    if (!settingsPanel.classList.contains("hidden")) showSettings();
  };
  if (settings.tilt) void input.enableTilt().then((r) => r !== "ok" && ((settings = { ...settings, tilt: false }), persist()));
  game.applySettings(settings);
  applyScreen();

  // Achievements and the share card ---------------------------------------------------
  const achPanel = byId("ach");
  byId("ach-btn").addEventListener("click", () => {
    const got = loadUnlocked();
    byId("ach-count").textContent = `${Object.keys(got).length} of ${ACHIEVEMENTS.length} unlocked`;
    const list = byId("ach-list");
    list.replaceChildren();
    for (const a of ACHIEVEMENTS) {
      const li = document.createElement("li");
      const done = got[a.id] !== undefined;
      li.className = done ? "" : "locked";
      const name = document.createElement("strong");
      name.textContent = `${done ? "✓ " : ""}${a.name}`;
      const desc = document.createElement("span");
      desc.textContent = a.description;
      li.append(name, desc);
      list.appendChild(li);
    }
    achPanel.classList.remove("hidden");
  });
  byId("ach-close").addEventListener("click", () => achPanel.classList.add("hidden"));

  const sharePanel = byId("share");
  let shareCanvas: HTMLCanvasElement | null = null;
  byId("results-share").addEventListener("click", () => {
    shareCanvas = game.buildShareCard();
    if (!shareCanvas) return;
    const url = shareCanvas.toDataURL("image/png");
    byId<HTMLImageElement>("share-img").src = url;
    byId<HTMLAnchorElement>("share-download").href = url;
    sharePanel.classList.remove("hidden");
  });
  byId("share-send").addEventListener("click", () => {
    if (shareCanvas) void tryNativeShare(shareCanvas, "My TrackRush Pro result");
  });
  byId("share-close").addEventListener("click", () => sharePanel.classList.add("hidden"));

  // Best-lap replay -------------------------------------------------------------
  const replayBar = byId("replay-bar");
  const replayBtn = byId("results-replay");
  const showCard = (canvas: HTMLCanvasElement | null) => {
    shareCanvas = canvas;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    byId<HTMLImageElement>("share-img").src = url;
    byId<HTMLAnchorElement>("share-download").href = url;
    sharePanel.classList.remove("hidden");
  };
  const syncReplayButton = () => replayBtn.classList.toggle("hidden", !game.canReplay);
  new MutationObserver(syncReplayButton).observe(byId("results"), { attributes: true, attributeFilter: ["class"] });
  replayBtn.addEventListener("click", () => {
    if (!game.startReplay()) return;
    byId("replay-cam").textContent = `Camera: ${game.replayCameraName()}`;
    replayBar.classList.remove("hidden");
  });
  byId("replay-cam").addEventListener("click", () => {
    byId("replay-cam").textContent = `Camera: ${game.cycleReplayCamera()}`;
  });
  byId("replay-restart").addEventListener("click", () => game.restartReplay());
  byId("replay-card").addEventListener("click", () => showCard(game.buildLapCard()));
  byId("replay-close").addEventListener("click", () => {
    game.stopReplay();
    replayBar.classList.add("hidden");
  });
  window.setInterval(() => {
    const c = game.replayClock();
    if (c) byId("replay-clock").textContent = formatTime(Math.min(c.t, c.total));
    else if (!replayBar.classList.contains("hidden")) replayBar.classList.add("hidden");
  }, 100);

  // Engine sound ---------------------------------------------------------------
  const engineSelect = byId<HTMLSelectElement>("engine-select");
  for (const e of ENGINES) {
    const o = document.createElement("option");
    o.value = e.id;
    o.textContent = e.name;
    engineSelect.appendChild(o);
  }
  const savedEngine = getEngine(loadSetting("engine", DEFAULT_ENGINE)).id;
  engineSelect.value = savedEngine;
  game.setEngine(savedEngine);
  const engineDesc = byId("engine-desc");
  const showEngine = () => (engineDesc.textContent = getEngine(engineSelect.value).blurb);
  showEngine();
  engineSelect.addEventListener("change", () => {
    game.setEngine(engineSelect.value);
    saveSetting("engine", engineSelect.value);
    showEngine();
  });

  // Driver profile -----------------------------------------------------------
  const profile = loadProfile();
  const nameInput = byId<HTMLInputElement>("driver-name");
  const idLine = byId("driver-id");
  nameInput.value = profile.name;
  const showId = () => {
    idLine.textContent = `Driver ID ${profile.id} · your races are saved on this device`;
  };
  showId();
  const commitName = () => {
    const cleaned = cleanName(nameInput.value) || generateDriverName();
    profile.name = cleaned;
    nameInput.value = cleaned;
    saveProfile(profile);
    game.driver = { id: profile.id, name: profile.name };
  };
  nameInput.addEventListener("change", commitName);
  nameInput.addEventListener("keydown", (e) => e.stopPropagation());
  nameInput.addEventListener("keyup", (e) => e.stopPropagation());
  game.driver = { id: profile.id, name: profile.name };

  // Fastest-lap ranking: this device's history merged with the online board -----
  const rankingFor = (trackId: string): RankRow[] => {
    const best = new Map<string, RankRow>();
    const add = (id: string, name: string, ms: number) => {
      const cur = best.get(id);
      if (!cur || ms < cur.ms) best.set(id, { id, name, ms });
    };
    for (const e of leaderboard(loadHistory(), trackId, 50)) add(e.driverId, e.driver, e.bestMs);
    for (const e of mp?.board.get(trackId) ?? []) add(e.id, e.name, e.bestMs);
    return [...best.values()].sort((a, b) => a.ms - b.ms).slice(0, 10);
  };
  function drawRanking(): void {
    fillRanking(byId("rank-list"), rankingFor(trackSelect.value), profile.id);
  }
  game.rankingProvider = rankingFor;
  game.confetti = new Confetti(byId<HTMLCanvasElement>("confetti"));
  let mp: Multiplayer | null = null;
  drawRanking();

  // Race history -------------------------------------------------------------
  const historyPanel = byId("history");
  const historyBody = byId("history-body");
  const scopeSelect = byId<HTMLSelectElement>("history-scope");
  const drawHistory = () =>
    renderHistory(historyBody, loadHistory(), TRACKS, profile.id, scopeSelect.value === "all" ? "all" : "mine");
  byId("history-btn").addEventListener("click", () => {
    commitName();
    drawHistory();
    historyPanel.classList.remove("hidden");
  });
  byId("history-close").addEventListener("click", () => historyPanel.classList.add("hidden"));
  scopeSelect.addEventListener("change", drawHistory);
  byId("history-clear").addEventListener("click", () => {
    if (!window.confirm("Delete all saved races on this device?")) return;
    clearHistory();
    drawHistory();
  });

  const menu = byId("menu");
  const pause = byId("pause");
  const showTouch = (v: boolean) => touch.classList.toggle("hidden", !(v && isTouch));

  // Game type tabs: Battle (vs rivals), Solo drive, 1 vs 1 online. They share every option.
  type Tab = "battle" | "solo" | "online";
  const TABS: Record<Tab, { start: string; desc: string }> = {
    battle: { start: "Start battle", desc: "Race rival cars over the full distance. Crashes, the safety car and pit stops all count." },
    solo: { start: "Start solo drive", desc: "Just you on the track: chase a best lap time, or roam freely with no timing." },
    online: { start: "Open online lobby", desc: "Race a friend or a stranger head to head over the internet (needs a relay server)." },
  };
  const tabButtons = [...document.querySelectorAll<HTMLButtonElement>(".tabs button")];
  const startBtn = byId<HTMLButtonElement>("start-btn");
  const stored = loadSetting("tab", "battle");
  let tab: Tab = stored === "solo" || stored === "online" ? stored : "battle";
  const showTab = (next: Tab): void => {
    tab = next;
    saveSetting("tab", tab);
    for (const b of tabButtons) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    document.querySelectorAll<HTMLElement>("#menu [data-for]").forEach((el) => {
      el.classList.toggle("hidden", !(el.dataset.for ?? "").split(" ").includes(tab));
    });
    byId("tab-desc").textContent = TABS[tab].desc;
    startBtn.textContent = TABS[tab].start;
    // Section titles only make sense if something under them is visible.
    document.querySelectorAll<HTMLElement>("#menu h3.sec[data-for]").forEach((h) => h.classList.toggle("hidden", tab === "online"));
  };
  for (const b of tabButtons) b.addEventListener("click", () => showTab(b.dataset.tab as Tab));
  showTab(tab);

  const modes = setupModes({
    game,
    tracks: TRACKS.filter((t) => !t.training),
    driverId: profile.id,
    difficulty: () => difficultySelect.value as Difficulty,
    start: (trackId, rivals) =>
      startWhenReady(() => {
        commitName();
        menu.classList.add("hidden");
        pause.classList.add("hidden");
        game.start(trackId, "race", undefined, rivals);
        showTouch(true);
      }),
  });

  let openMp: () => void = () => undefined;
  // First-run "how to drive" card ---------------------------------------------------
  const TUT_KEY = "trackrush.tutorialDone";
  const tutorial = byId("tutorial");
  let tutorialThen: (() => void) | null = null;
  const tutorialLines: string[] = isTouch
    ? [
        "<b>Steer</b> with the left pad, <b>gas</b> and <b>brake</b> with the right pedals.",
        "Tap <b>Pit</b> signs: stop inside the blue box on the main straight to change tyres.",
        "The cyan ghost car is your best lap. Stay ahead of it.",
        "Stuck or flipped? Hit the <b>reset</b> button.",
      ]
    : [
        "<b>W / ↑</b> gas, <b>S / ↓</b> brake, <b>A D / ← →</b> steer, <b>Space</b> handbrake.",
        "<b>C</b> changes camera, <b>R</b> resets the car, <b>Esc</b> pauses.",
        "Stop inside the blue <b>PIT</b> box on the main straight to change tyres and fix damage.",
        "The cyan ghost car is your best lap. Stay ahead of it.",
      ];
  const fillTutorial = () => {
    byId("tutorial-list").innerHTML = tutorialLines.map((l) => `<li>${l}</li>`).join("");
  };
  const showTutorial = (then: (() => void) | null) => {
    fillTutorial();
    tutorialThen = then;
    tutorial.classList.remove("hidden");
  };
  byId("tutorial-go").addEventListener("click", () => {
    tutorial.classList.add("hidden");
    try {
      localStorage.setItem(TUT_KEY, "1");
    } catch {
      /* storage blocked: it will just show again next time */
    }
    const next = tutorialThen;
    tutorialThen = null;
    next?.();
  });
  byId("help-btn").addEventListener("click", () => showTutorial(null));
  const tutorialSeen = (): boolean => {
    try {
      return localStorage.getItem(TUT_KEY) === "1";
    } catch {
      return true;
    }
  };

  const begin = (): void => {
    if (tab !== "online" && !tutorialSeen()) {
      showTutorial(beginNow);
      return;
    }
    beginNow();
  };
  function beginNow(): void {
    commitName();
    if (tab === "online") {
      openMp();
      return;
    }
    modes.clearActive();
    startWhenReady(() => {
      menu.classList.add("hidden");
      pause.classList.add("hidden");
      const battle = tab === "battle";
      game.start(trackSelect.value, battle ? "race" : (soloModeSelect.value as GameMode), undefined, {
        count: battle ? Number(rivalsSelect.value) || 3 : 0,
        difficulty: difficultySelect.value as Difficulty,
      });
      showTouch(true);
    });
  }
  const toMenu = (): void => {
    if (game.isVersus || client.phase === "racing") client.leave();
    game.toMenu();
    pause.classList.add("hidden");
    showTouch(false);
    menu.classList.remove("hidden");
  };


  // Online 1v1 ---------------------------------------------------------------
  const mpPanel = byId("mp");
  const mpStatus = byId("mp-status");
  const mpActions = byId("mp-actions");
  const mpInviteBox = byId("mp-invite-box");
  const mpCancel = byId("mp-cancel");
  const mpUrl = byId<HTMLInputElement>("mp-url");
  // Opened from another device on the same network (http://192.168.x.x:5173)? The relay runs on that same PC,
  // so aim at it instead of "localhost", which on a phone would mean the phone itself.
  const savedRelay = loadSetting("relay", "");
  if (savedRelay) mpUrl.value = savedRelay;
  else if (location.protocol === "http:" && location.hostname) mpUrl.value = `ws://${location.hostname}:8787`;
  else if (location.protocol === "https:") mpUrl.value = "wss://";
  const mpFriend = byId<HTMLInputElement>("mp-friend");
  byId("mp-myid").textContent = profile.id;
  for (const input of [mpUrl, mpFriend]) {
    input.addEventListener("keydown", (e) => e.stopPropagation());
    input.addEventListener("keyup", (e) => e.stopPropagation());
  }
  const trackName = (id: string) => TRACKS.find((t) => t.id === id)?.name ?? id;
  // The relay only passes a track id around, so the conditions ride along inside it: "track|time|weather".
  const onlineKey = (): string => {
    const def = TRACKS.find((x) => x.id === trackSelect.value);
    const c = resolveConditions(settings.time, settings.weather, def?.defaultConditions);
    return `${trackSelect.value}|${c.time}|${c.weather}`;
  };
  const parseKey = (key: string): { track: string; cond: Conditions | undefined; text: string } => {
    const [track = "", time, weather] = key.split("|");
    const ok = (time === "day" || time === "dusk" || time === "night") && (weather === "clear" || weather === "rain");
    const cond = ok ? ({ time, weather } as Conditions) : undefined;
    return { track, cond, text: cond ? `${trackName(track)}, ${cond.time}, ${cond.weather === "rain" ? "rain" : "dry"}` : trackName(track) };
  };
  const updateMpTrack = () => (byId("mp-track").textContent = parseKey(onlineKey()).text);
  const client = new Multiplayer({ id: profile.id, name: profile.name });
  mp = client;
  game.onSendState = (st) => client.sendState(st);
  game.onFinish = (ms) => client.sendFinish(ms);
  game.onValidLap = (trackId, ms) => client.submitLap(trackId, ms);
  client.events.status = (t) => (mpStatus.textContent = t);
  // Back up the driver's name and race history on the relay whenever it is connected.
  let backupTimer = 0;
  const dataUrl = byId<HTMLInputElement>("mp-data-url");
  dataUrl.value = loadSetting("dataUrl", "");
  for (const ev of ["keydown", "keyup"] as const) dataUrl.addEventListener(ev, (e) => e.stopPropagation());
  dataUrl.addEventListener("change", () => {
    saveSetting("dataUrl", dataUrl.value.trim());
    void backup();
  });
  const backup = async (): Promise<void> => {
    const own = dataUrl.value.trim();
    if (!own && !client.connected) return;
    const r = await syncPlayer(own || mpUrl.value, profile);
    if (r === "forbidden") syncBadge.textContent = "This driver ID is already saved by another device, so your history was not backed up.";
    else if (r === "ok") syncBadge.textContent = "History backed up on the relay.";
  };
  const syncBadge = byId("mp-sync");
  if (dataUrl.value.trim()) void backup();
  historyEvents.onChange = () => {
    window.clearTimeout(backupTimer);
    backupTimer = window.setTimeout(() => void backup(), 3000);
  };
  client.events.phase = (p) => {
    mpActions.classList.toggle("hidden", p === "offline" || p === "connecting");
    byId<HTMLButtonElement>("mp-connect").textContent = p === "offline" || p === "connecting" ? "Connect" : "Disconnect";
    mpCancel.classList.toggle("hidden", !(p === "queued" || p === "matched"));
    byId<HTMLButtonElement>("mp-invite").disabled = p !== "online";
    byId<HTMLButtonElement>("mp-quick").disabled = p !== "online";
    if (p === "online") {
      client.requestBoard(trackSelect.value);
      drawRanking();
      void backup();
    }
  };
  client.events.invite = (from, trackId) => {
    mpInviteBox.classList.toggle("hidden", !from);
    if (from) {
      byId("mp-invite-text").textContent = `${from.name} (ID ${from.id}) invited you to a 1v1 on ${parseKey(trackId).text}.`;
      mpPanel.classList.remove("hidden");
    }
  };
  client.events.board = (trackId) => {
    if (trackId === trackSelect.value) drawRanking();
  };
  client.events.match = (m: MatchInfo) => {
    trackSelect.value = parseKey(m.trackId).track;
    describe();
    updateMpTrack();
    const theirs = colourName(m.opponent.colour);
    mpStatus.textContent = `Matched with ${m.opponent.name}${theirs ? ` (${theirs} car)` : ""}! Get ready…`;
  };
  client.events.start = (m: MatchInfo) => {
    commitName();
    mpPanel.classList.add("hidden");
    menu.classList.add("hidden");
    pause.classList.add("hidden");
    const pk = parseKey(m.trackId);
    game.start(pk.track, "race", { opponent: m.opponent, slot: m.slot, conditions: pk.cond });
    showTouch(true);
  };
  client.events.opponent = (st) => game.receiveOpponent(st);
  client.events.oppFinished = (name, ms) => game.opponentFinished(name, ms);
  client.events.oppLeft = (name) => game.opponentLeft(name);
  client.events.result = (standings, forfeit) => game.applyResult(standings, forfeit);

  // Car colour for 1 vs 1: mirrors the garage colour select so both always agree.
  const liveryMenu = byId<HTMLSelectElement>("livery-select");
  const mpColour = byId<HTMLSelectElement>("mp-colour");
  const mpSwatch = byId("mp-swatch");
  const syncMpColour = (): void => {
    mpColour.replaceChildren(...Array.from(liveryMenu.options).map((o) => o.cloneNode(true)));
    mpColour.value = liveryMenu.value;
    const c = CAR_COLOURS.find((x) => x.id === liveryMenu.value);
    mpSwatch.style.background = c ? `#${c.livery.body.toString(16).padStart(6, "0")}` : "";
    client.setColour(liveryMenu.value);
  };
  mpColour.addEventListener("change", () => {
    if (mpColour.selectedOptions[0]?.disabled) {
      mpColour.value = liveryMenu.value; // still locked: keep the colour you have
      return;
    }
    liveryMenu.value = mpColour.value;
    liveryMenu.dispatchEvent(new Event("change")); // saves the choice and repaints your car
    syncMpColour();
  });
  liveryMenu.addEventListener("change", syncMpColour);
  syncMpColour();

  openMp = () => {
    syncMpColour();
    client.updateName(profile.name);
    updateMpTrack();
    mpPanel.classList.remove("hidden");
  };
  byId("mp-back").addEventListener("click", () => mpPanel.classList.add("hidden"));
  byId("mp-connect").addEventListener("click", () => {
    if (client.connected) client.disconnect();
    else {
      client.updateName(profile.name);
      saveSetting("relay", mpUrl.value.trim());
      void client.connect(mpUrl.value.trim());
    }
  });
  byId("mp-copy").addEventListener("click", () => {
    void navigator.clipboard?.writeText(profile.id).then(
      () => (mpStatus.textContent = "Your ID is copied. Send it to your friend."),
      () => (mpStatus.textContent = `Your ID is ${profile.id}.`),
    );
  });
  byId("mp-invite").addEventListener("click", () => {
    const id = mpFriend.value.trim();
    if (!/^[A-Za-z0-9]{4,16}$/.test(id)) {
      mpStatus.textContent = "Type your friend's driver ID (4–16 letters/numbers).";
      return;
    }
    if (id === profile.id) {
      mpStatus.textContent = "That's your own ID. Ask your friend for theirs.";
      return;
    }
    client.invite(id, onlineKey());
  });
  byId("mp-quick").addEventListener("click", () => client.quick(onlineKey()));
  mpCancel.addEventListener("click", () => {
    client.leave();
    mpStatus.textContent = "Cancelled.";
  });
  byId("mp-accept").addEventListener("click", () => client.respond(true));
  byId("mp-decline").addEventListener("click", () => client.respond(false));

  byId("start-btn").addEventListener("click", begin);
  byId("resume-btn").addEventListener("click", () => {
    game.resume();
    pause.classList.add("hidden");
  });
  byId("restart-btn").addEventListener("click", begin);
  byId("pause-menu-btn").addEventListener("click", toMenu);
  byId("btn-pause").addEventListener("click", () => {
    game.pause();
    if (game.phase === "paused") pause.classList.remove("hidden");
  });
  byId("btn-export").addEventListener("click", () => game.exportTelemetry("csv"));
  byId("btn-export-json").addEventListener("click", () => game.exportTelemetry("json"));
  byId("btn-menu").addEventListener("click", toMenu);
  byId("results-restart").addEventListener("click", () => {
    if (game.lastRaceWasVersus) {
      toMenu();
      updateMpTrack();
      mpPanel.classList.remove("hidden");
    } else begin();
  });
  byId("results-menu").addEventListener("click", toMenu);
  byId("results-export").addEventListener("click", () => game.exportTelemetry("csv"));
  game.onPauseChange = (paused) => pause.classList.toggle("hidden", !paused);

  // Exposed for browser tests and debugging only.
  (window as unknown as { __trackrush: Game }).__trackrush = game;

  byId("loading").classList.add("hidden");
  menu.classList.remove("hidden");
}

window.addEventListener("error", (e) => {
  console.error(e.error ?? e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error(e.reason);
});

boot().catch((err: unknown) => {
  console.error(err);
  showError(`TrackRush failed to start: ${err instanceof Error ? err.message : String(err)}`);
});
