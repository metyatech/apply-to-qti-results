import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import os from "node:os";

import { runImplementation } from "./implementation.ts";
import type { ScoringError } from "./types.ts";
import { normalizeXml } from "./xml.ts";

const RESULTS_INPUT = "results.input.xml";
const RESULTS_EXPECTED = "results.expected.xml";
const EXPECTED_ERROR = "expected-error.json";
const EXPECTED_STDERR = "expected-stderr.txt";
const ASSESSMENT_TEST = "assessment-test.qti.xml";
const SCORING_INPUT = "scoring.json";
const OPTIONS_INPUT = "options.json";

export function runCase(caseName: string, caseDir: string): void {
  const resultsInputPath = path.join(caseDir, RESULTS_INPUT);
  const scoringPath = path.join(caseDir, SCORING_INPUT);
  const expectedOutputPath = path.join(caseDir, RESULTS_EXPECTED);
  const expectedErrorPath = path.join(caseDir, EXPECTED_ERROR);
  const expectedStderrPath = path.join(caseDir, EXPECTED_STDERR);
  const assessmentTestPath = path.join(caseDir, ASSESSMENT_TEST);
  const optionsPath = path.join(caseDir, OPTIONS_INPUT);

  if (!fs.existsSync(resultsInputPath)) {
    throw new Error(`Missing ${RESULTS_INPUT}`);
  }
  if (!fs.existsSync(scoringPath)) {
    throw new Error(`Missing ${SCORING_INPUT}`);
  }

  const hasExpectedXml = fs.existsSync(expectedOutputPath);
  const hasExpectedError = fs.existsSync(expectedErrorPath);

  if (hasExpectedXml === hasExpectedError) {
    throw new Error("Expected exactly one of results.expected.xml or expected-error.json");
  }

  if (!fs.existsSync(assessmentTestPath)) {
    throw new Error(`Missing ${ASSESSMENT_TEST}`);
  }

  let actualResult: string | ScoringError;
  let actualStderr = "";
  const options = fs.existsSync(optionsPath)
    ? (JSON.parse(fs.readFileSync(optionsPath, "utf8")) as { preserveMet?: boolean })
    : undefined;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-qti-results-"));
  const tempResultsPath = path.join(tempDir, RESULTS_INPUT);
  fs.copyFileSync(resultsInputPath, tempResultsPath);

  try {
    try {
      const result = runImplementation({
        resultsPath: tempResultsPath,
        assessmentTestPath,
        scoringPath,
        options,
      });
      if (result.ok) {
        actualResult = result.outputXml;
        actualStderr = result.stderr;
      } else {
        actualResult = result.error;
        actualStderr = result.stderr;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Unhandled error: ${message}`);
    }

    if (hasExpectedError) {
      assert.strictEqual(typeof actualResult !== "string", true, "Expected error result");
      const expected = JSON.parse(fs.readFileSync(expectedErrorPath, "utf8")) as ScoringError;
      assert.deepStrictEqual(actualResult, expected, "Error output mismatch");
      assertExpectedStderr(expectedStderrPath, actualStderr);
      const originalXml = fs.readFileSync(resultsInputPath, "utf8");
      const actualXml = fs.readFileSync(tempResultsPath, "utf8");
      assert.deepStrictEqual(normalizeXml(actualXml), normalizeXml(originalXml), "Results file changed on error");
      return;
    }

    assert.strictEqual(typeof actualResult === "string", true, "Expected XML output");
    const expectedXml = fs.readFileSync(expectedOutputPath, "utf8");
    const normalizedActual = normalizeXml(actualResult as string);
    const normalizedExpected = normalizeXml(expectedXml);
    assert.deepStrictEqual(normalizedActual, normalizedExpected, "XML output mismatch");
    assertExpectedStderr(expectedStderrPath, actualStderr);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function assertExpectedStderr(expectedStderrPath: string, actualStderr: string): void {
  if (!fs.existsSync(expectedStderrPath)) {
    assert.strictEqual(actualStderr, "", "Unexpected stderr output");
    return;
  }
  const expected = normalizeText(fs.readFileSync(expectedStderrPath, "utf8"));
  const actual = normalizeText(actualStderr);
  assert.deepStrictEqual(actual, expected, "Stderr output mismatch");
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").trimEnd();
}
