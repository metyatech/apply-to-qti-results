import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyScoringUpdates } from "./apply-qti-results.js";
import { expandPathOrGlob, hasGlobPattern } from "./glob.js";
import { parseXml, type XmlObject } from "./xml.js";
import { ScoringFailure, type ScoringError } from "./types.js";

type CliArgs = {
  results: string | null;
  assessmentTest: string | null;
  scoring: string | null;
  resultsRegex: string | null;
  scoringTemplate: string | null;
  preserveMet: boolean;
};

export function runCli(argv: string[]): void {
  const args = parseArgs(argv);

  if (!args.results || !args.scoring || !args.assessmentTest) {
    writeError({ path: "/", reason: "missing required arguments" });
    return;
  }

  if (args.scoringTemplate && !args.resultsRegex) {
    writeError({
      path: "/scoring-template",
      reason: "scoring-template requires results-regex",
    });
    return;
  }
  if (args.resultsRegex && !args.scoringTemplate) {
    writeError({
      path: "/scoring-template",
      reason: "scoring-template is required when results-regex is set",
    });
    return;
  }

  const regexMode = Boolean(args.resultsRegex && args.scoringTemplate);

  if (!hasGlobPattern(args.results) && !fileExists(args.results)) {
    writeError({ path: "/", reason: `missing results file: ${args.results}` });
    return;
  }

  if (regexMode) {
    if (!hasGlobPattern(args.scoring) && !fs.existsSync(args.scoring)) {
      writeError({
        path: "/scoring",
        reason: `missing scoring path: ${args.scoring}`,
      });
      return;
    }
  } else if (!hasGlobPattern(args.scoring) && !fileExists(args.scoring)) {
    writeError({ path: "/", reason: `missing scoring file: ${args.scoring}` });
    return;
  }
  if (!fileExists(args.assessmentTest)) {
    writeError({
      path: "/",
      reason: `missing assessment test file: ${args.assessmentTest}`,
    });
    return;
  }

  try {
    const assessmentTestXml = fs.readFileSync(args.assessmentTest, "utf8");
    const testDir = path.dirname(args.assessmentTest);
    const assessmentTest = parseAssessmentTest(assessmentTestXml);
    const itemSourceXmls = assessmentTest.itemRefs.map((ref) => {
      const itemPath = path.resolve(testDir, ref.href);
      if (!fileExists(itemPath)) {
        throw new ScoringFailure({
          path: "/assessmentTest",
          reason: `missing item file: ${itemPath}`,
        });
      }
      return fs.readFileSync(itemPath, "utf8");
    });

    const itemOrder = assessmentTest.itemRefs.map((ref) => ref.identifier);
    const inputPairs = resolveInputPairs(args.results, args.scoring, {
      resultsRegex: args.resultsRegex,
      scoringTemplate: args.scoringTemplate,
    });
    const isBatch = inputPairs.length > 1;

    for (const pair of inputPairs) {
      try {
        const resultsXml = fs.readFileSync(pair.resultsPath, "utf8");
        const scoringInput = JSON.parse(
          fs.readFileSync(pair.scoringPath, "utf8"),
        ) as unknown;
        const outputXml = applyScoringUpdates(
          {
            resultsXml,
            itemSourceXmls,
            scoringInput,
            itemOrder,
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
        writeResultsInPlace(pair.resultsPath, outputXml);
      } catch (error) {
        if (isBatch) {
          process.stderr.write(
            `batch: failed for results file ${pair.resultsPath}\n`,
          );
        }
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof ScoringFailure) {
      writeError(error.payload);
      return;
    }

    if (error instanceof SyntaxError) {
      writeError({
        path: "/",
        reason: `failed to parse scoring input: ${error.message}`,
      });
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
    resultsRegex: null,
    scoringTemplate: null,
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
    if (arg === "--results-regex") {
      result.resultsRegex = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--scoring-template") {
      result.scoringTemplate = argv[i + 1] ?? null;
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
  const tempPath = path.join(
    directory,
    `.tmp-${baseName}-${process.pid}-${Date.now()}`,
  );

  fs.writeFileSync(tempPath, contents, "utf8");
  fs.copyFileSync(tempPath, targetPath);
  try {
    fs.unlinkSync(tempPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `warning: failed to remove temp file ${tempPath}: ${message}\n`,
    );
  }
}

const __filename = fileURLToPath(import.meta.url);

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename)
) {
  runCli(process.argv.slice(2));
}

type InputPair = {
  resultsPath: string;
  scoringPath: string;
};

type PairOptions = {
  resultsRegex: string | null;
  scoringTemplate: string | null;
};

function resolveInputPairs(
  resultsArg: string,
  scoringArg: string,
  options: PairOptions,
): InputPair[] {
  const resultsExpansion = expandPathOrGlob(resultsArg);
  if (resultsExpansion.matches.length === 0) {
    failInput("results", `results glob matched no files: ${resultsArg}`);
  }

  const scoringExpansion = expandPathOrGlob(scoringArg);
  const regexMode = Boolean(options.resultsRegex && options.scoringTemplate);

  if (!regexMode && scoringExpansion.matches.length === 0) {
    failInput("scoring", `scoring glob matched no files: ${scoringArg}`);
  }

  if (
    !regexMode &&
    resultsExpansion.matches.length > 1 &&
    !scoringExpansion.isGlob
  ) {
    failInput(
      "scoring",
      "scoring must be a glob when results matches multiple files",
    );
  }

  if (
    !regexMode &&
    resultsExpansion.matches.length === 1 &&
    scoringExpansion.matches.length === 1
  ) {
    return [
      {
        resultsPath: resultsExpansion.matches[0],
        scoringPath: scoringExpansion.matches[0],
      },
    ];
  }

  if (regexMode) {
    const regex = compileResultsRegex(options.resultsRegex as string);
    const scoringRootDir = resolveScoringRoot(scoringArg, scoringExpansion);
    const pairs = resolveRegexPairs(
      resultsExpansion.rootDir,
      resultsExpansion.matches,
      scoringRootDir,
      regex,
      options.scoringTemplate as string,
    );
    pairs.sort((a, b) => a.resultsPath.localeCompare(b.resultsPath));
    return pairs;
  }

  const scoringByKey = new Map<string, string>();
  for (const scoringPath of scoringExpansion.matches) {
    const key = buildMatchKey(scoringExpansion.rootDir, scoringPath);
    if (scoringByKey.has(key)) {
      failInput("scoring", `scoring glob has duplicate entry for: ${key}`);
    }
    scoringByKey.set(key, scoringPath);
  }

  const pairs: InputPair[] = [];
  for (const resultsPath of resultsExpansion.matches) {
    const key = buildMatchKey(resultsExpansion.rootDir, resultsPath);
    const scoringPath = scoringByKey.get(key);
    if (!scoringPath) {
      failInput("scoring", `scoring file not found for results entry: ${key}`);
    }
    pairs.push({ resultsPath, scoringPath });
  }

  pairs.sort((a, b) => a.resultsPath.localeCompare(b.resultsPath));
  return pairs;
}

function resolveRegexPairs(
  resultsRootDir: string,
  resultsPaths: string[],
  scoringRootDir: string,
  regex: RegExp,
  template: string,
): InputPair[] {
  const pairs: InputPair[] = [];
  const seenScoringPaths = new Set<string>();

  for (const resultsPath of resultsPaths) {
    const relativePath = buildRelativePath(resultsRootDir, resultsPath);
    const tokens = buildTemplateTokens(relativePath, regex);
    const scoringPath = resolveTemplatePath(scoringRootDir, template, tokens);
    if (seenScoringPaths.has(scoringPath)) {
      failInput(
        "scoring",
        `scoring template resolved duplicate scoring path: ${scoringPath}`,
      );
    }
    if (!fs.existsSync(scoringPath)) {
      failInput(
        "scoring",
        `scoring file not found for results entry: ${relativePath}`,
      );
    }
    seenScoringPaths.add(scoringPath);
    pairs.push({ resultsPath, scoringPath });
  }

  return pairs;
}

function buildMatchKey(rootDir: string, filePath: string): string {
  const relativePath = buildRelativePath(rootDir, filePath);
  const parsed = path.posix.parse(relativePath);
  const withoutExtension = parsed.dir
    ? path.posix.join(parsed.dir, parsed.name)
    : parsed.name;
  return normalizeKey(withoutExtension);
}

function buildRelativePath(rootDir: string, filePath: string): string {
  const relativePath = path.relative(rootDir, filePath);
  return relativePath.replace(/\\/g, "/");
}

function normalizeKey(value: string): string {
  return value.toLowerCase();
}

function compileResultsRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, "i");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failResultsRegex(`invalid results regex: ${message}`);
  }
}

function resolveScoringRoot(
  scoringArg: string,
  scoringExpansion: ReturnType<typeof expandPathOrGlob>,
): string {
  if (hasGlobPattern(scoringArg)) {
    return scoringExpansion.rootDir;
  }
  const resolved = path.resolve(scoringArg);
  try {
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      return resolved;
    }
  } catch {
    // Fall back to the expansion root directory.
  }
  return scoringExpansion.rootDir;
}

function buildTemplateTokens(
  relativePath: string,
  regex: RegExp,
): Record<string, string> {
  const match = regex.exec(relativePath);
  if (!match || match[0] !== relativePath) {
    failResultsRegex(
      `results regex did not match results entry: ${relativePath}`,
    );
  }

  const parsed = path.posix.parse(relativePath);
  const tokens: Record<string, string> = {
    path: relativePath,
    dir: parsed.dir,
    base: parsed.name,
    ext: parsed.ext,
  };

  for (let i = 1; i < match.length; i += 1) {
    const value = match[i];
    if (value !== undefined) {
      tokens[String(i)] = value;
    }
  }

  const groups = match.groups ?? {};
  for (const [key, value] of Object.entries(groups)) {
    if (value !== undefined) {
      tokens[key] = value;
      const lowerKey = key.toLowerCase();
      if (!tokens[lowerKey]) {
        tokens[lowerKey] = value;
      }
    }
  }

  return tokens;
}

function resolveTemplatePath(
  scoringRootDir: string,
  template: string,
  tokens: Record<string, string>,
): string {
  const rendered = applyTemplate(template, tokens);
  if (path.isAbsolute(rendered)) {
    return rendered;
  }
  return path.resolve(scoringRootDir, rendered);
}

function applyTemplate(
  template: string,
  tokens: Record<string, string>,
): string {
  return template.replace(/\{([^{}]+)\}/g, (_match, tokenName: string) => {
    const token = tokens[tokenName] ?? tokens[tokenName.toLowerCase()];
    if (token === undefined) {
      failScoringTemplate(`unknown template token: ${tokenName}`);
    }
    return token;
  });
}

function failInput(inputName: "results" | "scoring", reason: string): never {
  throw new ScoringFailure({ path: `/${inputName}`, reason });
}

function failResultsRegex(reason: string): never {
  throw new ScoringFailure({ path: "/results-regex", reason });
}

function failScoringTemplate(reason: string): never {
  throw new ScoringFailure({ path: "/scoring-template", reason });
}

type AssessmentTestRef = {
  identifier: string;
  href: string;
};

function parseAssessmentTest(xml: string): { itemRefs: AssessmentTestRef[] } {
  const doc = parseXml(xml);
  const testRoot = doc["qti-assessment-test"] as XmlObject | undefined;
  if (!testRoot) {
    throw new ScoringFailure({
      path: "/assessmentTest",
      reason: "root element must be qti-assessment-test",
    });
  }

  const itemRefs: AssessmentTestRef[] = [];
  const testParts = ensureArray(testRoot["qti-test-part"]);
  for (const part of testParts) {
    const sections = ensureArray(
      (part as XmlObject)?.["qti-assessment-section"],
    );
    for (const section of sections) {
      const refs = ensureArray(
        (section as XmlObject)?.["qti-assessment-item-ref"],
      );
      for (const ref of refs) {
        const identifier = (ref as XmlObject)?.["@_identifier"];
        const href = (ref as XmlObject)?.["@_href"];
        if (typeof identifier !== "string" || identifier.length === 0) {
          throw new ScoringFailure({
            path: "/assessmentTest",
            reason: "item ref missing identifier",
          });
        }
        if (typeof href !== "string" || href.length === 0) {
          throw new ScoringFailure({
            path: "/assessmentTest",
            reason: "item ref missing href",
          });
        }
        itemRefs.push({ identifier, href });
      }
    }
  }

  if (itemRefs.length === 0) {
    throw new ScoringFailure({
      path: "/assessmentTest",
      reason: "assessment test has no item refs",
    });
  }

  return { itemRefs };
}

function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}
