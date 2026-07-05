import { completeHypeTrainDeparture, connectEventStream, getSettings } from "./api.js";

const stage = document.querySelector("#stage");
const status = document.querySelector("#status");

let settings;
let trainEl = null;
let railsEl = null;
let waitingAudio = null;

// Natural pixel sizes to assume when an image can't be measured (test environment or
// missing upload). Ratios roughly match the shipped artwork after transparent-trim.
const FALLBACK_DIMS = {
  locomotive: [1304, 528],
  wagon: [1280, 240],
  endCar: [1232, 472],
  avatar: [512, 512]
};

// Readable ink colors for the name plate on the wagon (drawn on a golden sign).
const NAME_COLORS = [
  "#7b1e1e", "#1e3a7b", "#14532d", "#6b21a8",
  "#92400e", "#0f766e", "#831843", "#3f3f46"
];

// Calibrated against the shipped locomotive artwork (train.png, trimmed to its opaque
// bounding box): rather than adding new drawn effects, the smoke cloud already part of
// that image is turned into its own layered crop (same background-image, offset
// background-position, exactly overlapping its spot in the static art) and given a gentle
// breathing pulse. If the locomotive artwork is replaced, this bounding box (fractions of
// the locomotive's own trimmed width/height) needs to be re-measured for the new image.
const LOCO_ART = {
  // Bounding box of the drawn steam cloud (left, top, width, height), all as fractions.
  steam: { left: 0.148, top: 0.007, width: 0.315, height: 0.389 }
};

function setStatus(text, show = false) {
  status.textContent = text;
  status.hidden = !show;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function hypeTrainSettings() {
  return settings?.hypeTrain || {};
}

function playSound(url, loop = false) {
  if (!url) return null;
  const audio = new Audio(url);
  audio.loop = loop;
  audio.play().catch(() => {});
  return audio;
}

function stopAudio(audio) {
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch {
  }
}

// ---- Image preloading ----
// Everything is preloaded and decoded BEFORE any train part becomes visible, so the
// departure runs on already-rasterized images - decoding multi-MB base64 PNGs mid-drive
// is what made the animation stutter.
const imageCache = new Map();

function loadImage(src, fallbackKey) {
  if (!src) {
    const [w, h] = FALLBACK_DIMS[fallbackKey] || [400, 200];
    return Promise.resolve({ src: "", w, h });
  }
  if (imageCache.has(src)) return Promise.resolve(imageCache.get(src));
  return new Promise((resolve) => {
    let settled = false;
    const img = new Image();
    const done = () => {
      if (settled) return;
      settled = true;
      const [fw, fh] = FALLBACK_DIMS[fallbackKey] || [400, 200];
      const entry = { src, w: img.naturalWidth || fw, h: img.naturalHeight || fh };
      imageCache.set(src, entry);
      resolve(entry);
    };
    img.onload = () => {
      const decoded = typeof img.decode === "function" ? img.decode().catch(() => {}) : Promise.resolve();
      decoded.then(done);
    };
    img.onerror = done;
    // Safety net for environments that never fire load events (jsdom tests).
    setTimeout(done, 3000);
    img.src = src;
  });
}

async function preloadAllImages() {
  const ht = hypeTrainSettings();
  const avatars = Array.isArray(ht.avatars) ? ht.avatars : [];
  const [loco, wagon, endCar] = await Promise.all([
    loadImage(ht.locomotiveImage, "locomotive"),
    loadImage(ht.wagonImage, "wagon"),
    loadImage(ht.endCarImage, "endCar"),
    ...avatars.map((a) => loadImage(a, "avatar"))
  ]);
  return { loco, wagon, endCar };
}

// ---- Layout ----
// The whole animation lives in the BOTTOM QUARTER of the (1920x)1080 canvas: rails span
// the full width near the bottom edge, and the train is scaled so the locomotive fits
// inside the band above the rails. All pieces share one scale factor - the artwork was
// drawn at a common scale, so this keeps loco/wagons/end car proportional to each other.
function computeScale(loco) {
  const viewH = window.innerHeight || 1080;
  const bandH = viewH * 0.25;
  const railsH = viewH * 0.046;
  const maxLocoH = bandH - railsH - viewH * 0.01;
  return maxLocoH / loco.h;
}

function ensureRails() {
  if (railsEl && railsEl.isConnected) return railsEl;
  railsEl = document.createElement("div");
  railsEl.className = "rails";
  stage.append(railsEl);
  return railsEl;
}

function pieceEl(className, entry, scale) {
  const el = document.createElement("div");
  el.className = className;
  el.style.width = `${Math.round(entry.w * scale)}px`;
  el.style.height = `${Math.round(entry.h * scale)}px`;
  if (entry.src) {
    el.style.backgroundImage = `url('${entry.src}')`;
  } else {
    el.innerHTML = `<div class="fallback-art">${className.replace("train-", "")}</div>`;
  }
  return el;
}

// Crops a sub-rectangle out of the locomotive's own image and positions it exactly over
// that same spot on the (already rendered) locomotive element - same background-image,
// same background-size (the full loco at its current on-screen size), just an offset
// background-position so only that rectangle's pixels show through. Surrounding pixels in
// that crop are transparent in the source art, so nothing needs masking.
function locoCrop(loco, locoWpx, locoHpx, leftPx, topPx, wPx, hPx) {
  const el = document.createElement("div");
  el.style.position = "absolute";
  el.style.left = `${Math.round(leftPx)}px`;
  el.style.top = `${Math.round(topPx)}px`;
  el.style.width = `${Math.round(wPx)}px`;
  el.style.height = `${Math.round(hPx)}px`;
  el.style.overflow = "hidden";
  if (loco.src) {
    el.style.backgroundImage = `url('${loco.src}')`;
    el.style.backgroundSize = `${Math.round(locoWpx)}px ${Math.round(locoHpx)}px`;
    el.style.backgroundPosition = `-${Math.round(leftPx)}px -${Math.round(topPx)}px`;
  }
  return el;
}

function buildLocomotive(loco, scale) {
  const el = pieceEl("train-locomotive", loco, scale);
  const locoWpx = loco.w * scale;
  const locoHpx = loco.h * scale;

  // Wheels intentionally NOT animated (per user feedback the spin looked wrong) - only the
  // steam cloud gets the breathing treatment below.

  // Steam: a crop of the drawn cloud, gently pulsing (scale + drift) from a transform
  // origin near the chimney (bottom-center of the cloud's own bounding box) so it reads
  // as the cloud continuously puffing rather than a static sticker.
  const steamBox = LOCO_ART.steam;
  const steamEl = locoCrop(
    loco, locoWpx, locoHpx,
    steamBox.left * locoWpx, steamBox.top * locoHpx,
    steamBox.width * locoWpx, steamBox.height * locoHpx
  );
  steamEl.className = "loco-steam";
  el.append(steamEl);

  return el;
}

function buildCoupler(scale) {
  const el = document.createElement("div");
  el.className = "train-coupler";
  el.style.width = `${Math.max(10, Math.round(60 * scale))}px`;
  el.style.height = `${Math.max(6, Math.round(40 * scale))}px`;
  el.style.marginBottom = `${Math.round(95 * scale)}px`;
  return el;
}

// Offscreen canvas reused for text measurement (cheaper than laying out a real DOM node
// per wagon just to find out how wide the name renders).
const measureCanvas = document.createElement("canvas");
const measureCtx = measureCanvas.getContext ? measureCanvas.getContext("2d") : null;
const NAME_FONT_FAMILY = '"Segoe UI", Inter, Arial, sans-serif';
const NAME_MIN_PX = 10;

function canvasMeasure(text, sizePx) {
  measureCtx.font = `800 ${sizePx}px ${NAME_FONT_FAMILY}`;
  return measureCtx.measureText(text).width;
}

// Picks the largest font size (up to maxPx) at which `text` still fits within maxWidthPx,
// so short names render big and long names shrink down instead of getting truncated.
// `measure(text, sizePx) -> widthPx` is injectable for testing without a real canvas 2D
// context (jsdom has none by default); production always uses the real canvas measurer.
export function fitNameFontSize(text, maxWidthPx, maxPx, measure = canvasMeasure) {
  if (!text) return Math.max(NAME_MIN_PX, Math.round(maxPx));
  if (measure === canvasMeasure && !measureCtx) return Math.max(NAME_MIN_PX, Math.round(maxPx));
  for (let size = Math.round(maxPx); size > NAME_MIN_PX; size--) {
    if (measure(text, size) <= maxWidthPx) return size;
  }
  return NAME_MIN_PX;
}

function buildWagon(participant, wagon, scale) {
  const ht = hypeTrainSettings();
  const avatars = Array.isArray(ht.avatars) ? ht.avatars : [];
  const avatarSrc = avatars.length ? avatars[participant.avatarIndex % avatars.length] : "";
  const wagonW = Math.round(wagon.w * scale);
  const wagonH = Math.round(wagon.h * scale);

  const el = pieceEl("train-wagon", { ...wagon, src: "" }, scale);
  el.style.backgroundImage = "";

  // Avatar: plain transparent PNG, taller than the (flatbed) wagon, dipping slightly into
  // it. The wagon artwork (.wagon-face) is stacked ABOVE the avatar so the passenger looks
  // seated inside the car.
  const avatarH = Math.round(wagonH * 1.7);
  const avatarMarkup = avatarSrc
    ? `<img class="wagon-avatar" src="${escapeHtml(avatarSrc)}" alt="" style="height:${avatarH}px;bottom:${Math.round(wagonH * 0.34)}px">`
    : "";

  // Name plate: the wagon artwork has a golden sign; the CSS targets that area with
  // left:21%/width:58%/top:4%/height:44%. Font size is fit to the actual name length
  // within that box (minus a little padding) instead of a fixed size per wagon height,
  // so "Bob" renders much bigger than "xXx_SuperLongUsername_xXx".
  const color = NAME_COLORS[Math.floor(Math.random() * NAME_COLORS.length)];
  const name = escapeHtml(participant.displayName || participant.login || "Viewer");
  const plateWidthPx = wagonW * 0.58 * 0.9;
  const plateHeightPx = wagonH * 0.44;
  const fontSize = fitNameFontSize(name, plateWidthPx, plateHeightPx);

  el.innerHTML = `
    ${avatarMarkup}
    <div class="wagon-face"${wagon.src ? ` style="background-image:url('${escapeHtml(wagon.src)}')"` : ""}></div>
    <div class="wagon-name" style="color:${color};font-size:${fontSize}px">${name}</div>
  `;
  return el;
}

// Anchor the train so the locomotive's left edge sits near the right screen edge -
// identical for the waiting loco and the assembled departure train, so nothing jumps
// when the wagons get attached.
function placeTrain(train, locoW) {
  const viewW = window.innerWidth || 1920;
  train.style.left = `${Math.round(viewW - locoW - 24)}px`;
}

function clearStage() {
  stage.innerHTML = "";
  trainEl = null;
  railsEl = null;
  stopAudio(waitingAudio);
  waitingAudio = null;
}

// ---- States ----

async function showWaitingTrain() {
  const ht = hypeTrainSettings();
  // Preload everything already now: by the time the hype train ends, all wagons/avatars
  // are decoded and the departure can start without a single network/decode hitch.
  const { loco } = await preloadAllImages();
  clearStage();
  ensureRails();
  const scale = computeScale(loco);
  const train = document.createElement("div");
  train.className = "train";
  train.append(buildLocomotive(loco, scale));
  placeTrain(train, Math.round(loco.w * scale));
  stage.append(train);
  trainEl = train;
  waitingAudio = playSound(ht.sounds?.waiting, true);
}

async function buildDepartureTrain(participants) {
  const { loco, wagon, endCar } = await preloadAllImages();
  clearStage();
  ensureRails();
  const scale = computeScale(loco);

  const train = document.createElement("div");
  train.className = "train is-assembling";
  // DOM order (flex row-reverse renders first child rightmost): end car first, then the
  // wagons, locomotive last => on screen: locomotive leads left, end car closes the train.
  train.append(pieceEl("train-endcar", endCar, scale));
  for (const participant of participants) {
    train.append(buildCoupler(scale));
    train.append(buildWagon(participant, wagon, scale));
  }
  train.append(buildCoupler(scale));
  train.append(buildLocomotive(loco, scale));
  placeTrain(train, Math.round(loco.w * scale));
  stage.append(train);
  trainEl = train;
  return train;
}

async function animateDeparture(participants) {
  const ht = hypeTrainSettings();
  const train = await buildDepartureTrain(participants || []);

  // Let the assembled train stand fully visible for a moment before pulling away.
  await new Promise((resolve) => requestAnimationFrame(resolve));
  train.classList.remove("is-assembling");
  await new Promise((resolve) => setTimeout(resolve, 800));

  playSound(ht.sounds?.departure, false);

  const rect = train.getBoundingClientRect();
  const trainWidth = rect.width || 600;
  const left = parseFloat(train.style.left) || 0;
  const distance = left + trainWidth + 60; // until the end car clears the left edge
  const speed = Math.max(40, Number(ht.speedPxPerSecond) || 220);
  const durationMs = (distance / speed) * 1000;

  train.style.transition = `transform ${durationMs}ms linear`;
  train.classList.add("is-departing");
  requestAnimationFrame(() => {
    train.style.transform = `translate3d(-${distance}px, 0, 0)`;
  });

  await new Promise((resolve) => setTimeout(resolve, durationMs + 200));
  clearStage();
  await completeHypeTrainDeparture();
}

function onHypeTrainBegin() {
  const ht = hypeTrainSettings();
  playSound(ht.sounds?.start, false);
  showWaitingTrain().catch(() => {});
}

function onHypeTrainProgress() {
  // No visual change beyond the steady steaming state; reserved for future use.
}

function onHypeTrainEnd(event) {
  const participants = Array.isArray(event?.participants) ? event.participants : [];
  animateDeparture(participants).catch(() => {
    clearStage();
    completeHypeTrainDeparture();
  });
}

async function loadSettings() {
  settings = await getSettings();
  // Warm the image cache in the background so even the first hype train starts smoothly.
  preloadAllImages().catch(() => {});
}

function bindServerEvents() {
  connectEventStream({
    "hype-train-begin": () => onHypeTrainBegin(),
    "hype-train-progress": (event) => onHypeTrainProgress(event),
    "hype-train-end": (event) => onHypeTrainEnd(event),
    settings: () => loadSettings()
  });
}

async function init() {
  await loadSettings();
  bindServerEvents();
}

init().catch((error) => {
  setStatus(error.message, true);
});
