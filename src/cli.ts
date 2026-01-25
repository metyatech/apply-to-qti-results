import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyScoringUpdates } from "./apply-qti-results.ts";
import { parseXml, type XmlObject } from "./xml.ts";
import { ScoringFailure, type ScoringError } from "./types.ts";

type CliArgs = {
  results: string | null;
  assessmentTest: string | null;
  scoring: string | null;
  preserveMet: boolean;
};

export function runCli(argv: string[]): void {
  const args = parseArgs(argv);

  if (!args.results || !args.scoring || !args.assessmentTest) {
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
  if (!fileExists(args.assessmentTest)) {
    writeError({ path: "/", reason: `missing assessment test file: ${args.assessmentTest}` });
    return;
  }

  try {
    const resultsXml = fs.readFileSync(args.results, "utf8");
    const scoringInput = JSON.parse(fs.readFileSync(args.scoring, "utf8")) as unknown;
    const assessmentTestXml = fs.readFileSync(args.assessmentTest, "utf8");
    const testDir = path.dirname(args.assessmentTest);
    const assessmentTest = parseAssessmentTest(assessmentTestXml);
    const itemSourceXmls = assessmentTest.itemRefs.map((ref) => {
      const itemPath = path.resolve(testDir, ref.href);
      if (!fileExists(itemPath)) {
        throw new ScoringFailure({ path: "/assessmentTest", reason: `missing item file: ${itemPath}` });
      }
      return fs.readFileSync(itemPath, "utf8");
    });

    const outputXml = applyScoringUpdates(
      {
        resultsXml,
        itemSourceXmls,
        scoringInput,
        itemOrder: assessmentTest.itemRefs.map((ref) => ref.identifier),
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
    writeResultsInPlace(args.results, outputXml);
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
    assessmentTest: null,
    scoring: null,
    preserveMet: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--results") {
      result.results = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--assessment-test") {
      result.assessmentTest = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--scoring") {
      result.scoring = argv[i + 1] ?? null;
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

function writeResultsInPlace(targetPath: string, contents: string): void {
  const directory = path.dirname(targetPath);
  const baseName = path.basename(targetPath);
  const tempPath = path.join(directory, `.tmp-${baseName}-${process.pid}-${Date.now()}`);

  fs.writeFileSync(tempPath, contents, "utf8");
  fs.copyFileSync(tempPath, targetPath);
  try {
    fs.unlinkSync(tempPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`warning: failed to remove temp file ${tempPath}: ${message}\n`);
  }
}

const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  runCli(process.argv.slice(2));
}

type AssessmentTestRef = {
  identifier: string;
  href: string;
};

function parseAssessmentTest(xml: string): { itemRefs: AssessmentTestRef[] } {
  const doc = parseXml(xml);
  const testRoot = doc["qti-assessment-test"] as XmlObject | undefined;
  if (!testRoot) {
    throw new ScoringFailure({ path: "/assessmentTest", reason: "root element must be qti-assessment-test" });
  }

  const itemRefs: AssessmentTestRef[] = [];
  const testParts = ensureArray(testRoot["qti-test-part"]);
  for (const part of testParts) {
    const sections = ensureArray((part as XmlObject)?.["qti-assessment-section"]);
    for (const section of sections) {
      const refs = ensureArray((section as XmlObject)?.["qti-assessment-item-ref"]);
      for (const ref of refs) {
        const identifier = (ref as XmlObject)?.["@_identifier"];
        const href = (ref as XmlObject)?.["@_href"];
        if (typeof identifier !== "string" || identifier.length === 0) {
          throw new ScoringFailure({ path: "/assessmentTest", reason: "item ref missing identifier" });
        }
        if (typeof href !== "string" || href.length === 0) {
          throw new ScoringFailure({ path: "/assessmentTest", reason: "item ref missing href" });
        }
        itemRefs.push({ identifier, href });
      }
    }
  }

  if (itemRefs.length === 0) {
    throw new ScoringFailure({ path: "/assessmentTest", reason: "assessment test has no item refs" });
  }

  return { itemRefs };
}

function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}
