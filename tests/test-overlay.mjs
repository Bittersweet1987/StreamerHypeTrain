// Integration test for the overlay: boots overlay.html in jsdom, feeds fake SSE events
// through a stubbed EventSource and checks the built train DOM (waiting state + departure).
import { JSDOM } from "jsdom";
import { prepareSut, readPublic, check, finish, TINY_PNG } from "./helpers.mjs";

const sutDir = prepareSut();
const html = readPublic("overlay.html");

const dom = new JSDOM(html, { url: "http://localhost:5378/overlay.html", pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);

// Fake Image that "loads" instantly (jsdom never fires load events for data URLs).
// naturalWidth stays 0 so the overlay falls back to its FALLBACK_DIMS ratios.
class InstantImage {
  set src(value) {
    this._src = value;
    setTimeout(() => { if (this.onload) this.onload(); }, 0);
  }
  get src() { return this._src; }
  get naturalWidth() { return 0; }
  get naturalHeight() { return 0; }
}
global.Image = InstantImage;
dom.window.Image = InstantImage;

const playedSounds = [];
global.Audio = function (src) {
  return {
    loop: false,
    play() { playedSounds.push(src); return Promise.resolve(); },
    pause() {},
    currentTime: 0
  };
};

// Capture the SSE handlers instead of opening a real stream.
const sseHandlers = {};
global.EventSource = class {
  constructor() {}
  addEventListener(name, handler) { sseHandlers[name] = handler; }
};
dom.window.EventSource = global.EventSource;

const fetchCalls = [];
const settingsPayload = {
  hypeTrain: {
    locomotiveImage: TINY_PNG,
    endCarImage: TINY_PNG,
    wagonImage: TINY_PNG,
    avatars: [TINY_PNG, TINY_PNG],
    sounds: { start: "data:audio/mp3;base64,AA==", waiting: "data:audio/mp3;base64,BB==", departure: "data:audio/mp3;base64,CC==" },
    speedPxPerSecond: 100000 // absurdly fast so the departure animation finishes instantly in tests
  }
};
global.fetch = async (url, opts) => {
  fetchCalls.push({ url: String(url), method: opts?.method || "GET" });
  if (String(url).includes("/api/settings")) return { ok: true, json: async () => settingsPayload };
  return { ok: true, json: async () => ({ ok: true }) };
};

function sse(name, data) {
  sseHandlers[name]({ data: JSON.stringify(data) });
}

await import(`file://${sutDir.replaceAll("\\", "/")}/overlay.js`);
await new Promise((r) => setTimeout(r, 150));

check("SSE-Handler fuer begin/progress/end registriert",
  typeof sseHandlers["hype-train-begin"] === "function" &&
  typeof sseHandlers["hype-train-progress"] === "function" &&
  typeof sseHandlers["hype-train-end"] === "function");

// --- Waiting state ---
sse("hype-train-begin", { level: 1 });
await new Promise((r) => setTimeout(r, 250));
const waitingTrain = document.querySelector(".train");
check("Wartezustand: Zug steht auf der Buehne", waitingTrain !== null);
check("Wartezustand: NUR die Lok sichtbar (kein Endwagen, keine Waggons)",
  !!waitingTrain?.querySelector(".train-locomotive") &&
  !waitingTrain?.querySelector(".train-endcar") &&
  !waitingTrain?.querySelector(".train-wagon"));
check("Wartezustand: Gleise vorhanden", !!document.querySelector(".rails"));
check("Wartezustand: Dampfwolke aus dem Lok-Bild pulsiert (.loco-steam)",
  !!waitingTrain?.querySelector(".loco-steam"));
check("Wartezustand: keine Rad-Rotations-Ebenen (.loco-wheel) mehr",
  (waitingTrain?.querySelectorAll(".loco-wheel").length || 0) === 0);
check("Kein altes .steam-puffs-Element mehr im DOM", !waitingTrain?.querySelector(".steam-puffs"));
check("Wartezustand: Start-Sound gespielt", playedSounds.includes(settingsPayload.hypeTrain.sounds.start));
check("Wartezustand: Warte-Loop gespielt", playedSounds.includes(settingsPayload.hypeTrain.sounds.waiting));
check("Wartezustand: Lok rechts positioniert (left gesetzt)",
  parseFloat(waitingTrain?.style.left || "0") > 0);

// --- Departure ---
const participants = [
  { login: "viewer0", displayName: "Viewer0", avatarIndex: 0 },
  { login: "viewer1", displayName: "Viewer1", avatarIndex: 1 },
  { login: "viewer2", displayName: "Viewer2", avatarIndex: 0 }
];
sse("hype-train-end", { level: 2, participants });
await new Promise((r) => setTimeout(r, 400));

const train = document.querySelector(".train");
check("Abfahrt: Zug gebaut", train !== null);
check("Abfahrt: Zug nach dem Zusammenbau sichtbar (is-assembling entfernt)",
  train !== null && !train.classList.contains("is-assembling"));
check("Abfahrt: Gleise weiterhin vorhanden", !!document.querySelector(".rails"));

const wagons = [...(train?.querySelectorAll(".train-wagon") || [])];
check("Abfahrt: ein Waggon pro Teilnehmer", wagons.length === participants.length);
check("Abfahrt: Verbinder zwischen allen Teilen (Teilnehmer + 1)",
  (train?.querySelectorAll(".train-coupler").length || 0) === participants.length + 1);
check("Abfahrt: jeder Waggon hat einen puren Avatar (img.wagon-avatar)",
  wagons.every((w) => w.querySelector("img.wagon-avatar")));
check("Abfahrt: Avatar hoeher als der Waggon (inline height > Waggonhoehe)",
  wagons.every((w) => {
    const avatar = w.querySelector("img.wagon-avatar");
    return avatar && parseFloat(avatar.style.height) > parseFloat(w.style.height);
  }));
check("Abfahrt: kein Kreisrahmen (.wagon-window) mehr",
  wagons.every((w) => !w.querySelector(".wagon-window")));
check("Abfahrt: Username auf dem Schild mit zufaelliger Farbe",
  wagons.every((w, i) => {
    const name = w.querySelector(".wagon-name");
    return name && name.textContent === participants[i]?.displayName && name.style.color;
  }));
check("Abfahrt: Waggon-Grafik als Ebene UEBER dem Avatar (.wagon-face nach dem img)",
  wagons.every((w) => {
    const children = [...w.children];
    const avatarIdx = children.findIndex((c) => c.classList?.contains("wagon-avatar"));
    const faceIdx = children.findIndex((c) => c.classList?.contains("wagon-face"));
    return avatarIdx !== -1 && faceIdx !== -1 && avatarIdx < faceIdx;
  }));

// DOM order with row-reverse rendering: first child paints rightmost. Expected piece order:
// endcar, wagons..., locomotive => on screen locomotive leads (leftmost), endcar is last.
const pieces = [...train.children].filter((c) => !c.classList.contains("train-coupler"))
  .map((c) => c.className.split(" ")[0]);
check("Abfahrt: Reihenfolge Lok -> Waggons -> Schlusswagen (DOM: endcar zuerst, Lok zuletzt)",
  pieces[0] === "train-endcar" && pieces[pieces.length - 1] === "train-locomotive" &&
  pieces.slice(1, -1).every((c) => c === "train-wagon"));

// Wait for stand-still phase (800ms) + (instant) drive + completion ack. The departure
// sound must play at pull-away (after the stand-still), not while assembling.
await new Promise((r) => setTimeout(r, 1800));
check("Abfahrt: Abfahrt-Sound erst beim Losfahren gespielt", playedSounds.includes(settingsPayload.hypeTrain.sounds.departure));
check("Abfahrt: /api/hype-train/complete gemeldet",
  fetchCalls.some((c) => c.method === "POST" && c.url.includes("/api/hype-train/complete")));
check("Abfahrt: Buehne danach leer", document.querySelector(".train") === null);

finish("test-overlay");
