// Unit test for the username auto-fit logic: longer names must end up with a smaller (or
// equal) font size than shorter names, and every result must actually fit the given width
// under the injected measurer (a simple avg-char-width model, independent of any real
// canvas/font rendering so this runs without a native canvas dependency).
import { JSDOM } from "jsdom";
import { prepareSut } from "./helpers.mjs";
import { check, finish } from "./helpers.mjs";

const sutDir = prepareSut();
const dom = new JSDOM("<!doctype html><html><body></body></html>");
global.window = dom.window;
global.document = dom.window.document;

const { fitNameFontSize } = await import(`file://${sutDir.replaceAll("\\", "/")}/overlay.js`);

// Deterministic fake measurer: width = length * size * 0.6 (a plausible average glyph
// advance ratio for a bold UI font) - good enough to validate the search algorithm itself.
const measure = (text, size) => text.length * size * 0.6;

const maxWidth = 220; // px
const maxPx = 40; // largest allowed font size

const shortName = "Bob";
const longName = "xXx_SuperLongUsername_xXx";

const shortSize = fitNameFontSize(shortName, maxWidth, maxPx, measure);
const longSize = fitNameFontSize(longName, maxWidth, maxPx, measure);

check("Kurzer Name bekommt die maximale Schriftgroesse", shortSize === maxPx);
check("Langer Name wird kleiner als kurzer Name", longSize < shortSize);
check("Langer Name passt in die Breite (gemäß Messfunktion)", measure(longName, longSize) <= maxWidth);
check("Kurzer Name passt in die Breite (gemäß Messfunktion)", measure(shortName, shortSize) <= maxWidth);

// Extremely long name: must still return something usable (not 0/negative), floored at
// the minimum readable size rather than shrinking indefinitely.
const extremeName = "a".repeat(200);
const extremeSize = fitNameFontSize(extremeName, maxWidth, maxPx, measure);
check("Extrem langer Name faellt nicht unter die Mindestgroesse", extremeSize >= 10);

// Monotonicity: progressively longer names never get a LARGER font than a shorter prefix.
const names = ["Al", "Alex", "Alexander", "AlexanderTheGreatXXL"];
const sizes = names.map((n) => fitNameFontSize(n, maxWidth, maxPx, measure));
let monotonic = true;
for (let i = 1; i < sizes.length; i++) {
  if (sizes[i] > sizes[i - 1]) monotonic = false;
}
check("Schriftgroesse sinkt monoton mit zunehmender Namenslaenge", monotonic);

finish("test-name-fit");
