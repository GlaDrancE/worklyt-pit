import "./admin.css";
import * as THREE from "three";
import { CarView } from "./vehicle/CarView";
import { loadCarModel } from "./vehicle/carModel";
import { opponentLivery } from "./race/unlocks";
import { NetClient } from "./net/NetClient";
import type { LiveRacer, LiveRoom, ServerMsg } from "./net/protocol";
import { resolveConditions } from "./game/conditions";
import { createEnvironment } from "./game/Environment";
import { TRACKS } from "./track/tracks";
import { TrackModel } from "./track/TrackModel";
import { buildScenery, buildTrackMeshes, setTrackWet } from "./track/TrackBuilder";
import { disposeObject } from "./game/sceneHelpers";

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

interface Car {
  view: CarView;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  hasPosition: boolean;
  racer: LiveRacer;
}

const canvas = byId<HTMLCanvasElement>("spectator");
const status = byId("connection-status");
const roomSelect = byId<HTMLSelectElement>("room-select");
const roomSummary = byId("room-summary");
const boardBody = byId("leaderboard-body");
const cameraLabel = byId("camera-label");
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(54, 1, 0.2, 1800);
camera.position.set(0, 8, -15);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
const environment = createEnvironment(scene, renderer);

let sceneKey = "";
let trackGroup: THREE.Group | null = null;
let currentRoom: LiveRoom | null = null;
let rooms: LiveRoom[] = [];
let selectedRoomId = "";
let cameraRacerId = "";
let nextCameraChange = 0;
let lastFrame = 0;
const cars = new Map<string, Car>();

function clearCars(): void {
  for (const car of cars.values()) {
    scene.remove(car.view.root);
    disposeObject(car.view.root);
  }
  cars.clear();
}

function resize(): void {
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function ranking(room: LiveRoom): LiveRacer[] {
  return [...room.racers].sort((a, b) => {
    if (a.totalMs !== null && b.totalMs !== null) return a.totalMs - b.totalMs;
    if (a.totalMs !== null) return -1;
    if (b.totalMs !== null) return 1;
    return (b.state?.progress ?? 0) - (a.state?.progress ?? 0);
  });
}

function progressText(racer: LiveRacer): string {
  if (racer.totalMs !== null) return `Finished · ${(racer.totalMs / 1000).toFixed(1)} s`;
  if (!racer.state) return "Joining…";
  const progress = Math.max(0, racer.state.progress);
  const lap = Math.floor(progress) + 1;
  return `Lap ${lap} · ${Math.floor((progress % 1) * 100)}%`;
}

function drawLeaderboard(room: LiveRoom | null): void {
  boardBody.replaceChildren();
  if (!room) {
    roomSummary.textContent = "No active race rooms.";
    return;
  }
  const track = TRACKS.find((t) => t.id === room.trackId.split("|")[0]);
  roomSummary.textContent = `${track?.name ?? room.trackId} · ${room.racers.length}/${room.maxPlayers} drivers`;
  ranking(room).forEach((racer, i) => {
    const row = document.createElement("tr");
    if (i === 0) row.className = "leading";
    const position = document.createElement("td");
    position.textContent = String(i + 1);
    const name = document.createElement("td");
    name.textContent = racer.name;
    const progress = document.createElement("td");
    progress.textContent = progressText(racer);
    row.append(position, name, progress);
    boardBody.append(row);
  });
}

function setRoom(room: LiveRoom | null): void {
  currentRoom = room;
  drawLeaderboard(room);
  if (!room) {
    cameraLabel.textContent = "Waiting for racers…";
    clearCars();
    return;
  }

  const track = room.trackId.split("|")[0]!;
  const def = TRACKS.find((item) => item.id === track);
  if (!def) {
    status.textContent = `Unknown track ID: ${track}`;
    clearCars();
    return;
  }
  if (sceneKey !== room.trackId) {
    if (trackGroup) {
      scene.remove(trackGroup);
      disposeObject(trackGroup);
    }
    const model = new TrackModel(def);
    trackGroup = new THREE.Group();
    trackGroup.add(buildTrackMeshes(model), buildScenery(model));
    const wet = room.trackId.split("|")[2] === "rain";
    setTrackWet(trackGroup, wet);
    scene.add(trackGroup);
    sceneKey = room.trackId;
    const [, time, weather] = room.trackId.split("|");
    environment.setConditions(resolveConditions(time ?? "", weather ?? ""));
    environment.setGroundKind(def.scenery === "city" ? "pavement" : "grass");
    camera.position.set(model.def.controlPoints[0]![0] + 20, 14, model.def.controlPoints[0]![1] - 25);
  }

  const active = new Set(room.racers.map((r) => r.id));
  for (const [id, car] of cars) {
    if (active.has(id)) continue;
    scene.remove(car.view.root);
    disposeObject(car.view.root);
    cars.delete(id);
  }
  room.racers.forEach((racer) => {
    let car = cars.get(racer.id);
    if (!car) {
      const view = new CarView(opponentLivery(racer.colour, undefined), "lo");
      scene.add(view.root);
      car = { view, position: new THREE.Vector3(), rotation: new THREE.Quaternion(), hasPosition: false, racer };
      cars.set(racer.id, car);
    }
    car.racer = racer;
    car.view.root.visible = !!racer.state;
    if (!racer.state) return;
    if (!car.hasPosition) {
      car.position.set(racer.state.x, racer.state.y, racer.state.z);
      car.rotation.set(racer.state.qx, racer.state.qy, racer.state.qz, racer.state.qw);
      car.hasPosition = true;
    }
  });
  if (!active.has(cameraRacerId)) {
    cameraRacerId = room.racers.find((r) => r.state)?.id ?? "";
    nextCameraChange = 0;
  }
}

function renderRooms(nextRooms: LiveRoom[]): void {
  rooms = nextRooms;
  const oldSelection = selectedRoomId;
  roomSelect.replaceChildren();
  rooms.forEach((room) => {
    const option = document.createElement("option");
    const track = TRACKS.find((t) => t.id === room.trackId.split("|")[0]);
    option.value = room.id;
    option.textContent = `${track?.name ?? room.trackId} · ${room.racers.length}/${room.maxPlayers}`;
    roomSelect.append(option);
  });
  selectedRoomId = rooms.some((room) => room.id === oldSelection) ? oldSelection : (rooms[0]?.id ?? "");
  roomSelect.value = selectedRoomId;
  setRoom(rooms.find((room) => room.id === selectedRoomId) ?? null);
}

roomSelect.addEventListener("change", () => {
  selectedRoomId = roomSelect.value;
  cameraRacerId = "";
  nextCameraChange = 0;
  setRoom(rooms.find((room) => room.id === selectedRoomId) ?? null);
});

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  const room = currentRoom;
  if (room) {
    const eligible = room.racers.filter((racer) => racer.state);
    if (eligible.length > 0) {
      const currentIndex = eligible.findIndex((racer) => racer.id === cameraRacerId);
      if (currentIndex < 0) {
        cameraRacerId = eligible[0]!.id;
        nextCameraChange = now + 5000;
      } else if (now >= nextCameraChange) {
        cameraRacerId = eligible[(currentIndex + 1) % eligible.length]!.id;
        nextCameraChange = now + 5000;
      }
      for (const car of cars.values()) {
        const state = car.racer.state;
        if (!state) continue;
        const alpha = 1 - Math.exp(-dt * 12);
        car.position.lerp(new THREE.Vector3(state.x, state.y, state.z), alpha);
        car.rotation.slerp(new THREE.Quaternion(state.qx, state.qy, state.qz, state.qw), alpha);
        car.view.syncRemote(car.position, car.rotation, state.steer, state.speedKmh, dt);
      }
      const target = cars.get(cameraRacerId);
      if (target?.racer.state) {
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(target.rotation);
        const focus = target.position.clone().add(new THREE.Vector3(0, 1.6, 0));
        const desired = focus.clone().addScaledVector(forward, -11).add(new THREE.Vector3(0, 4.5, 0));
        camera.position.lerp(desired, 1 - Math.exp(-dt * 2.8));
        camera.lookAt(focus.addScaledVector(forward, 4));
        cameraLabel.textContent = `${target.racer.name} · third-person camera`;
      }
    } else {
      cameraLabel.textContent = "Waiting for racer positions…";
    }
  }
  renderer.render(scene, camera);
}

async function start(): Promise<void> {
  resize();
  window.addEventListener("resize", resize);
  await loadCarModel();
  requestAnimationFrame(frame);

  const configured = import.meta.env.VITE_RELAY_URL?.trim() ?? "";
  const address = configured || (location.protocol === "http:" ? `ws://${location.hostname}:8787` : "");
  if (!address) {
    status.textContent = "Configure VITE_RELAY_URL with the secure relay address to enable the live view.";
    return;
  }
  const net = new NetClient();
  net.onMessage = (message: ServerMsg) => {
    if (message.t === "watchSnapshot") renderRooms(message.rooms);
  };
  net.onClose = (message) => (status.textContent = message);
  try {
    await net.connect(address);
    net.send({ t: "watch" });
    status.textContent = `Connected · ${address}`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Couldn't connect to the race relay.";
  }
  window.addEventListener("beforeunload", () => net.close(), { once: true });
}

void start();
