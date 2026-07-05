// Runs every test-*.mjs in this folder as its own process (each test calls process.exit).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const tests = fs.readdirSync(dir).filter((f) => f.startsWith("test-") && f.endsWith(".mjs")).sort();

let failed = 0;
for (const test of tests) {
  console.log(`\n=== ${test} ===`);
  const result = spawnSync(process.execPath, [path.join(dir, test)], { stdio: "inherit" });
  if (result.status !== 0) failed += 1;
}

console.log(failed === 0 ? "\nALLE TEST-SUITEN BESTANDEN" : `\n${failed} TEST-SUITE(N) FEHLGESCHLAGEN`);
process.exit(failed === 0 ? 0 : 1);
