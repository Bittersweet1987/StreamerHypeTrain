export async function getSettings() {
  const response = await fetch("/api/settings", { cache: "no-store" });
  if (!response.ok) throw new Error("Einstellungen konnten nicht geladen werden.");
  return response.json();
}

export async function saveSettings(settings) {
  // Twitch credentials are owned exclusively by the dedicated connect/disconnect endpoints.
  // Never include them in a settings save, otherwise a stale in-memory copy could resurrect a
  // disconnected account or overwrite a freshly issued token.
  const { twitch, ...safe } = settings || {};
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(safe)
  });
  if (!response.ok) throw new Error("Einstellungen konnten nicht gespeichert werden.");
  return response.json();
}

export async function resetSettings() {
  const response = await fetch("/api/reset-settings", { method: "POST" });
  if (!response.ok) throw new Error("Beispielwerte konnten nicht geladen werden.");
  return response.json();
}

export async function getTwitchStatus() {
  const response = await fetch("/api/twitch/status", { cache: "no-store" });
  if (!response.ok) throw new Error("Twitch-Status konnte nicht geladen werden.");
  return response.json();
}

export async function saveTwitchToken(payload) {
  const response = await fetch("/api/twitch/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Twitch-Verbindung konnte nicht gespeichert werden.");
  return data;
}

export async function disconnectTwitch() {
  const response = await fetch("/api/twitch/disconnect", { method: "POST" });
  if (!response.ok) throw new Error("Twitch konnte nicht getrennt werden.");
  return response.json();
}

export async function getHypeTrainStatus() {
  const response = await fetch("/api/hype-train/status", { cache: "no-store" });
  if (!response.ok) throw new Error("Hype-Train-Status konnte nicht geladen werden.");
  return response.json();
}

export async function simulateHypeTrain(participants = 8) {
  const response = await fetch("/api/hype-train/simulate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ participants })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Test konnte nicht gestartet werden.");
  return data;
}

export async function completeHypeTrainDeparture() {
  try {
    await fetch("/api/hype-train/complete", { method: "POST" });
  } catch {
  }
}

export function connectEventStream(handlers) {
  const source = new EventSource("/api/events");
  for (const [event, handler] of Object.entries(handlers)) {
    source.addEventListener(event, (message) => {
      try {
        handler(JSON.parse(message.data));
      } catch {
        handler({});
      }
    });
  }
  return source;
}

export function currentOriginUrl(pathname) {
  const url = new URL(pathname, window.location.origin);
  return url.toString();
}

export async function getLogs() {
  const response = await fetch("/api/logs", { cache: "no-store" });
  if (!response.ok) throw new Error("Logs konnten nicht geladen werden.");
  return response.json();
}

export async function addLog(category, level, message) {
  try {
    await fetch("/api/logs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category, level, message })
    });
  } catch {
  }
}

export async function clearLogs() {
  const response = await fetch("/api/logs/clear", { method: "POST" });
  if (!response.ok) throw new Error("Logs konnten nicht gelöscht werden.");
  return response.json();
}

export async function getVersion() {
  const response = await fetch("/api/version", { cache: "no-store" });
  if (!response.ok) throw new Error("Versionsinfo konnte nicht geladen werden.");
  return response.json();
}

export async function installUpdate(downloadUrl) {
  const response = await fetch("/api/update/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ downloadUrl })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Update konnte nicht installiert werden.");
  return data;
}

export async function getLatestRelease(repo) {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { accept: "application/vnd.github+json" }
  });
  if (response.status === 404) throw new Error("Noch kein Release veröffentlicht.");
  if (!response.ok) throw new Error(`GitHub antwortete mit Status ${response.status}.`);
  return response.json();
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Scales+crops an uploaded image file to an exact target size (cover-fit, like CSS
// background-size: cover) and returns a base64 data URL.
export function scaleImageToDataUrl(file, width, height) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          const scale = Math.max(width / img.width, height / img.height);
          const drawWidth = img.width * scale;
          const drawHeight = img.height * scale;
          const dx = (width - drawWidth) / 2;
          const dy = (height - drawHeight) / 2;
          ctx.drawImage(img, dx, dy, drawWidth, drawHeight);
          resolve(canvas.toDataURL("image/png"));
        } catch (error) {
          reject(error);
        }
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadFileAsImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Finds the opaque bounding box (alpha above threshold) of an image drawn on a canvas.
function opaqueBounds(ctx, width, height, threshold = 8) {
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: width, h: height };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// Trims fully transparent margins off an uploaded PNG and returns the cropped image as a
// data URL at its NATIVE cropped resolution. Used for locomotive/wagon/end-car artwork:
// keeping native resolution (no per-piece rescale) preserves the relative scale between
// pieces that were drawn on same-sized frames, which the overlay relies on to size the
// train proportionally.
export function trimImageToDataUrl(file) {
  return loadFileAsImage(file).then((img) => {
    const work = document.createElement("canvas");
    work.width = img.width;
    work.height = img.height;
    const wctx = work.getContext("2d");
    wctx.drawImage(img, 0, 0);
    const box = opaqueBounds(wctx, img.width, img.height);
    const out = document.createElement("canvas");
    out.width = box.w;
    out.height = box.h;
    out.getContext("2d").drawImage(img, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    return out.toDataURL("image/png");
  });
}

// Avatar pipeline: trim transparent margins, then scale to a fixed height (aspect kept).
// The overlay sizes all avatars by height, so normalizing here keeps storage small.
export function trimAvatarToDataUrl(file, targetHeight = 320) {
  return loadFileAsImage(file).then((img) => {
    const work = document.createElement("canvas");
    work.width = img.width;
    work.height = img.height;
    const wctx = work.getContext("2d");
    wctx.drawImage(img, 0, 0);
    const box = opaqueBounds(wctx, img.width, img.height);
    const scale = targetHeight / box.h;
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(box.w * scale));
    out.height = targetHeight;
    const octx = out.getContext("2d");
    octx.imageSmoothingQuality = "high";
    octx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  });
}
