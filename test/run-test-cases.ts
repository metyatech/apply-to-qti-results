import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCase } from "./support/run-case.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const casesRoot = path.resolve(__dirname, "test-cases");

if (!fs.existsSync(casesRoot)) {
  console.error(`Missing test cases directory: ${casesRoot}`);
  process.exit(1);
}

const entries = fs
  .readdirSync(casesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (entries.length === 0) {
  console.error("No test cases found.");
  process.exit(1);
}

let failed = 0;

for (const entry of entries) {
  const caseDir = path.join(casesRoot, entry);
  try {
    runCase(entry, caseDir);
    console.log(`PASS ${entry}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL ${entry}: ${message}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} case(s) failed.`);
  process.exit(1);
}

console.log(`\n${entries.length} case(s) passed.`);
