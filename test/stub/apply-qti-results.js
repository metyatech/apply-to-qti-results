import fs from "node:fs";

import { XMLBuilder, XMLParser } from "fast-xml-parser";

function parseArgs(argv) {
  const result = {
    results: null,
    items: [],
    scoring: null,
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
    }
  }

  return result;
}

function fileExists(filePath) {
  return Boolean(filePath && fs.existsSync(filePath));
}

const RESULTS_NAMESPACE = "http://www.imsglobal.org/xsd/imsqti_result_v3p0";
const ITEM_NAMESPACE = "http://www.imsglobal.org/xsd/imsqti_v3p0";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  format: true,
  suppressEmptyNode: true,
});

function error(payload) {
  process.stdout.write(JSON.stringify(payload, null, 2));
  process.exit(2);
}

function fail(reason, pathValue = "/", identifier) {
  const payload = {
    path: pathValue,
    reason,
  };
  if (identifier) {
    payload.identifier = identifier;
  }
  error(payload);
}

function failItem(identifier, reason) {
  fail(reason, `/assessmentResult/itemResult[@identifier='${identifier}']`, identifier);
}

function ensureArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function getTextContent(node) {
  if (node === undefined || node === null) {
    return "";
  }
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    return String(node);
  }
  if (typeof node === "object" && "#text" in node) {
    return String(node["#text"]);
  }
  return "";
}

function decimalPlaces(value) {
  const normalized = value.startsWith("+") ? value.slice(1) : value;
  const index = normalized.indexOf(".");
  return index === -1 ? 0 : normalized.length - index - 1;
}

function toScaledInt(value, scaleDigits) {
  const normalized = value.startsWith("+") ? value.slice(1) : value;
  const negative = normalized.startsWith("-");
  const cleaned = negative ? normalized.slice(1) : normalized;
  const [whole, frac = ""] = cleaned.split(".");
  const padded = frac.padEnd(scaleDigits, "0").slice(0, scaleDigits);
  const scaleFactor = 10 ** scaleDigits;
  const scaled = Number(whole || "0") * scaleFactor + Number(padded || "0");
  return negative ? -scaled : scaled;
}

function formatScaled(value, scaleDigits) {
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

function upsertOutcomeVariable(outcomes, identifier, baseType, value) {
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

function parseXmlFile(filePath, reason) {
  try {
    const xml = fs.readFileSync(filePath, "utf8");
    return parser.parse(xml);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(`${reason}: ${message}`);
  }
  return null;
}

function parseItemSource(filePath) {
  const doc = parseXmlFile(filePath, "failed to parse item source");
  const root = doc?.["qti-assessment-item"];
  if (!root) {
    fail("root element must be qti-assessment-item");
  }
  const namespace = root["@_xmlns"];
  if (namespace && namespace !== ITEM_NAMESPACE) {
    fail(`unexpected item namespace: ${namespace}`);
  }
  const identifier = root["@_identifier"];
  if (!identifier) {
    fail("missing item identifier");
  }
  return { identifier, root };
}

function extractRubric(root, identifier) {
  const itemBody = root["qti-item-body"];
  if (!itemBody) {
    failItem(identifier, "scorer rubric not found");
  }

  const rubricBlocks = ensureArray(itemBody["qti-rubric-block"]);
  const scorerBlock = rubricBlocks.find((block) => block?.["@_view"] === "scorer");
  if (!scorerBlock) {
    failItem(identifier, "scorer rubric not found");
  }

  const paragraphs = ensureArray(scorerBlock["qti-p"]);
  if (paragraphs.length === 0) {
    failItem(identifier, "scorer rubric not found");
  }

  const criteria = [];
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

const args = parseArgs(process.argv.slice(2));

if (!args.results || !args.scoring || args.items.length === 0) {
  fail("missing required arguments");
}

if (!fileExists(args.results)) {
  fail(`missing results file: ${args.results}`);
}

if (!fileExists(args.scoring)) {
  fail(`missing scoring file: ${args.scoring}`);
}

for (const item of args.items) {
  if (!fileExists(item)) {
    fail(`missing item file: ${item}`);
  }
}

const resultsDoc = parseXmlFile(args.results, "failed to parse results");
const assessmentResult = resultsDoc?.assessmentResult;
if (!assessmentResult) {
  fail("root element must be assessmentResult");
}
const resultNamespace = assessmentResult["@_xmlns"];
if (resultNamespace && resultNamespace !== RESULTS_NAMESPACE) {
  fail(`unexpected results namespace: ${resultNamespace}`, "/assessmentResult");
}

const itemResults = ensureArray(assessmentResult.itemResult);
const itemResultById = new Map();
for (const itemResult of itemResults) {
  const identifier = itemResult?.["@_identifier"];
  if (identifier) {
    itemResultById.set(identifier, itemResult);
  }
}

const testResult = assessmentResult.testResult;
if (!testResult) {
  fail("testResult not found", "/assessmentResult/testResult");
}

const scoringInput = (() => {
  try {
    return JSON.parse(fs.readFileSync(args.scoring, "utf8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(`failed to parse scoring input: ${message}`);
  }
  return null;
})();

const itemSourceById = new Map();
for (const itemPath of args.items) {
  const parsed = parseItemSource(itemPath);
  if (itemSourceById.has(parsed.identifier)) {
    fail(`duplicate item identifier in sources: ${parsed.identifier}`);
  }
  itemSourceById.set(parsed.identifier, parsed.root);
}

const rubricCache = new Map();
const processedScores = [];

const scoringItems = ensureArray(scoringInput?.items);
for (const item of scoringItems) {
  const identifier = item?.identifier;
  if (!identifier) {
    fail("missing item identifier in scoring input", "/assessmentResult/itemResult");
  }

  const itemResult = itemResultById.get(identifier);
  if (!itemResult) {
    failItem(identifier, "itemResult not found");
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

  const criteriaInput = ensureArray(item?.criteria);
  if (criteriaInput.length !== rubric.criteria.length) {
    failItem(
      identifier,
      `criteria length (${criteriaInput.length}) does not match rubric criteria count (${rubric.criteria.length})`,
    );
  }

  const outcomes = ensureArray(itemResult.outcomeVariable);
  itemResult.outcomeVariable = outcomes;

  let itemScoreScaled = 0;
  for (let index = 0; index < criteriaInput.length; index += 1) {
    const criterion = criteriaInput[index];
    const rubricCriterion = rubric.criteria[index];
    const met = Boolean(criterion?.met);

    if ("criterionText" in (criterion ?? {}) && criterion?.criterionText !== undefined) {
      if (criterion.criterionText !== rubricCriterion.text) {
        failItem(identifier, `criterionText does not match rubric criterion at index ${index + 1}`);
      }
    }

    if (met) {
      itemScoreScaled += toScaledInt(rubricCriterion.points, rubric.scaleDigits);
    }

    upsertOutcomeVariable(
      outcomes,
      `RUBRIC_${index + 1}_MET`,
      "boolean",
      met ? "true" : "false",
    );
  }

  upsertOutcomeVariable(outcomes, "SCORE", "float", formatScaled(itemScoreScaled, rubric.scaleDigits));
  processedScores.push({ scaled: itemScoreScaled, scale: rubric.scaleDigits });
}

const testOutcomes = ensureArray(testResult.outcomeVariable);
testResult.outcomeVariable = testOutcomes;

const testScale =
  processedScores.length === 0 ? 0 : Math.max(...processedScores.map((score) => score.scale));
let testScoreScaled = 0;
for (const score of processedScores) {
  const multiplier = 10 ** (testScale - score.scale);
  testScoreScaled += score.scaled * multiplier;
}

upsertOutcomeVariable(testOutcomes, "SCORE", "float", formatScaled(testScoreScaled, testScale));

process.stdout.write(builder.build(resultsDoc));
