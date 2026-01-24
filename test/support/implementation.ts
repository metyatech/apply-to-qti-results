import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ScoringError } from "./types.ts";

type RunInput = {
  resultsPath: string;
  itemPaths: string[];
  scoringPath: string;
};

type RunSuccess = {
  ok: true;
  outputXml: string;
};

type RunFailure = {
  ok: false;
  error: ScoringError;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COMMAND = process.execPath;
const ARGS = [path.resolve(__dirname, "..", "stub", "apply-qti-results.js")];

export function runImplementation(input: RunInput): RunSuccess | RunFailure {
  const args = buildArgs(ARGS, input);

  const result = spawnSync(COMMAND, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw result.error;
  }

  const stdout = (result.stdout || "").trim();
  if (result.status === 0) {
    return {
      ok: true,
      outputXml: stdout,
    };
  }

  if (!stdout) {
    throw new Error("Implementation returned non-zero status with empty output");
  }

  return {
    ok: false,
    error: JSON.parse(stdout) as ScoringError,
  };
}

function buildArgs(baseArgs: string[], input: RunInput): string[] {
  const args = [...baseArgs];
  args.push("--results", input.resultsPath);
  for (const itemPath of input.itemPaths) {
    args.push("--item", itemPath);
  }
  args.push("--scoring", input.scoringPath);
  return args;
}
