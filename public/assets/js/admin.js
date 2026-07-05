import {
  addLog,
  clearLogs,
  disconnectTwitch,
  getHypeTrainStatus,
  getLatestRelease,
  getLogs,
  getSettings,
  getTwitchStatus,
  getVersion,
  installUpdate,
  readFileAsDataUrl,
  resetSettings,
  saveSettings,
  saveTwitchToken,
  trimAvatarToDataUrl,
  trimImageToDataUrl,
  simulateHypeTrain
} from "./api.js";

let settings;
let availableLogs = [];
const DEFAULT_TWITCH_CLIENT_ID = "klgyxuiixy0mfo7ze7goubj5j16g7u";
const TWITCH_REQUIRED_SCOPES = "channel:read:hype_train user:read:chat";

const I18N = {
  "nav-overview": { de: "Übersicht", en: "Overview" },
  "nav-trigger": { de: "Verbindung", en: "Connection" },
  "nav-hypetrain": { de: "Hypetrain", en: "Hype train" },
  "nav-log": { de: "Log", en: "Log" },
  "nav-update": { de: "Update", en: "Update" },
  "label-language": { de: "Sprache", en: "Language" },
  "pill-twitch-default": { de: "Twitch nicht verbunden", en: "Twitch not connected" },
  "pill-hypetrain-idle": { de: "Kein Hype Train aktiv", en: "No hype train active" },
  "topbar-eyebrow": { de: "Lokale Verwaltung", en: "Local admin" },
  "topbar-title": { de: "Hype Train", en: "Hype Train" },
  "btn-save": { de: "Speichern", en: "Save" },
  "ov-status-eyebrow": { de: "Status", en: "Status" },
  "ov-status-title": { de: "Verbindungsübersicht", en: "Connection overview" },
  "metric-hype-state-label": { de: "Hype-Train-Status", en: "Hype train status" },
  "metric-participants-label": { de: "Teilnehmer", en: "Participants" },
  "status-not-connected": { de: "Nicht verbunden", en: "Not connected" },
  "ov-help-eyebrow": { de: "Hilfe", en: "Help" },
  "ov-help-title": { de: "Fragen?", en: "Questions?" },
  "ov-help-text": {
    de: "Auf GitHub findest du eine kleine Anleitung, falls du Fragen zur Einrichtung oder den Funktionen hast.",
    en: "You'll find a short guide on GitHub if you have questions about setup or features."
  },
  "btn-open-guide": { de: "Anleitung auf GitHub öffnen", en: "Open guide on GitHub" },
  "trigger-hint": {
    de: "Verbinde deinen Haupt-Account. Diese eine Verbindung liefert sowohl die Hype-Train-Events als auch den Chat (zum Zählen einzigartiger Zuschauer).",
    en: "Connect your main account. This single connection provides both the hype train events and chat (to count unique chatters)."
  },
  "btn-connect-twitch": { de: "Mit Twitch anmelden", en: "Sign in with Twitch" },
  "btn-refresh-twitch-status": { de: "Status prüfen", en: "Check status" },
  "btn-disconnect-twitch": { de: "Abmelden", en: "Disconnect" },
  "obs-title": { de: "OBS-Verbindung", en: "OBS connection" },
  "obs-hint": {
    de: "Verbindet sich per obs-websocket (v5) mit OBS und legt automatisch eine Szene und eine Browser-Quelle für das Overlay an.",
    en: "Connects to OBS via obs-websocket (v5) and automatically creates a scene and a browser source for the overlay."
  },
  "label-obs-host": { de: "Host", en: "Host" },
  "label-obs-port": { de: "Port", en: "Port" },
  "label-obs-password": { de: "Passwort", en: "Password" },
  "label-obs-scene": { de: "Szenenname", en: "Scene name" },
  "label-obs-source": { de: "Quellenname", en: "Source name" },
  "status-not-tested": { de: "Nicht getestet", en: "Not tested" },
  "btn-test-obs": { de: "OBS testen", en: "Test OBS" },
  "btn-setup-obs": { de: "Szene / Quelle erstellen", en: "Create scene / source" },
  "pill-obs-default": { de: "OBS nicht verbunden", en: "OBS not connected" },
  "pill-obs-connected": { de: "OBS verbunden", en: "OBS connected" },
  "ht-images-eyebrow": { de: "Bilder", en: "Images" },
  "ht-images-title": { de: "Lokomotive, Endwagen & Waggon", en: "Locomotive, end car & wagon" },
  "ht-locomotive-label": { de: "Lokomotive", en: "Locomotive" },
  "ht-endcar-label": { de: "Endwagen", en: "End car" },
  "ht-wagon-label": { de: "Waggon (generisch)", en: "Wagon (generic)" },
  "btn-choose-file": { de: "Auswählen", en: "Choose" },
  "btn-remove": { de: "Entfernen", en: "Remove" },
  "ht-avatars-eyebrow": { de: "Zuschauer", en: "Viewers" },
  "ht-avatars-title": { de: "Avatare", en: "Avatars" },
  "ht-avatars-hint": {
    de: "Jeder Zuschauer, der während eines Hype Trains im Chat schreibt, bekommt zufällig eines dieser Bilder zugewiesen.",
    en: "Every viewer who writes in chat during a hype train gets randomly assigned one of these images."
  },
  "btn-add-avatar": { de: "Avatare hinzufügen", en: "Add avatars" },
  "ht-sounds-title": { de: "Sounds", en: "Sounds" },
  "ht-sound-start": { de: "Start-Sound", en: "Start sound" },
  "ht-sound-waiting": { de: "Warte-Sound (Loop)", en: "Waiting sound (loop)" },
  "ht-sound-departure": { de: "Abfahrt-Sound", en: "Departure sound" },
  "status-no-sound": { de: "Kein Sound ausgewählt", en: "No sound selected" },
  "btn-play": { de: "▶ Abspielen", en: "▶ Play" },
  "ht-test-eyebrow": { de: "Testlauf", en: "Test run" },
  "ht-test-title": { de: "Animation testen", en: "Test animation" },
  "ht-test-participants": { de: "Anzahl Testteilnehmer", en: "Number of test participants" },
  "btn-test-simulate": { de: "Hype Train testen", en: "Test hype train" },
  "hint-overlay-required": {
    de: "Das Overlay muss in OBS oder in einem Browser geöffnet sein, damit du die Animation siehst.",
    en: "The overlay must be open in OBS or a browser for you to see the animation."
  },
  "log-eyebrow": { de: "Verlauf", en: "History" },
  "log-title": { de: "Ereignis-Log", en: "Event log" },
  "placeholder-log-search": { de: "Log durchsuchen...", en: "Search log..." },
  "btn-clear-logs": { de: "Log löschen", en: "Clear log" },
  "hint-log-empty": { de: "Noch keine Ereignisse aufgezeichnet.", en: "No events recorded yet." },
  "update-eyebrow": { de: "Wartung", en: "Maintenance" },
  "update-title": { de: "Update", en: "Update" },
  "update-current-label": { de: "Installierte Version", en: "Installed version" },
  "update-date-label": { de: "Veröffentlicht am", en: "Released on" },
  "update-status-idle": { de: "Noch nicht geprüft.", en: "Not checked yet." },
  "btn-check-update": { de: "Nach Updates suchen", en: "Check for updates" },
  "btn-install-update": { de: "Installieren", en: "Install" }
};

let currentLanguage = "de";

function t(key) {
  const entry = I18N[key];
  if (!entry) return key;
  return entry[currentLanguage] || entry.de || key;
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (I18N[key]) el.textContent = t(key);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (I18N[key]) el.setAttribute("placeholder", t(key));
  });
}

function showNotice(message, tone = "info") {
  const notice = document.querySelector("#notice");
  notice.textContent = message;
  notice.dataset.tone = tone;
  notice.hidden = false;
  clearTimeout(showNotice._timer);
  showNotice._timer = setTimeout(() => { notice.hidden = true; }, 4000);
}

function bindTabs() {
  document.querySelectorAll(".nav-button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-button").forEach((b) => b.classList.remove("is-active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("is-active"));
      btn.classList.add("is-active");
      document.querySelector(`.tab-panel[data-panel="${btn.dataset.tab}"]`)?.classList.add("is-active");
    });
  });
}

function bindLanguageToggle() {
  const toggle = document.querySelector("#language-toggle");
  function setLanguage(lang) {
    currentLanguage = lang === "en" ? "en" : "de";
    toggle.querySelectorAll(".seg-option").forEach((btn) => {
      btn.setAttribute("aria-checked", String(btn.dataset.value === currentLanguage));
    });
    applyI18n();
  }
  toggle.querySelectorAll(".seg-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      setLanguage(btn.dataset.value);
      settings.hypeTrain.language = currentLanguage;
    });
  });
  setLanguage(settings?.hypeTrain?.language || "de");
}

// ---- Settings load/save ----

function ensureHypeTrainShape(raw) {
  const s = raw || {};
  s.hypeTrain = s.hypeTrain || {};
  const ht = s.hypeTrain;
  ht.locomotiveImage = ht.locomotiveImage || "";
  ht.endCarImage = ht.endCarImage || "";
  ht.wagonImage = ht.wagonImage || "";
  ht.avatars = Array.isArray(ht.avatars) ? ht.avatars : [];
  ht.sounds = ht.sounds || {};
  ht.sounds.start = ht.sounds.start || "";
  ht.sounds.waiting = ht.sounds.waiting || "";
  ht.sounds.departure = ht.sounds.departure || "";
  ht.speedPxPerSecond = Number(ht.speedPxPerSecond) || 220;
  ht.language = ht.language || "de";
  s.obs = s.obs || {};
  s.obs.host = s.obs.host || "127.0.0.1";
  s.obs.port = Number(s.obs.port) || 4455;
  s.obs.password = s.obs.password || "";
  s.obs.sceneName = s.obs.sceneName || "Hype Train";
  s.obs.sourceName = s.obs.sourceName || "Hype Train Overlay";
  return s;
}

async function loadSettings() {
  settings = ensureHypeTrainShape(await getSettings());
}

async function persistSettings() {
  await saveSettings(settings);
}

// ---- Hydrate/bind: hype train images ----

function setPreview(elId, dataUrl, placeholderText) {
  const el = document.querySelector(elId);
  if (dataUrl) {
    el.innerHTML = `<img src="${dataUrl}" alt="">`;
  } else {
    el.innerHTML = `<span class="hint">${placeholderText}</span>`;
  }
}

function hydrateHypeTrainImages() {
  const ht = settings.hypeTrain;
  setPreview("#preview-locomotive", ht.locomotiveImage, "—");
  setPreview("#preview-endcar", ht.endCarImage, "—");
  setPreview("#preview-wagon", ht.wagonImage, "—");
}

function bindImageUpload(inputId, removeId, key, sizeKey) {
  document.querySelector(inputId).addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      // Train artwork is only trimmed (transparent margins removed), never rescaled or
      // cropped to a fixed box - the overlay derives all display sizes from the trimmed
      // native resolution so loco/wagons/end car stay proportional to each other.
      const dataUrl = await trimImageToDataUrl(file);
      settings.hypeTrain[key] = dataUrl;
      hydrateHypeTrainImages();
      hydrateAvatars();
    } catch {
      showNotice("Bild konnte nicht verarbeitet werden.", "error");
    }
    event.target.value = "";
  });
  document.querySelector(removeId).addEventListener("click", () => {
    settings.hypeTrain[key] = "";
    hydrateHypeTrainImages();
  });
}

// ---- Avatars ----

function hydrateAvatars() {
  const grid = document.querySelector("#avatar-grid");
  const avatars = settings.hypeTrain.avatars;
  grid.innerHTML = avatars.map((src, index) => `
    <div class="avatar-tile" data-index="${index}">
      <img src="${src}" alt="">
      <button type="button" data-remove-avatar="${index}" aria-label="Entfernen">×</button>
    </div>
  `).join("");
  grid.querySelectorAll("[data-remove-avatar]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.removeAvatar);
      settings.hypeTrain.avatars.splice(index, 1);
      hydrateAvatars();
    });
  });
}

function bindAvatarUpload() {
  document.querySelector("#upload-avatar").addEventListener("change", async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    let failed = 0;
    for (const file of files) {
      try {
        // Avatars: trim transparent margins, then normalize to a fixed height (aspect
        // kept, no frame, no background) - the overlay sizes them by height only.
        const dataUrl = await trimAvatarToDataUrl(file);
        settings.hypeTrain.avatars.push(dataUrl);
      } catch {
        failed += 1;
      }
    }
    hydrateAvatars();
    if (failed > 0) showNotice(`${failed} Bild(er) konnten nicht verarbeitet werden.`, "error");
    event.target.value = "";
  });
}

// ---- Sounds ----

const SOUND_KEYS = ["start", "waiting", "departure"];

function hydrateSounds() {
  for (const key of SOUND_KEYS) {
    const value = settings.hypeTrain.sounds[key];
    const status = document.querySelector(`#sound-${key}-status`);
    const playBtn = document.querySelector(`#play-${key}-sound`);
    const removeBtn = document.querySelector(`#remove-${key}-sound`);
    if (value) {
      status.textContent = "Sound gespeichert";
      status.dataset.i18n = "";
      playBtn.disabled = false;
      removeBtn.disabled = false;
    } else {
      status.textContent = t("status-no-sound");
      playBtn.disabled = true;
      removeBtn.disabled = true;
    }
  }
}

function bindSounds() {
  for (const key of SOUND_KEYS) {
    document.querySelector(`#sound-${key}`).addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      settings.hypeTrain.sounds[key] = await readFileAsDataUrl(file);
      hydrateSounds();
      event.target.value = "";
    });
    document.querySelector(`#remove-${key}-sound`).addEventListener("click", () => {
      settings.hypeTrain.sounds[key] = "";
      hydrateSounds();
    });
    document.querySelector(`#play-${key}-sound`).addEventListener("click", () => {
      const value = settings.hypeTrain.sounds[key];
      if (!value) return;
      new Audio(value).play().catch(() => {});
    });
  }
}

// ---- Twitch connection ----

function renderTwitchStatus(status) {
  const line = document.querySelector("#twitch-status");
  const overviewLine = document.querySelector("#twitch-status-overview");
  const pill = document.querySelector("#twitch-pill");
  if (status?.connected) {
    const text = `Verbunden als ${status.displayName || status.login}`;
    line.textContent = text;
    line.classList.add("is-connected");
    overviewLine.textContent = text;
    overviewLine.classList.add("is-connected");
    pill.textContent = `Twitch: ${status.displayName || status.login}`;
    pill.classList.add("is-connected");
  } else {
    line.textContent = t("status-not-connected");
    line.classList.remove("is-connected");
    overviewLine.textContent = t("status-not-connected");
    overviewLine.classList.remove("is-connected");
    pill.textContent = t("pill-twitch-default");
    pill.classList.remove("is-connected");
  }
  if (status?.lastError) {
    line.classList.add("is-error");
  } else {
    line.classList.remove("is-error");
  }
}

async function refreshTwitchStatus() {
  try {
    const data = await getTwitchStatus();
    renderTwitchStatus(data.status);
  } catch (error) {
    showNotice(error.message, "error");
  }
}

function bindTwitchConnect() {
  document.querySelector("#connect-twitch").addEventListener("click", () => {
    const clientId = DEFAULT_TWITCH_CLIENT_ID;
    const state = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    sessionStorage.setItem("hypetrain_twitch_state", state);
    const url = new URL("https://id.twitch.tv/oauth2/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", "http://localhost:5378/twitch-callback.html");
    url.searchParams.set("response_type", "token");
    url.searchParams.set("scope", TWITCH_REQUIRED_SCOPES);
    url.searchParams.set("force_verify", "true");
    url.searchParams.set("state", state);
    window.open(url.toString(), "_blank");
    // The OAuth popup is handed off to the user's real OS browser (WebView2's
    // NewWindowRequested reroutes it via Process.Start), so it runs in a separate
    // process with no window.opener relationship back to this admin page - the
    // "message" listener below can never fire in that case. Polling the status
    // endpoint is the only reliable way to notice the login finished.
    pollTwitchStatusAfterLogin();
    showNotice("Twitch-Login geoeffnet - bitte im Browser anmelden.");
  });

  document.querySelector("#refresh-twitch-status").addEventListener("click", refreshTwitchStatus);

  document.querySelector("#disconnect-twitch").addEventListener("click", async () => {
    try {
      await disconnectTwitch();
      await refreshTwitchStatus();
      showNotice("Twitch getrennt.");
    } catch (error) {
      showNotice(error.message, "error");
    }
  });

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type === "hypetrain:twitch-connected") {
      refreshTwitchStatus();
      showNotice("Twitch verbunden.");
    }
  });
}

let twitchPollTimer;
function pollTwitchStatusAfterLogin() {
  clearInterval(twitchPollTimer);
  let attempts = 0;
  twitchPollTimer = setInterval(async () => {
    attempts += 1;
    try {
      const data = await getTwitchStatus();
      if (data?.status?.connected) {
        clearInterval(twitchPollTimer);
        await refreshTwitchStatus();
        showNotice("Twitch verbunden.");
        return;
      }
      if (data?.status?.lastError) {
        clearInterval(twitchPollTimer);
        showNotice(data.status.lastError, "error");
        return;
      }
    } catch {
    }
    if (attempts >= 30) clearInterval(twitchPollTimer);
  }, 2000);
}

// ---- OBS connection ----
// Talks directly to obs-websocket (v5, JSON over WebSocket with numeric "op" codes) from the
// browser - no backend involvement beyond persisting host/port/password/sceneName/sourceName in
// settings.obs. Mirrors the sibling CardPackWidget app's approach, just for a single overlay.

async function sha256Base64(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  let binary = "";
  new Uint8Array(hash).forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

async function obsAuth(password, salt, challenge) {
  const secret = await sha256Base64(password + salt);
  return sha256Base64(secret + challenge);
}

function openObsSocket(timeoutMs = 2800) {
  return new Promise((resolve, reject) => {
    const obs = settings.obs || {};
    const ws = new WebSocket(`ws://${obs.host || "127.0.0.1"}:${obs.port || 4455}`);
    const timer = setTimeout(() => {
      try { ws.close(); } catch { }
      reject(new Error("Timeout bei OBS."));
    }, timeoutMs);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(ws); }, { once: true });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Verbindung zu OBS fehlgeschlagen.")); }, { once: true });
  });
}

function waitForObsMessage(ws, predicate, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener("message", handler);
      reject(new Error("OBS hat nicht rechtzeitig geantwortet."));
    }, timeoutMs);
    function handler(event) {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!predicate(message)) return;
      clearTimeout(timer);
      ws.removeEventListener("message", handler);
      resolve(message);
    }
    ws.addEventListener("message", handler);
  });
}

async function connectObs() {
  const ws = await openObsSocket();
  const hello = await waitForObsMessage(ws, (message) => message.op === 0, 2500);
  const identify = { op: 1, d: { rpcVersion: hello.d?.rpcVersion || 1 } };
  if (hello.d?.authentication) {
    if (!settings.obs?.password) throw new Error("OBS verlangt ein Passwort.");
    identify.d.authentication = await obsAuth(settings.obs.password, hello.d.authentication.salt, hello.d.authentication.challenge);
  }
  ws.send(JSON.stringify(identify));
  const identified = await waitForObsMessage(ws, (message) => message.op === 2, 2500);
  if (identified.op !== 2) throw new Error("OBS hat die Verbindung nicht akzeptiert.");
  return ws;
}

let obsRequestCounter = 0;
function obsRequest(ws, requestType, requestData) {
  const requestId = `req-${Date.now()}-${obsRequestCounter++}`;
  const payload = { op: 6, d: { requestType, requestId, requestData } };
  const response = waitForObsMessage(ws, (message) => message.op === 7 && message.d?.requestId === requestId, 4000);
  ws.send(JSON.stringify(payload));
  return response.then((message) => {
    if (!message.d.requestStatus?.result) {
      throw new Error(message.d.requestStatus?.comment || `OBS-Anfrage ${requestType} fehlgeschlagen.`);
    }
    return message.d.responseData || {};
  });
}

function setObsPill(connected) {
  const pill = document.querySelector("#obs-pill");
  pill.textContent = connected ? t("pill-obs-connected") : t("pill-obs-default");
  pill.classList.toggle("is-connected", connected);
}

async function testObsConnection(options = {}) {
  const silent = options.silent === true;
  const status = document.querySelector("#obs-status");
  try {
    const ws = await connectObs();
    ws.close();
    status.textContent = "Verbindung erfolgreich.";
    status.classList.remove("is-error");
    setObsPill(true);
    if (!silent) showNotice("OBS verbunden.");
    return true;
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("is-error");
    setObsPill(false);
    if (!silent) showNotice(error.message, "error");
    return false;
  }
}

// On app start, quietly try to reach OBS if a password is already saved - the user
// shouldn't have to press "OBS testen" on every launch just to light up the status pill.
async function autoConnectObs() {
  if (!settings.obs?.password) return;
  await testObsConnection({ silent: true });
}

async function setupObsOverlay() {
  const status = document.querySelector("#obs-status");
  try {
    const ws = await connectObs();
    const sceneName = settings.obs.sceneName || "Hype Train";
    const sourceName = settings.obs.sourceName || "Hype Train Overlay";
    const url = `${window.location.origin}/overlay.html`;

    const scenes = await obsRequest(ws, "GetSceneList");
    if (!(scenes.scenes || []).some((scene) => scene.sceneName === sceneName)) {
      await obsRequest(ws, "CreateScene", { sceneName });
    }

    const inputs = await obsRequest(ws, "GetInputList");
    const exists = (inputs.inputs || []).some((input) => input.inputName === sourceName);
    const inputSettings = { url, width: 1920, height: 1080, fps: 60, shutdown: false, restart_when_active: true, reroute_audio: false };
    if (!exists) {
      try {
        await obsRequest(ws, "CreateInput", { sceneName, inputName: sourceName, inputKind: "browser_source", inputSettings, sceneItemEnabled: true });
      } catch {
        await obsRequest(ws, "CreateInput", { sceneName, inputName: sourceName, inputKind: "obs_browser_source", inputSettings, sceneItemEnabled: true });
      }
    } else {
      await obsRequest(ws, "SetInputSettings", { inputName: sourceName, inputSettings, overlay: true });
    }

    let item;
    try {
      item = await obsRequest(ws, "GetSceneItemId", { sceneName, sourceName });
    } catch {
      await obsRequest(ws, "CreateSceneItem", { sceneName, sourceName, sceneItemEnabled: true });
      item = await obsRequest(ws, "GetSceneItemId", { sceneName, sourceName });
    }
    await obsRequest(ws, "SetSceneItemTransform", {
      sceneName,
      sceneItemId: item.sceneItemId,
      sceneItemTransform: { positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, boundsType: "OBS_BOUNDS_STRETCH", boundsWidth: 1920, boundsHeight: 1080 }
    });

    ws.close();
    status.textContent = `Szene "${sceneName}" und Quelle "${sourceName}" sind eingerichtet.`;
    status.classList.remove("is-error");
    setObsPill(true);
    await addLog("obs", "info", `OBS-Szene "${sceneName}" mit Quelle "${sourceName}" (${url}) eingerichtet.`);
    showNotice("OBS-Szene und Quelle eingerichtet.");
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("is-error");
    setObsPill(false);
    showNotice(error.message, "error");
  }
}

function hydrateObs() {
  document.querySelector("#obs-host").value = settings.obs.host;
  document.querySelector("#obs-port").value = settings.obs.port;
  document.querySelector("#obs-password").value = settings.obs.password;
  document.querySelector("#obs-scene-name").value = settings.obs.sceneName;
  document.querySelector("#obs-source-name").value = settings.obs.sourceName;
}

function bindObs() {
  document.querySelector("#obs-host").addEventListener("input", (event) => { settings.obs.host = event.target.value; });
  document.querySelector("#obs-port").addEventListener("input", (event) => { settings.obs.port = Number(event.target.value) || 4455; });
  document.querySelector("#obs-password").addEventListener("input", (event) => { settings.obs.password = event.target.value; });
  document.querySelector("#obs-scene-name").addEventListener("input", (event) => { settings.obs.sceneName = event.target.value; });
  document.querySelector("#obs-source-name").addEventListener("input", (event) => { settings.obs.sourceName = event.target.value; });
  document.querySelector("#test-obs").addEventListener("click", () => testObsConnection());
  document.querySelector("#setup-obs").addEventListener("click", setupObsOverlay);
}

// ---- Hype train status polling ----

async function refreshHypeTrainStatus() {
  try {
    const data = await getHypeTrainStatus();
    const status = data.status || {};
    document.querySelector("#metric-hype-state").textContent = status.state || "idle";
    document.querySelector("#metric-participants").textContent = String(status.participantCount || 0);
    const pill = document.querySelector("#hypetrain-pill");
    if (status.state && status.state !== "idle") {
      pill.textContent = `Hype Train: ${status.state} (Lvl ${status.level || 1})`;
      pill.classList.add("is-connected");
    } else {
      pill.textContent = t("pill-hypetrain-idle");
      pill.classList.remove("is-connected");
    }
  } catch {
  }
}

function bindSimulate() {
  document.querySelector("#test-simulate").addEventListener("click", async () => {
    const count = Math.max(0, Number(document.querySelector("#test-participants").value) || 0);
    try {
      await simulateHypeTrain(count);
      showNotice("Test gestartet - schau im Overlay nach.");
    } catch (error) {
      showNotice(error.message, "error");
    }
  });
}

// ---- Log tab ----

function renderLogs() {
  const search = document.querySelector("#log-search").value.trim().toLowerCase();
  const list = document.querySelector("#log-list");
  const filtered = search
    ? availableLogs.filter((entry) => `${entry.category} ${entry.level} ${entry.message}`.toLowerCase().includes(search))
    : availableLogs;
  document.querySelector("#log-empty-hint").hidden = filtered.length > 0;
  list.innerHTML = filtered.slice().reverse().map((entry) => `
    <div class="log-entry level-${entry.level}">
      <span class="log-time">${new Date(entry.timestamp).toLocaleTimeString()}</span>
      <strong>[${entry.category}]</strong> ${entry.message}
    </div>
  `).join("");
}

async function refreshLogs() {
  try {
    const data = await getLogs();
    availableLogs = data.logs || [];
    renderLogs();
  } catch {
  }
}

function bindLogTab() {
  document.querySelector("#log-search").addEventListener("input", renderLogs);
  document.querySelector("#clear-logs").addEventListener("click", async () => {
    await clearLogs();
    await refreshLogs();
  });
}

// ---- Update tab ----

async function hydrateUpdateTab() {
  try {
    const version = await getVersion();
    document.querySelector("#update-current-version").textContent = version.version;
    document.querySelector("#update-current-date").textContent = version.releaseDate;
  } catch {
  }
}

function bindUpdateTab() {
  document.querySelector("#check-update").addEventListener("click", async () => {
    const statusLine = document.querySelector("#update-status");
    const installBtn = document.querySelector("#install-update");
    statusLine.textContent = "Suche nach Updates...";
    try {
      const version = await getVersion();
      const release = await getLatestRelease(version.repo);
      const latestTag = (release.tag_name || "").replace(/^v/i, "");
      if (latestTag && latestTag !== version.version) {
        statusLine.textContent = `Update verfügbar: ${latestTag}`;
        const asset = (release.assets || []).find((a) => a.name.endsWith(".zip"));
        installBtn.hidden = !asset;
        installBtn.onclick = async () => {
          if (!asset) return;
          statusLine.textContent = "Installiere Update...";
          await installUpdate(asset.browser_download_url);
        };
      } else {
        statusLine.textContent = "Du bist auf dem neuesten Stand.";
        installBtn.hidden = true;
      }
    } catch (error) {
      statusLine.textContent = error.message;
    }
  });
}

// ---- Save button ----

function bindSave() {
  document.querySelector("#save-settings").addEventListener("click", async () => {
    try {
      await persistSettings();
      showNotice("Gespeichert.");
    } catch (error) {
      showNotice(error.message, "error");
    }
  });
}

async function init() {
  await loadSettings();
  bindTabs();
  bindLanguageToggle();
  hydrateHypeTrainImages();
  hydrateAvatars();
  hydrateSounds();
  bindImageUpload("#upload-locomotive", "#remove-locomotive", "locomotiveImage", "locomotive");
  bindImageUpload("#upload-endcar", "#remove-endcar", "endCarImage", "endCar");
  bindImageUpload("#upload-wagon", "#remove-wagon", "wagonImage", "wagon");
  bindAvatarUpload();
  bindSounds();
  bindTwitchConnect();
  hydrateObs();
  bindObs();
  bindSimulate();
  bindLogTab();
  bindUpdateTab();
  bindSave();
  applyI18n();
  await refreshTwitchStatus();
  autoConnectObs();
  await hydrateUpdateTab();
  await refreshLogs();
  await refreshHypeTrainStatus();
  setInterval(refreshHypeTrainStatus, 3000);
  setInterval(refreshLogs, 5000);
}

init().catch((error) => {
  addLog("ui", "error", "Admin init fehlgeschlagen: " + error.message);
  showNotice(error.message, "error");
});
