import fs from "node:fs";
import path from "node:path";

export type GlobExpansion = {
  pattern: string;
  rootDir: string;
  matches: string[];
  isGlob: boolean;
};

const GLOB_REGEX = /[*?]/;

export function hasGlobPattern(value: string): boolean {
  return GLOB_REGEX.test(value);
}

export function expandPathOrGlob(
  pattern: string,
  cwd = process.cwd(),
): GlobExpansion {
  if (!hasGlobPattern(pattern)) {
    const resolved = path.resolve(cwd, pattern);
    return {
      pattern,
      rootDir: path.dirname(resolved),
      matches: fs.existsSync(resolved) ? [resolved] : [],
      isGlob: false,
    };
  }

  const parsed = parseGlob(pattern, cwd);
  const matches = expandGlobSegments(parsed.rootDir, parsed.segments);
  matches.sort((a, b) => a.localeCompare(b));
  return {
    pattern,
    rootDir: parsed.rootDir,
    matches,
    isGlob: true,
  };
}

type ParsedGlob = {
  rootDir: string;
  segments: string[];
};

function parseGlob(pattern: string, cwd: string): ParsedGlob {
  const normalized = normalizePattern(pattern);
  const isAbsolute = path.isAbsolute(pattern);
  let rootPrefix = "";
  let remainder = normalized;

  if (isAbsolute) {
    const parsed = path.parse(pattern);
    rootPrefix = normalizeSeparators(parsed.root);
    remainder = normalized.slice(rootPrefix.length);
  }

  const segments = remainder.split("/").filter(Boolean);
  const wildcardIndex = segments.findIndex((segment) =>
    hasGlobPattern(segment),
  );
  if (wildcardIndex === -1) {
    return {
      rootDir: path.resolve(isAbsolute ? rootPrefix : cwd, ...segments),
      segments: [],
    };
  }

  const rootSegments = segments.slice(0, wildcardIndex);
  const globSegments = segments.slice(wildcardIndex);
  const rootDir = path.resolve(isAbsolute ? rootPrefix : cwd, ...rootSegments);
  return { rootDir, segments: globSegments };
}

function expandGlobSegments(rootDir: string, segments: string[]): string[] {
  if (segments.length === 0) {
    return fs.existsSync(rootDir) && fs.statSync(rootDir).isFile()
      ? [rootDir]
      : [];
  }

  const matches: string[] = [];
  walkSegments(rootDir, segments, 0, matches);
  return matches;
}

function walkSegments(
  currentDir: string,
  segments: string[],
  index: number,
  matches: string[],
): void {
  if (index >= segments.length) {
    if (fs.existsSync(currentDir) && fs.statSync(currentDir).isFile()) {
      matches.push(currentDir);
    }
    return;
  }

  const segment = segments[index];
  if (segment === "**") {
    walkSegments(currentDir, segments, index + 1, matches);
    const entries = safeReadDir(currentDir);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walkSegments(
          path.join(currentDir, entry.name),
          segments,
          index,
          matches,
        );
      }
    }
    return;
  }

  const entries = safeReadDir(currentDir);
  for (const entry of entries) {
    if (!matchSegment(segment, entry.name)) {
      continue;
    }
    const nextPath = path.join(currentDir, entry.name);
    if (index === segments.length - 1) {
      if (entry.isFile()) {
        matches.push(nextPath);
      }
      continue;
    }
    if (entry.isDirectory()) {
      walkSegments(nextPath, segments, index + 1, matches);
    }
  }
}

function matchSegment(pattern: string, name: string): boolean {
  if (!hasGlobPattern(pattern)) {
    return pattern === name;
  }
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexPattern = `^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`;
  const regex = new RegExp(regexPattern);
  return regex.test(name);
}

function safeReadDir(dirPath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function normalizePattern(pattern: string): string {
  return normalizeSeparators(pattern);
}

function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}
