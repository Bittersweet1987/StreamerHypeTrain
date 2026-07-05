// Static checks on overlay.css: train pieces fully transparent (no fallback background
// colors), rails + couplers styled, name plate positioned on the wagon sign, avatar
// without any frame/background.
import { readPublic, check, finish } from "./helpers.mjs";

const css = readPublic("assets/css/overlay.css");

function ruleBody(selectorPattern) {
  // Anchored to line start so mentions of the selector inside comments don't match.
  const match = css.match(new RegExp("^" + selectorPattern.source + "[^{]*\\{([^}]*)\\}", "m"));
  return match ? match[1] : null;
}

const trainPieces = ruleBody(/\.train-locomotive,\s*\.train-wagon,\s*\.train-endcar/);
check("Zugteile-Regel existiert", trainPieces !== null);
check("Zugteile: keine background-color", trainPieces !== null && !/background-color/.test(trainPieces));
check("Zugteile: kein border-radius (Kartenoptik entfernt)", trainPieces !== null && !/border-radius/.test(trainPieces));
check("Zugteile: kein box-shadow", trainPieces !== null && !/box-shadow/.test(trainPieces));

// No stray per-piece background colors anywhere else either.
check("Kein #2b2440 (alter Lok-Hintergrund) mehr", !css.includes("#2b2440"));
check("Kein #342a52 (alter Endwagen-Hintergrund) mehr", !css.includes("#342a52"));
check("Kein #3a3160 (alter Waggon-Hintergrund) mehr", !css.includes("#3a3160"));

// Rails: full width near the bottom edge, with rail bar and sleepers pseudo-elements.
const rails = ruleBody(/\.rails/);
check(".rails-Regel existiert (volle Breite)", rails !== null && /left:\s*0/.test(rails) && /right:\s*0/.test(rails));
check(".rails::before (Schiene) existiert", /^\.rails::before/m.test(css));
check(".rails::after (Schwellen) existiert", /^\.rails::after/m.test(css));

// Train band: anchored just above the rails (bottom quarter of the canvas).
const train = ruleBody(/\.train /);
check(".train unten verankert (bottom in vh)", train !== null && /bottom:\s*[\d.]+vh/.test(train));

// Assembling state hides the train until everything is laid out.
const assembling = ruleBody(/\.train\.is-assembling/);
check(".train.is-assembling versteckt den Zug", assembling !== null && /visibility:\s*hidden/.test(assembling));

// Couplers between pieces exist.
check(".train-coupler-Regel existiert", ruleBody(/\.train-coupler/) !== null);

// Avatar: plain PNG, no frame, no background.
const avatar = ruleBody(/\.wagon-avatar/);
check(".wagon-avatar-Regel existiert", avatar !== null);
check(".wagon-avatar ohne Rahmen/Hintergrund", avatar !== null && /border:\s*0/.test(avatar) && /background:\s*none/.test(avatar));

const face = ruleBody(/\.wagon-face/);
check(".wagon-face liegt ueber dem Avatar (z-index 2 > 1)", face !== null && /z-index:\s*2/.test(face) && /z-index:\s*1/.test(avatar || ""));

// Name plate: visible again, positioned on the golden sign area of the wagon artwork.
const name = ruleBody(/\.wagon-name/);
check(".wagon-name existiert und ist sichtbar (kein display:none)", name !== null && !/display:\s*none/.test(name));
check(".wagon-name auf dem Schildbereich positioniert (left/top/width/height in %)",
  name !== null && /left:\s*\d+%/.test(name) && /width:\s*\d+%/.test(name));
check(".wagon-name ueber der Waggon-Grafik (z-index 3)", name !== null && /z-index:\s*3/.test(name));

// The old circular window frame must be gone.
check("Kein .wagon-window-Rahmen mehr", !/^\.wagon-window\s*\{/m.test(css));

// Old generic floating steam-puff overlay must be gone entirely.
check("Kein .steam-puffs mehr", !/^\.steam-puffs\s*\{/m.test(css));
check("Kein .steam-puff mehr", !/^\.steam-puff\s*\{/m.test(css));
check("Keine steam-rise-Keyframes mehr", !css.includes("steam-rise"));

// Wheels are intentionally NOT animated (reverted per user feedback) - only steam breathes.
check("Keine Rad-Rotation (.loco-wheel/wheel-spin) mehr", !css.includes("loco-wheel") && !css.includes("wheel-spin"));

const steam = ruleBody(/\.loco-steam/);
check(".loco-steam-Regel existiert (pulsierend)", steam !== null && /animation:\s*steam-breathe/.test(steam));
check("steam-breathe-Keyframes existieren", css.includes("steam-breathe"));

finish("test-css");
