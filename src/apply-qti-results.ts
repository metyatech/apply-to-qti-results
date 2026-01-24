import { buildXml, parseXml, type XmlObject } from "./xml.ts";
import { ScoringFailure, type ScoringError } from "./types.ts";

const RESULTS_NAMESPACE = "http://www.imsglobal.org/xsd/imsqti_result_v3p0";
const ITEM_NAMESPACE = "http://www.imsglobal.org/xsd/imsqti_v3p0";

type ApplyInput = {
  resultsXml: string;
  itemSourceXmls: string[];
  scoringInput: unknown;
  mappingCsv?: string;
};

type ApplyOptions = {
  preserveMet?: boolean;
  onPreserveMetDowngrade?: (notice: PreserveMetDowngradeNotice) => void;
};

type PreserveMetDowngradeNotice = {
  itemIdentifier: string;
  rubricIndex: number;
};

type IdentifierMapping = {
  resultToItem: Map<string, string>;
  itemToResult: Map<string, string>;
};

type RubricCriterion = {
  points: string;
  text: string;
};

type Rubric = {
  criteria: RubricCriterion[];
  scaleDigits: number;
};

type XmlNode = XmlObject | string | number | boolean | null | undefined;

export function applyScoringUpdates(input: ApplyInput, options: ApplyOptions = {}): string {
  const preserveMet = Boolean(options.preserveMet);
  const onPreserveMetDowngrade = options.onPreserveMetDowngrade;
  const scoringItems = readScoringItems(input.scoringInput);
  const resultsDoc = parseXmlOrFail(input.resultsXml, "failed to parse results");
  const assessmentResult = (resultsDoc as XmlObject).assessmentResult as XmlObject | undefined;
  if (!assessmentResult) {
    fail("root element must be assessmentResult");
  }

  const resultNamespace = assessmentResult["@_xmlns"];
  if (!resultNamespace) {
    fail("missing results namespace", "/assessmentResult");
  }
  if (resultNamespace !== RESULTS_NAMESPACE) {
    fail(`unexpected results namespace: ${resultNamespace}`, "/assessmentResult");
  }

  const itemResults = ensureArray(assessmentResult.itemResult);
  const itemResultById = new Map<string, XmlObject>();
  for (const itemResult of itemResults) {
    const identifier = (itemResult as XmlObject)?.["@_identifier"];
    if (typeof identifier === "string" && identifier.length > 0) {
      itemResultById.set(identifier, itemResult as XmlObject);
    }
  }

  const testResult = assessmentResult.testResult as XmlObject | undefined;
  if (!testResult) {
    fail("testResult not found", "/assessmentResult/testResult");
  }

  const itemSourceById = new Map<string, XmlObject>();
  for (const itemSourceXml of input.itemSourceXmls) {
    const parsed = parseItemSource(itemSourceXml);
    if (itemSourceById.has(parsed.identifier)) {
      fail(`duplicate item identifier in sources: ${parsed.identifier}`);
    }
    itemSourceById.set(parsed.identifier, parsed.root);
  }

  const mapping = input.mappingCsv ? parseMappingCsv(input.mappingCsv) : null;
  if (mapping) {
    validateMapping(mapping, itemResultById, itemSourceById);
  }

  const rubricCache = new Map<string, Rubric>();
  const processedScores: Array<{ scaled: number; scale: number }> = [];

  for (const item of scoringItems) {
    const identifier = item.identifier;
    const resultIdentifier = mapping ? mapping.itemToResult.get(identifier) : identifier;
    if (mapping && !resultIdentifier) {
      failMapping("mapping missing for item identifier", identifier);
    }
    const itemResult = itemResultById.get(resultIdentifier);
    if (!itemResult) {
      failResultItem(resultIdentifier, "itemResult not found");
    }

    const itemSource = itemSourceById.get(identifier);
    if (!itemSource) {
      failItem(identifier, "scoring source not found");
    }

    let rubric = rubricCache.get(identifier);
    if (!rubric) {
      rubric = extractRubric(itemSource, identifier);
      rubricCache.set(identifier, rubric);
    }

    if (!Array.isArray(item.criteria)) {
      failItem(identifier, "criteria must be an array");
    }

    if (item.criteria.length !== rubric.criteria.length) {
      failItem(
        identifier,
        `criteria length (${item.criteria.length}) does not match rubric criteria count (${rubric.criteria.length})`,
      );
    }

    const outcomes = ensureArray(itemResult.outcomeVariable) as XmlObject[];
    itemResult.outcomeVariable = outcomes;
    const existingRubricMet = preserveMet ? extractExistingRubricMet(outcomes) : new Map<number, boolean>();

    let itemScoreScaled = 0;
    for (let index = 0; index < item.criteria.length; index += 1) {
      const criterion = item.criteria[index];
      const rubricCriterion = rubric.criteria[index];

      if (!criterion || typeof criterion !== "object") {
        failItem(identifier, `criterion must be an object at index ${index + 1}`);
      }

      if (typeof (criterion as XmlObject).met !== "boolean") {
        failItem(identifier, `criterion met must be boolean at index ${index + 1}`);
      }

      if ("criterionText" in (criterion as XmlObject) && (criterion as XmlObject).criterionText !== undefined) {
        if (typeof (criterion as XmlObject).criterionText !== "string") {
          failItem(identifier, `criterionText must be string at index ${index + 1}`);
        }
        if ((criterion as XmlObject).criterionText !== rubricCriterion.text) {
          failItem(identifier, `criterionText does not match rubric criterion at index ${index + 1}`);
        }
      }

      const requestedMet = Boolean((criterion as XmlObject).met);
      const existingMet = existingRubricMet.get(index + 1);
      const preserveDowngrade = preserveMet && existingMet === true && requestedMet === false;
      const finalMet = preserveDowngrade ? true : requestedMet;

      if (preserveDowngrade) {
        onPreserveMetDowngrade?.({
          itemIdentifier: identifier,
          rubricIndex: index + 1,
        });
      }

      if (finalMet) {
        itemScoreScaled += toScaledInt(rubricCriterion.points, rubric.scaleDigits);
      }

      upsertOutcomeVariable(
        outcomes,
        `RUBRIC_${index + 1}_MET`,
        "boolean",
        finalMet ? "true" : "false",
      );
    }

    upsertOutcomeVariable(
      outcomes,
      "SCORE",
      "float",
      formatScaled(itemScoreScaled, rubric.scaleDigits),
    );
    processedScores.push({ scaled: itemScoreScaled, scale: rubric.scaleDigits });
  }

  const testOutcomes = ensureArray(testResult.outcomeVariable) as XmlObject[];
  testResult.outcomeVariable = testOutcomes;

  const testScale =
    processedScores.length === 0 ? 0 : Math.max(...processedScores.map((score) => score.scale));
  let testScoreScaled = 0;
  for (const score of processedScores) {
    const multiplier = 10 ** (testScale - score.scale);
    testScoreScaled += score.scaled * multiplier;
  }

  upsertOutcomeVariable(
    testOutcomes,
    "SCORE",
    "float",
    formatScaled(testScoreScaled, testScale),
  );

  return buildXml(resultsDoc);
}

function readScoringItems(scoringInput: unknown): Array<{ identifier: string; criteria: unknown }> {
  if (!scoringInput || typeof scoringInput !== "object" || Array.isArray(scoringInput)) {
    fail("scoring input must be an object", "/scoring");
  }
  const items = (scoringInput as XmlObject).items;
  if (!Array.isArray(items) || items.length === 0) {
    fail("scoring input items missing or empty", "/scoring/items");
  }

  return items.map((item, index) => {
    if (!item || typeof item !== "object") {
      fail(`scoring item must be an object at index ${index + 1}`, "/scoring/items");
    }
    const identifier = (item as XmlObject).identifier;
    if (typeof identifier !== "string" || identifier.length === 0) {
      fail("missing item identifier in scoring input", "/assessmentResult/itemResult");
    }
    return {
      identifier,
      criteria: (item as XmlObject).criteria,
    };
  });
}

function parseXmlOrFail(xml: string, reason: string): XmlObject {
  try {
    return parseXml(xml);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(`${reason}: ${message}`);
  }
  return {};
}

function parseItemSource(xml: string): { identifier: string; root: XmlObject } {
  const doc = parseXmlOrFail(xml, "failed to parse item source");
  const root = doc["qti-assessment-item"] as XmlObject | undefined;
  if (!root) {
    fail("root element must be qti-assessment-item");
  }
  const namespace = root["@_xmlns"];
  if (namespace && namespace !== ITEM_NAMESPACE) {
    fail(`unexpected item namespace: ${namespace}`);
  }
  const identifier = root["@_identifier"];
  if (typeof identifier !== "string" || identifier.length === 0) {
    fail("missing item identifier");
  }
  return { identifier, root };
}

function extractRubric(root: XmlObject, identifier: string): Rubric {
  const itemBody = root["qti-item-body"] as XmlObject | undefined;
  if (!itemBody) {
    failItem(identifier, "scorer rubric not found");
  }

  const rubricBlocks = ensureArray(itemBody["qti-rubric-block"]) as XmlObject[];
  const scorerBlock = rubricBlocks.find((block) => block?.["@_view"] === "scorer");
  if (!scorerBlock) {
    failItem(identifier, "scorer rubric not found");
  }

  const paragraphs = ensureArray((scorerBlock as XmlObject)["qti-p"]) as XmlNode[];
  if (paragraphs.length === 0) {
    failItem(identifier, "scorer rubric not found");
  }

  const criteria: RubricCriterion[] = [];
  let scaleDigits = 0;

  for (let index = 0; index < paragraphs.length; index += 1) {
    const text = getTextContent(paragraphs[index]);
    const match = /^\s*\[([+-]?\d+(?:\.\d+)?)\]\s*(.+?)\s*$/.exec(text);
    if (!match) {
      failItem(identifier, `rubric line parse failed at index ${index + 1}`);
    }
    const points = match[1];
    const criterionText = match[2].trim();
    const parsed = Number(points);
    if (!Number.isFinite(parsed)) {
      failItem(identifier, `invalid rubric points at index ${index + 1}`);
    }
    scaleDigits = Math.max(scaleDigits, decimalPlaces(points));
    criteria.push({
      points,
      text: criterionText,
    });
  }

  return { criteria, scaleDigits };
}

function getTextContent(node: XmlNode): string {
  if (node === undefined || node === null) {
    return "";
  }
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    return String(node);
  }
  if (typeof node === "object" && "#text" in node) {
    return String((node as XmlObject)["#text"]);
  }
  return "";
}

function extractExistingRubricMet(outcomes: XmlObject[]): Map<number, boolean> {
  const result = new Map<number, boolean>();
  for (const outcome of outcomes) {
    const identifier = outcome?.["@_identifier"];
    if (typeof identifier !== "string") {
      continue;
    }
    const match = /^RUBRIC_(\d+)_MET$/.exec(identifier);
    if (!match) {
      continue;
    }
    const index = Number(match[1]);
    if (!Number.isFinite(index)) {
      continue;
    }
    const rawValue = getTextContent((outcome as XmlObject).value);
    if (rawValue === "true") {
      result.set(index, true);
    } else if (rawValue === "false") {
      result.set(index, false);
    }
  }
  return result;
}

function parseMappingCsv(csv: string): IdentifierMapping {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    failMapping("mapping file is empty");
  }

  const header = lines[0];
  if (header !== "resultItemIdentifier,itemIdentifier") {
    failMapping("mapping header must be resultItemIdentifier,itemIdentifier");
  }

  const resultToItem = new Map<string, string>();
  const itemToResult = new Map<string, string>();

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    const parts = line.split(",");
    if (parts.length !== 2) {
      failMapping(`mapping row must have 2 columns at line ${index + 1}`);
    }
    const resultId = parts[0].trim();
    const itemId = parts[1].trim();
    if (!resultId || !itemId) {
      failMapping(`mapping row missing identifier at line ${index + 1}`);
    }
    if (resultToItem.has(resultId)) {
      failMapping(`duplicate resultItemIdentifier: ${resultId}`);
    }
    if (itemToResult.has(itemId)) {
      failMapping(`duplicate itemIdentifier: ${itemId}`);
    }
    resultToItem.set(resultId, itemId);
    itemToResult.set(itemId, resultId);
  }

  if (resultToItem.size === 0) {
    failMapping("mapping file has no entries");
  }

  return { resultToItem, itemToResult };
}

function validateMapping(
  mapping: IdentifierMapping,
  itemResultById: Map<string, XmlObject>,
  itemSourceById: Map<string, XmlObject>,
): void {
  for (const [resultId, itemId] of mapping.resultToItem.entries()) {
    if (!itemResultById.has(resultId)) {
      failMapping(`mapping refers to unknown result item identifier: ${resultId}`);
    }
    if (!itemSourceById.has(itemId)) {
      failMapping(`mapped item identifier not found in item sources: ${itemId}`, itemId);
    }
  }

  for (const resultId of itemResultById.keys()) {
    if (!mapping.resultToItem.has(resultId)) {
      failResultItem(resultId, `mapping missing for result item identifier`);
    }
  }
}

function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function decimalPlaces(value: string): number {
  const normalized = value.startsWith("+") ? value.slice(1) : value;
  const index = normalized.indexOf(".");
  return index === -1 ? 0 : normalized.length - index - 1;
}

function toScaledInt(value: string, scaleDigits: number): number {
  const normalized = value.startsWith("+") ? value.slice(1) : value;
  const negative = normalized.startsWith("-");
  const cleaned = negative ? normalized.slice(1) : normalized;
  const [whole, frac = ""] = cleaned.split(".");
  const padded = frac.padEnd(scaleDigits, "0").slice(0, scaleDigits);
  const scaleFactor = 10 ** scaleDigits;
  const scaled = Number(whole || "0") * scaleFactor + Number(padded || "0");
  return negative ? -scaled : scaled;
}

function formatScaled(value: number, scaleDigits: number): string {
  if (scaleDigits === 0) {
    return String(value);
  }
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const scaleFactor = 10 ** scaleDigits;
  const whole = Math.floor(abs / scaleFactor);
  const frac = String(abs % scaleFactor).padStart(scaleDigits, "0");
  const raw = `${whole}.${frac}`;
  const trimmed = raw.replace(/\.?0+$/, "");
  return `${sign}${trimmed}`;
}

function upsertOutcomeVariable(
  outcomes: XmlObject[],
  identifier: string,
  baseType: string,
  value: string,
): void {
  const index = outcomes.findIndex((outcome) => outcome?.["@_identifier"] === identifier);
  if (index >= 0) {
    const existing = outcomes[index];
    existing["@_identifier"] = identifier;
    existing["@_baseType"] = baseType;
    existing.value = value;
    return;
  }
  outcomes.push({
    "@_identifier": identifier,
    "@_baseType": baseType,
    value,
  });
}

function fail(reason: string, pathValue = "/", identifier?: string): never {
  const payload: ScoringError = {
    path: pathValue,
    reason,
  };
  if (identifier) {
    payload.identifier = identifier;
  }
  throw new ScoringFailure(payload);
}

function failItem(identifier: string, reason: string): never {
  fail(reason, `/assessmentResult/itemResult[@identifier='${identifier}']`, identifier);
}

function failResultItem(identifier: string, reason: string): never {
  fail(reason, `/assessmentResult/itemResult[@identifier='${identifier}']`, identifier);
}

function failMapping(reason: string, identifier?: string): never {
  fail(reason, "/mapping", identifier);
}
