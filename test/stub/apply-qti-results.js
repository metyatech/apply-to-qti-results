import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const result = {
    results: null,
    items: [],
    scoring: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--results") {
      result.results = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--item") {
      const value = argv[i + 1];
      if (value) {
        result.items.push(value);
      }
      i += 1;
      continue;
    }
    if (arg === "--scoring") {
      result.scoring = argv[i + 1] ?? null;
      i += 1;
    }
  }

  return result;
}

function fileExists(filePath) {
  return Boolean(filePath && fs.existsSync(filePath));
}

function error(reason) {
  const payload = {
    path: "/",
    reason,
  };
  process.stdout.write(JSON.stringify(payload, null, 2));
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));

if (!args.results || !args.scoring || args.items.length === 0) {
  error("missing required arguments");
}

if (!fileExists(args.results)) {
  error(`missing results file: ${args.results}`);
}

if (!fileExists(args.scoring)) {
  error(`missing scoring file: ${args.scoring}`);
}

for (const item of args.items) {
  if (!fileExists(item)) {
    error(`missing item file: ${item}`);
  }
}

error("not implemented");
