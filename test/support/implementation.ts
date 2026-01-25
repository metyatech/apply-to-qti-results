import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ScoringError } from "./types.ts";

type RunInput = {
  resultsPath: string;
  assessmentTestPath: string;
  scoringPath: string;
  options?: {
    preserveMet?: boolean;
  };
};

type RunSuccess = {
  ok: true;
  outputXml: string;
  stderr: string;
};

type RunFailure = {
  ok: false;
  error: ScoringError;
  stderr: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COMMAND = process.execPath;
const TSX_CLI = path.resolve(__dirname, "..", "..", "node_modules", "tsx", "dist", "cli.mjs");
const ARGS = [TSX_CLI, path.resolve(__dirname, "..", "stub", "apply-qti-results.ts")];

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
  const stderr = (result.stderr || "").replace(/\r\n/g, "\n").trimEnd();
  if (result.status === 0) {
    const outputXml = fs.readFileSync(input.resultsPath, "utf8");
    return {
      ok: true,
      outputXml,
      stderr,
    };
  }

  if (!stdout) {
    throw new Error("Implementation returned non-zero status with empty output");
  }

  return {
    ok: false,
    error: JSON.parse(stdout) as ScoringError,
    stderr,
  };
}

function buildArgs(baseArgs: string[], input: RunInput): string[] {
  const args = [...baseArgs];
  args.push("--results", input.resultsPath);
  args.push("--assessment-test", input.assessmentTestPath);
  args.push("--scoring", input.scoringPath);
  if (input.options?.preserveMet) {
    args.push("--preserve-met");
  }
  return args;
}
