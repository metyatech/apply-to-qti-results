import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";

import { applyScoringUpdate, type ScoringError } from "./scoring-update.ts";
import { normalizeXml } from "./xml.ts";

const RESULTS_INPUT = "results.input.xml";
const RESULTS_EXPECTED = "results.expected.xml";
const EXPECTED_ERROR = "expected-error.json";
const SCORING_INPUT = "scoring.json";

export function runCase(caseName: string, caseDir: string): void {
  const resultsInputPath = path.join(caseDir, RESULTS_INPUT);
  const scoringPath = path.join(caseDir, SCORING_INPUT);
  const expectedOutputPath = path.join(caseDir, RESULTS_EXPECTED);
  const expectedErrorPath = path.join(caseDir, EXPECTED_ERROR);

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

  const itemSources = fs
    .readdirSync(caseDir)
    .filter((name) => name.endsWith(".xml"))
    .filter((name) => !name.startsWith("results."))
    .map((name) => path.join(caseDir, name));

  if (itemSources.length === 0) {
    throw new Error("Missing item source XML files");
  }

  const resultsXml = fs.readFileSync(resultsInputPath, "utf8");
  const scoringJson = fs.readFileSync(scoringPath, "utf8");
  const itemXmlList = itemSources.map((filePath) => fs.readFileSync(filePath, "utf8"));

  let actualResult: string | ScoringError;

  try {
    actualResult = applyScoringUpdate({
      resultsXml,
      itemXmlList,
      scoringJson,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unhandled error: ${message}`);
  }

  if (hasExpectedError) {
    assert.strictEqual(typeof actualResult !== "string", true, "Expected error result");
    const expected = JSON.parse(fs.readFileSync(expectedErrorPath, "utf8")) as ScoringError;
    assert.deepStrictEqual(actualResult, expected, "Error output mismatch");
    return;
  }

  assert.strictEqual(typeof actualResult === "string", true, "Expected XML output");
  const expectedXml = fs.readFileSync(expectedOutputPath, "utf8");
  const normalizedActual = normalizeXml(actualResult as string);
  const normalizedExpected = normalizeXml(expectedXml);
  assert.deepStrictEqual(normalizedActual, normalizedExpected, "XML output mismatch");
}
