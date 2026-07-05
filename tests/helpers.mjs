import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_DIR = path.dirname(TESTS_DIR);
export const PUBLIC_DIR = path.join(REPO_DIR, "public");

// public/ has no package.json, so Node would refuse to `import` its .js files as ESM from
// another module. Copy the JS under tests/_sut/ (which inherits tests/package.json type:module)
// before importing. Call once at the top of every test file.
export function prepareSut() {
  const sutDir = path.join(TESTS_DIR, "_sut");
  fs.rmSync(sutDir, { recursive: true, force: true });
  fs.mkdirSync(sutDir, { recursive: true });
  for (const name of ["overlay.js", "admin.js", "api.js"]) {
    fs.copyFileSync(path.join(PUBLIC_DIR, "assets", "js", name), path.join(sutDir, name));
  }
  return sutDir;
}

export function readPublic(relative) {
  return fs.readFileSync(path.join(PUBLIC_DIR, relative), "utf8");
}

let failures = 0;
export function check(label, condition) {
  if (condition) {
    console.log(`  OK   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}`);
  }
}

export function finish(suiteName) {
  if (failures > 0) {
    console.log(`${suiteName}: ${failures} FEHLER`);
    process.exit(1);
  }
  console.log(`${suiteName}: alle Tests bestanden`);
  process.exit(0);
}

// 1x1 transparent PNG - enough for <img src> and background-image URLs in jsdom.
export const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
