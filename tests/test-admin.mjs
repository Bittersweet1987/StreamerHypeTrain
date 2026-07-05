// Integration test for the admin page: full init must run through, uploads/fields must
// exist, multi-avatar upload enabled, and OBS auto-connect must fire when a password is saved.
import { JSDOM } from "jsdom";
import { prepareSut, readPublic, check, finish } from "./helpers.mjs";

const sutDir = prepareSut();
const html = readPublic("admin.html");

const dom = new JSDOM(html, { url: "http://localhost:5378/admin.html", pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.sessionStorage = dom.window.sessionStorage;
global.localStorage = dom.window.localStorage;
global.HTMLElement = dom.window.HTMLElement;
global.Audio = function () { return { play: () => Promise.resolve() }; };

let wsAttempts = 0;
class FakeWebSocket {
  constructor() {
    wsAttempts += 1;
    setTimeout(() => { this._error?.(); }, 5);
  }
  addEventListener(name, handler) {
    if (name === "error") this._error = handler;
  }
  close() {}
}
global.WebSocket = FakeWebSocket;
dom.window.WebSocket = FakeWebSocket;

global.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/api/settings")) {
    return { ok: true, json: async () => ({ hypeTrain: {}, obs: { password: "secret", host: "127.0.0.1", port: 4455 } }) };
  }
  if (u.includes("/api/twitch/status")) return { ok: true, json: async () => ({ ok: true, status: { connected: false } }) };
  if (u.includes("/api/hype-train/status")) return { ok: true, json: async () => ({ ok: true, status: { state: "idle", participantCount: 0 } }) };
  if (u.includes("/api/logs")) return { ok: true, json: async () => ({ ok: true, logs: [] }) };
  if (u.includes("/api/version")) return { ok: true, json: async () => ({ ok: true, version: "0.0.0", repo: "x/y" }) };
  return { ok: true, json: async () => ({}) };
};

await import(`file://${sutDir.replaceAll("\\", "/")}/admin.js`);
await new Promise((r) => setTimeout(r, 300));

// init() must have survived to the end - these elements are bound late in init.
check("Init durchgelaufen: Upload-Inputs vorhanden", !!document.querySelector("#upload-locomotive"));
check("Avatar-Upload erlaubt Mehrfachauswahl", document.querySelector("#upload-avatar").multiple === true);
check("OBS-Felder hydratisiert", document.querySelector("#obs-host").value === "127.0.0.1");
check("OBS-Passwort hydratisiert", document.querySelector("#obs-password").value === "secret");
check("Logo eingebunden", !!document.querySelector("img.brand-mark[src*='logo.png']"));
check("Sticky-Speichern-Button vorhanden", !!document.querySelector(".topbar #save-settings"));

// Auto-connect: password saved => exactly one silent connection attempt on startup.
check("OBS-Auto-Connect beim Start versucht", wsAttempts >= 1);
const statusLine = document.querySelector("#obs-status").textContent;
check("Fehlgeschlagener Auto-Connect zeigt Status (kein Absturz)", statusLine.length > 0);

// Sticky topbar CSS present.
const css = readPublic("assets/css/admin.css");
const topbar = css.match(/\.topbar\s*\{([^}]*)\}/);
check("Topbar ist sticky (CSS)", topbar !== null && /position:\s*sticky/.test(topbar[1]));

finish("test-admin");
