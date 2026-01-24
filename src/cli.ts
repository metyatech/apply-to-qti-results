import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyScoringUpdates } from "./apply-qti-results.ts";
import { ScoringFailure, type ScoringError } from "./types.ts";

type CliArgs = {
  results: string | null;
  items: string[];
  scoring: string | null;
  preserveMet: boolean;
  mapping: string | null;
};

export function runCli(argv: string[]): void {
  const args = parseArgs(argv);

  if (!args.results || !args.scoring || args.items.length === 0) {
    writeError({ path: "/", reason: "missing required arguments" });
    return;
  }

  if (!fileExists(args.results)) {
    writeError({ path: "/", reason: `missing results file: ${args.results}` });
    return;
  }

  if (!fileExists(args.scoring)) {
    writeError({ path: "/", reason: `missing scoring file: ${args.scoring}` });
    return;
  }
  if (args.mapping && !fileExists(args.mapping)) {
    writeError({ path: "/", reason: `missing mapping file: ${args.mapping}` });
    return;
  }

  for (const item of args.items) {
    if (!fileExists(item)) {
      writeError({ path: "/", reason: `missing item file: ${item}` });
      return;
    }
  }

  try {
    const resultsXml = fs.readFileSync(args.results, "utf8");
    const itemSourceXmls = args.items.map((itemPath) => fs.readFileSync(itemPath, "utf8"));
    const scoringInput = JSON.parse(fs.readFileSync(args.scoring, "utf8")) as unknown;
    const mappingCsv = args.mapping ? fs.readFileSync(args.mapping, "utf8") : undefined;

    const outputXml = applyScoringUpdates(
      {
        resultsXml,
        itemSourceXmls,
        scoringInput,
        mappingCsv,
      },
      {
        preserveMet: args.preserveMet,
        onPreserveMetDowngrade: (notice) => {
          process.stderr.write(
            `preserve-met: ${notice.itemIdentifier} RUBRIC_${notice.rubricIndex}_MET stays true (requested false)\n`,
          );
        },
      },
    );
    process.stdout.write(outputXml);
  } catch (error) {
    if (error instanceof ScoringFailure) {
      writeError(error.payload);
      return;
    }

    if (error instanceof SyntaxError) {
      writeError({ path: "/", reason: `failed to parse scoring input: ${error.message}` });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    writeError({ path: "/", reason: `unexpected error: ${message}` });
  }
}

function parseArgs(argv: string[]): CliArgs {
  const result: CliArgs = {
    results: null,
    items: [],
    scoring: null,
    preserveMet: false,
    mapping: null,
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
      continue;
    }
    if (arg === "--mapping") {
      result.mapping = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--preserve-met") {
      result.preserveMet = true;
      continue;
    }
  }

  return result;
}

function fileExists(filePath: string | null): boolean {
  return Boolean(filePath && fs.existsSync(filePath));
}

function writeError(payload: ScoringError): void {
  process.stdout.write(JSON.stringify(payload, null, 2));
  process.exit(2);
}

const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  runCli(process.argv.slice(2));
}
