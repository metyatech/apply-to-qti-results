import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import os from 'node:os';

import { runImplementation } from './implementation.ts';
import type { ScoringError } from './types.ts';
import { normalizeXml } from './xml.ts';

const RESULTS_INPUT = 'results.input.xml';
const RESULTS_EXPECTED = 'results.expected.xml';
const EXPECTED_ERROR = 'expected-error.json';
const EXPECTED_STDERR = 'expected-stderr.txt';
const ASSESSMENT_TEST = 'assessment-test.qti.xml';
const SCORING_INPUT = 'scoring.json';
const OPTIONS_INPUT = 'options.json';
const GLOB_CONFIG = 'glob.json';

export function runCase(caseName: string, caseDir: string): void {
  const globConfigPath = path.join(caseDir, GLOB_CONFIG);
  if (fs.existsSync(globConfigPath)) {
    runGlobCase(caseDir, globConfigPath);
    return;
  }

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
    throw new Error('Expected exactly one of results.expected.xml or expected-error.json');
  }

  if (!fs.existsSync(assessmentTestPath)) {
    throw new Error(`Missing ${ASSESSMENT_TEST}`);
  }

  let actualResult: string | ScoringError;
  let actualStderr = '';
  const options = fs.existsSync(optionsPath)
    ? (JSON.parse(fs.readFileSync(optionsPath, 'utf8')) as { preserveMet?: boolean })
    : undefined;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-qti-results-'));
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
      assert.strictEqual(typeof actualResult !== 'string', true, 'Expected error result');
      const expected = JSON.parse(fs.readFileSync(expectedErrorPath, 'utf8')) as ScoringError;
      assert.deepStrictEqual(actualResult, expected, 'Error output mismatch');
      assertExpectedStderr(expectedStderrPath, actualStderr);
      const originalXml = fs.readFileSync(resultsInputPath, 'utf8');
      const actualXml = fs.readFileSync(tempResultsPath, 'utf8');
      assert.deepStrictEqual(
        normalizeXml(actualXml),
        normalizeXml(originalXml),
        'Results file changed on error',
      );
      return;
    }

    assert.strictEqual(typeof actualResult === 'string', true, 'Expected XML output');
    const expectedXml = fs.readFileSync(expectedOutputPath, 'utf8');
    const normalizedActual = normalizeXml(actualResult as string);
    const normalizedExpected = normalizeXml(expectedXml);
    assert.deepStrictEqual(normalizedActual, normalizedExpected, 'XML output mismatch');
    assertExpectedStderr(expectedStderrPath, actualStderr);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

type GlobConfig = {
  resultsGlob: string;
  scoringGlob: string;
  assessmentTest?: string;
  expectedDir?: string;
  resultsRegex?: string;
  scoringTemplate?: string;
};

function runGlobCase(caseDir: string, globConfigPath: string): void {
  const config = JSON.parse(fs.readFileSync(globConfigPath, 'utf8')) as GlobConfig;
  if (!config.resultsGlob || !config.scoringGlob) {
    throw new Error('glob.json must include resultsGlob and scoringGlob');
  }

  const expectedDir = path.join(caseDir, config.expectedDir ?? 'expected');
  const expectedErrorPath = path.join(caseDir, EXPECTED_ERROR);
  const expectedStderrPath = path.join(caseDir, EXPECTED_STDERR);
  const assessmentTestPath = path.join(caseDir, config.assessmentTest ?? ASSESSMENT_TEST);

  if (!fs.existsSync(assessmentTestPath)) {
    throw new Error(`Missing ${ASSESSMENT_TEST}`);
  }

  const hasExpectedError = fs.existsSync(expectedErrorPath);
  const hasExpectedOutput = fs.existsSync(expectedDir);
  if (hasExpectedError === hasExpectedOutput) {
    throw new Error('Expected exactly one of expected-error.json or expected output directory');
  }

  const resultsRoot = deriveGlobRoot(config.resultsGlob);
  const resultsRootPath = path.join(caseDir, resultsRoot);
  if (!fs.existsSync(resultsRootPath)) {
    throw new Error(`Missing results root directory: ${resultsRoot}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-qti-results-'));
  const tempResultsRootPath = path.join(tempDir, resultsRoot);
  copyDirectory(resultsRootPath, tempResultsRootPath);

  const tempResultsGlob = path.isAbsolute(config.resultsGlob)
    ? config.resultsGlob
    : path.join(tempDir, config.resultsGlob);
  const scoringGlob = path.isAbsolute(config.scoringGlob)
    ? config.scoringGlob
    : path.join(caseDir, config.scoringGlob);

  let actualResult: string | ScoringError;
  let actualStderr = '';

  try {
    const result = runImplementation({
      resultsPath: tempResultsGlob,
      assessmentTestPath,
      scoringPath: scoringGlob,
      resultsRegex: config.resultsRegex,
      scoringTemplate: config.scoringTemplate,
    });
    if (result.ok) {
      actualResult = result.outputXml;
      actualStderr = result.stderr;
    } else {
      actualResult = result.error;
      actualStderr = result.stderr;
    }

    if (hasExpectedError) {
      assert.strictEqual(typeof actualResult !== 'string', true, 'Expected error result');
      const expected = JSON.parse(fs.readFileSync(expectedErrorPath, 'utf8')) as ScoringError;
      assert.deepStrictEqual(actualResult, expected, 'Error output mismatch');
      assertExpectedStderr(expectedStderrPath, actualStderr);
      assertDirectoryUnchanged(resultsRootPath, tempResultsRootPath);
      return;
    }

    assert.strictEqual(typeof actualResult === 'string', true, 'Expected XML output');
    assertExpectedStderr(expectedStderrPath, actualStderr);
    assertExpectedGlobOutputs(expectedDir, tempResultsRootPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function deriveGlobRoot(pattern: string): string {
  const normalized = pattern.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  const wildcardIndex = segments.findIndex((segment) => /[*?]/.test(segment));
  if (wildcardIndex === -1) {
    return path.dirname(pattern);
  }
  return path.join(...segments.slice(0, wildcardIndex));
}

function copyDirectory(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
      continue;
    }
    if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function assertExpectedGlobOutputs(expectedRoot: string, actualRoot: string): void {
  const expectedFiles = collectFiles(expectedRoot);
  if (expectedFiles.length === 0) {
    throw new Error('Expected output directory has no files');
  }
  for (const expectedFile of expectedFiles) {
    const relative = path.relative(expectedRoot, expectedFile);
    const actualFile = path.join(actualRoot, relative);
    if (!fs.existsSync(actualFile)) {
      throw new Error(`Missing updated results file: ${relative}`);
    }
    const expectedXml = fs.readFileSync(expectedFile, 'utf8');
    const actualXml = fs.readFileSync(actualFile, 'utf8');
    const normalizedActual = normalizeXml(actualXml);
    const normalizedExpected = normalizeXml(expectedXml);
    assert.deepStrictEqual(
      normalizedActual,
      normalizedExpected,
      `XML output mismatch: ${relative}`,
    );
  }
}

function assertDirectoryUnchanged(originalRoot: string, tempRoot: string): void {
  const originalFiles = collectFiles(originalRoot);
  for (const originalFile of originalFiles) {
    const relative = path.relative(originalRoot, originalFile);
    const tempFile = path.join(tempRoot, relative);
    if (!fs.existsSync(tempFile)) {
      throw new Error(`Missing temp results file: ${relative}`);
    }
    const originalXml = fs.readFileSync(originalFile, 'utf8');
    const tempXml = fs.readFileSync(tempFile, 'utf8');
    assert.deepStrictEqual(
      normalizeXml(tempXml),
      normalizeXml(originalXml),
      `Results file changed: ${relative}`,
    );
  }
}

function collectFiles(root: string): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function assertExpectedStderr(expectedStderrPath: string, actualStderr: string): void {
  if (!fs.existsSync(expectedStderrPath)) {
    assert.strictEqual(actualStderr, '', 'Unexpected stderr output');
    return;
  }
  const expected = normalizeText(fs.readFileSync(expectedStderrPath, 'utf8'));
  const actual = normalizeText(actualStderr);
  assert.deepStrictEqual(actual, expected, 'Stderr output mismatch');
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').trimEnd();
}
