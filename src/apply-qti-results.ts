import {
  buildXml,
  parseXml,
  parseXmlPreserveOrder,
  type XmlObject,
} from "./xml.js";
import { ScoringFailure, type ScoringError } from "./types.js";

const RESULTS_NAMESPACE = "http://www.imsglobal.org/xsd/imsqti_result_v3p0";
const ITEM_NAMESPACE = "http://www.imsglobal.org/xsd/imsqti_v3p0";

type ApplyInput = {
  resultsXml: string;
  itemSourceXmls: string[];
  scoringInput: unknown;
  itemOrder: string[];
};

type ApplyOptions = {
  preserveMet?: boolean;
  onPreserveMetDowngrade?: (notice: PreserveMetDowngradeNotice) => void;
};

type PreserveMetDowngradeNotice = {
  itemIdentifier: string;
  rubricIndex: number;
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

type ParsedItemSource = {
  identifier: string;
  orderedRoot: OrderedElement;
  questionType: "choice" | "cloze" | "descriptive";
};

type OrderedElement = {
  name: string;
  attributes: XmlObject;
  children: OrderedNode[];
};

type OrderedNode = OrderedElement | { text: string };

export function applyScoringUpdates(
  input: ApplyInput,
  options: ApplyOptions = {},
): string {
  const preserveMet = Boolean(options.preserveMet);
  const onPreserveMetDowngrade = options.onPreserveMetDowngrade;
  const scoringItems = readScoringItems(input.scoringInput);
  const resultsDoc = parseXmlOrFail(
    input.resultsXml,
    "failed to parse results",
  );
  const assessmentResult = (resultsDoc as XmlObject).assessmentResult as
    | XmlObject
    | undefined;
  if (!assessmentResult) {
    fail("root element must be assessmentResult");
  }

  const resultNamespace = assessmentResult["@_xmlns"];
  if (!resultNamespace) {
    fail("missing results namespace", "/assessmentResult");
  }
  if (resultNamespace !== RESULTS_NAMESPACE) {
    fail(
      `unexpected results namespace: ${resultNamespace}`,
      "/assessmentResult",
    );
  }

  const itemResults = ensureArray(assessmentResult.itemResult);
  const itemResultByItemId = new Map<string, XmlObject>();

  const testResult = assessmentResult.testResult as XmlObject | undefined;
  if (!testResult) {
    fail("testResult not found", "/assessmentResult/testResult");
  }

  const itemSourceById = new Map<string, ParsedItemSource>();
  for (const itemSourceXml of input.itemSourceXmls) {
    const parsed = parseItemSource(itemSourceXml);
    if (itemSourceById.has(parsed.identifier)) {
      fail(`duplicate item identifier in sources: ${parsed.identifier}`);
    }
    itemSourceById.set(parsed.identifier, parsed);
  }

  const itemOrder = normalizeItemOrder(input.itemOrder, itemSourceById);
  const itemOrderSet = new Set(itemOrder);
  const itemResultBySequenceIndex = mapItemResultsBySequenceIndex(
    itemResults as XmlObject[],
    itemOrder.length,
  );
  for (const [
    sequenceIndex,
    itemResult,
  ] of itemResultBySequenceIndex.entries()) {
    const itemId = itemOrder[sequenceIndex - 1];
    if (itemResultByItemId.has(itemId)) {
      failResultItem(itemId, "duplicate item result for sequenceIndex");
    }
    itemResultByItemId.set(itemId, itemResult);
  }
  for (let index = 0; index < itemOrder.length; index += 1) {
    const itemId = itemOrder[index];
    if (!itemResultByItemId.has(itemId)) {
      failResultItem(
        `Q${index + 1}`,
        "itemResult missing for assessment test item",
      );
    }
  }

  const rubricCache = new Map<string, Rubric>();
  for (const item of scoringItems) {
    const identifier = item.identifier;
    if (!itemOrderSet.has(identifier)) {
      failItem(identifier, "assessment test missing item identifier");
    }
    const itemResult = itemResultByItemId.get(identifier);
    if (!itemResult) {
      failItem(identifier, "itemResult not found");
    }

    const hasCriteria = item.criteria !== undefined;
    const hasComment = item.comment !== undefined;

    if (!hasCriteria && !hasComment) {
      failItem(identifier, "criteria or comment required");
    }

    if (hasComment) {
      if (typeof item.comment !== "string") {
        failItem(identifier, "comment must be a string");
      }
    }

    const outcomes = ensureArray(itemResult.outcomeVariable) as XmlObject[];
    itemResult.outcomeVariable = outcomes;

    if (hasCriteria) {
      const itemSource = itemSourceById.get(identifier);
      if (!itemSource) {
        failItem(identifier, "scoring source not found");
      }

      if (itemSource.questionType === "choice") {
        // Objective auto-scored item (choice). The delivery system's
        // auto-score is authoritative, so preserve the existing SCORE and
        // RUBRIC_n_MET outcomes and ignore AI/manual criteria. A COMMENT, when
        // provided, is still applied below.
      } else {
        applyRubricScoring({
          identifier,
          itemSource,
          criteria: item.criteria,
          outcomes,
          rubricCache,
          preserveMet,
          onPreserveMetDowngrade,
          questionType: itemSource.questionType,
        });
      }
    }

    if (hasComment) {
      const commentValue = item.comment as string;
      if (commentValue.length === 0) {
        removeOutcomeVariable(outcomes, "COMMENT");
      } else {
        upsertOutcomeVariable(outcomes, "COMMENT", "string", commentValue);
      }
    }
  }

  const allScores = collectItemScores(itemResultByItemId.values());
  if (allScores.length > 0) {
    const testOutcomes = ensureArray(testResult.outcomeVariable) as XmlObject[];
    testResult.outcomeVariable = testOutcomes;

    const testScale = Math.max(...allScores.map((score) => score.scale));
    let testScoreScaled = 0;
    for (const score of allScores) {
      const multiplier = 10 ** (testScale - score.scale);
      testScoreScaled += score.scaled * multiplier;
    }

    upsertOutcomeVariable(
      testOutcomes,
      "SCORE",
      "float",
      formatScaled(testScoreScaled, testScale),
    );
  }

  return buildXml(resultsDoc);
}

type ApplyRubricScoringArgs = {
  identifier: string;
  itemSource: ParsedItemSource;
  criteria: unknown;
  outcomes: XmlObject[];
  rubricCache: Map<string, Rubric>;
  preserveMet: boolean;
  onPreserveMetDowngrade?: (notice: PreserveMetDowngradeNotice) => void;
  questionType: "choice" | "cloze" | "descriptive";
};

function applyRubricScoring(args: ApplyRubricScoringArgs): void {
  const {
    identifier,
    itemSource,
    criteria: rawCriteria,
    outcomes,
    rubricCache,
    preserveMet,
    onPreserveMetDowngrade,
    questionType,
  } = args;

  const item = { criteria: rawCriteria };
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

  const existingRubricMet =
    preserveMet || questionType === "cloze"
      ? extractExistingRubricMet(outcomes)
      : new Map<number, boolean>();

  let hasExistingScore = false;
  let existingScoreScaled = 0;
  const maxRubricScoreScaled = rubric.criteria.reduce(
    (sum, criterion) => sum + toScaledInt(criterion.points, rubric.scaleDigits),
    0,
  );

  if (questionType === "cloze") {
    const scoreOutcome = outcomes.find(
      (outcome) => outcome?.["@_identifier"] === "SCORE",
    );
    if (scoreOutcome) {
      const rawValue = getTextContent(
        (scoreOutcome as XmlObject).value as XmlNode,
      );
      const parsed = parseScoreValue(rawValue);
      if (parsed) {
        hasExistingScore = true;
        existingScoreScaled = toScaledInt(rawValue, rubric.scaleDigits);
      }
    }

    if (
      existingRubricMet.size === 0 &&
      hasExistingScore &&
      existingScoreScaled === maxRubricScoreScaled
    ) {
      for (let index = 0; index < rubric.criteria.length; index += 1) {
        existingRubricMet.set(index + 1, true);
      }
    }
  }

  let itemScoreScaled = 0;
  for (let index = 0; index < item.criteria.length; index += 1) {
    const criterion = item.criteria[index];
    const rubricCriterion = rubric.criteria[index];

    if (!criterion || typeof criterion !== "object") {
      failItem(identifier, `criterion must be an object at index ${index + 1}`);
    }

    const hasMet = Object.prototype.hasOwnProperty.call(
      criterion as XmlObject,
      "met",
    );
    const metValue = (criterion as XmlObject).met;
    if (hasMet && typeof metValue !== "boolean") {
      failItem(
        identifier,
        `criterion met must be boolean at index ${index + 1}`,
      );
    }

    if (
      "criterionText" in (criterion as XmlObject) &&
      (criterion as XmlObject).criterionText !== undefined
    ) {
      const criterionText = (criterion as XmlObject).criterionText;
      if (typeof criterionText !== "string") {
        failItem(
          identifier,
          `criterionText must be string at index ${index + 1}`,
        );
      }
      const expectedNormalized = normalizeCriterionText(rubricCriterion.text);
      const actualNormalized = normalizeCriterionText(criterionText);
      if (expectedNormalized !== actualNormalized) {
        const expectedText = JSON.stringify(rubricCriterion.text);
        const actualText = JSON.stringify(criterionText);
        const normalizedExpected = JSON.stringify(expectedNormalized);
        const normalizedActual = JSON.stringify(actualNormalized);
        failItem(
          identifier,
          `criterionText does not match rubric criterion at index ${index + 1} (expected: ${expectedText}, got: ${actualText}, normalized expected: ${normalizedExpected}, normalized got: ${normalizedActual})`,
        );
      }
    }

    const existingMet = existingRubricMet.get(index + 1);
    const requestedMet = hasMet ? (metValue as boolean) : undefined;
    
    let finalMet: boolean | undefined;
    let preserveDowngrade = false;

    if (questionType === "cloze") {
      // Cloze OR-invariance: finalMet = existingMet === true || requestedMet === true;
      // This is unconditional and does not depend on preserveMet.
      if (hasMet) {
        if (existingMet === undefined && requestedMet === false) {
          finalMet = undefined;
        } else {
          finalMet = existingMet === true || requestedMet === true;
        }
      } else {
        finalMet = existingMet;
      }
    } else {
      // Descriptive
      preserveDowngrade = preserveMet && existingMet === true && requestedMet === false;
      finalMet = hasMet
        ? preserveDowngrade
          ? true
          : requestedMet
        : existingMet;
    }

    if (preserveDowngrade) {
      onPreserveMetDowngrade?.({
        itemIdentifier: identifier,
        rubricIndex: index + 1,
      });
    }

    if (finalMet === true) {
      itemScoreScaled += toScaledInt(
        rubricCriterion.points,
        rubric.scaleDigits,
      );
    }

    if (hasMet && finalMet !== undefined) {
      upsertOutcomeVariable(
        outcomes,
        `RUBRIC_${index + 1}_MET`,
        "boolean",
        finalMet === true ? "true" : "false",
      );
    }
  }

  if (questionType === "cloze") {
    // Cloze items must never decrease in score.
    // If the existing score is higher than the newly computed score, we clamp it.
    // This handles the case where SCORE=3 exists but no RUBRIC_*_MET outcomes are present,
    // as well as preventing any score decrease from criteria updates.
    // We write the RUBRIC_n_MET outcomes based on the OR-invariance above, but keep the SCORE clamped.
    if (existingScoreScaled > itemScoreScaled) {
      itemScoreScaled = existingScoreScaled;
    }
  }

  upsertOutcomeVariable(
    outcomes,
    "SCORE",
    "float",
    formatScaled(itemScoreScaled, rubric.scaleDigits),
  );
}

function readScoringItems(
  scoringInput: unknown,
): Array<{ identifier: string; criteria: unknown; comment?: unknown }> {
  if (
    !scoringInput ||
    typeof scoringInput !== "object" ||
    Array.isArray(scoringInput)
  ) {
    fail("scoring input must be an object", "/scoring");
  }
  const items = (scoringInput as XmlObject).items;
  if (!Array.isArray(items) || items.length === 0) {
    fail("scoring input items missing or empty", "/scoring/items");
  }

  return items.map((item, index) => {
    if (!item || typeof item !== "object") {
      fail(
        `scoring item must be an object at index ${index + 1}`,
        "/scoring/items",
      );
    }
    const identifier = (item as XmlObject).identifier;
    if (typeof identifier !== "string" || identifier.length === 0) {
      fail(
        "missing item identifier in scoring input",
        "/assessmentResult/itemResult",
      );
    }
    return {
      identifier,
      criteria: (item as XmlObject).criteria,
      comment: (item as XmlObject).comment,
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

function parseItemSource(xml: string): ParsedItemSource {
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
  const orderedRoot = parseOrderedItemSource(xml);
  return { identifier, orderedRoot, questionType: detectQuestionType(orderedRoot, root) };
}

function detectQuestionType(orderedRoot: OrderedElement, root: XmlObject): "choice" | "cloze" | "descriptive" {
  const itemBody = findOrderedChildren(orderedRoot, "qti-item-body")[0];
  let hasChoice = false;
  let hasCloze = false;

  if (itemBody) {
    const walk = (node: OrderedNode) => {
      if ("name" in node) {
        if (node.name === "qti-choice-interaction") {
          hasChoice = true;
        } else if (node.name === "qti-text-entry-interaction") {
          hasCloze = true;
        }
        for (const child of node.children) {
          walk(child);
        }
      }
    };
    walk(itemBody);
  }

  if (hasChoice) {
    return "choice";
  }
  if (hasCloze) {
    return "cloze";
  }

  // Defensive fallback for choice items only
  if (detectAutoScored(root)) {
    return "choice";
  }

  return "descriptive";
}

// An item is objectively auto-scored when its response declaration carries a
// qti-correct-response (choice / cloze). Such items are scored deterministically
// by the delivery system; their SCORE / RUBRIC_n_MET must not be overwritten by
// AI/manual rubric criteria. Descriptive items have no correct-response and are
// graded via the scorer rubric.
function detectAutoScored(root: XmlObject): boolean {
  const declarations = ensureArray<XmlNode>(
    root["qti-response-declaration"] as XmlNode,
  );
  return declarations.some(
    (declaration) =>
      isRecord(declaration) && "qti-correct-response" in declaration,
  );
}

function parseOrderedItemSource(xml: string): OrderedElement {
  let parsed: unknown;
  try {
    parsed = parseXmlPreserveOrder(xml);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(`failed to parse item source: ${message}`);
  }

  const root = toOrderedNodes(parsed).find(
    (node): node is OrderedElement =>
      "name" in node && node.name === "qti-assessment-item",
  );
  if (!root) {
    fail("root element must be qti-assessment-item");
  }
  return root;
}

function extractRubric(source: ParsedItemSource, identifier: string): Rubric {
  const itemBody = findOrderedChildren(source.orderedRoot, "qti-item-body")[0];
  if (!itemBody) {
    failItem(identifier, "scorer rubric not found");
  }

  const scorerBlock = findOrderedChildren(itemBody, "qti-rubric-block").find(
    (block) => block.attributes["@_view"] === "scorer",
  );
  if (!scorerBlock) {
    failItem(identifier, "scorer rubric not found");
  }

  const paragraphs = findOrderedChildren(scorerBlock, "p");
  if (paragraphs.length === 0) {
    failItem(identifier, "scorer rubric not found");
  }

  const criteria: RubricCriterion[] = [];
  let scaleDigits = 0;

  for (let index = 0; index < paragraphs.length; index += 1) {
    const text = getOrderedTextContent(paragraphs[index]);
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

function findOrderedChildren(
  element: OrderedElement,
  name: string,
): OrderedElement[] {
  return element.children.filter(
    (child): child is OrderedElement => "name" in child && child.name === name,
  );
}

function getOrderedTextContent(node: OrderedNode): string {
  if ("text" in node) {
    return node.text;
  }
  return node.children.map((child) => getOrderedTextContent(child)).join(" ");
}

function toOrderedNodes(value: unknown): OrderedNode[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const node = toOrderedNode(entry);
    return node === undefined ? [] : [node];
  });
}

function toOrderedNode(entry: unknown): OrderedNode | undefined {
  if (!isRecord(entry)) {
    return undefined;
  }
  if ("#text" in entry) {
    return { text: String(entry["#text"] ?? "") };
  }
  const elementName = Object.keys(entry).find(
    (key) => key !== ":@" && key !== "#text" && !key.startsWith("?"),
  );
  if (elementName === undefined) {
    return undefined;
  }
  const attributes = isRecord(entry[":@"]) ? entry[":@"] : {};
  return {
    name: elementName,
    attributes,
    children: toOrderedNodes(entry[elementName]),
  };
}

function isRecord(value: unknown): value is XmlObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getTextContent(node: XmlNode): string {
  if (node === undefined || node === null) {
    return "";
  }
  if (
    typeof node === "string" ||
    typeof node === "number" ||
    typeof node === "boolean"
  ) {
    return String(node);
  }
  if (typeof node === "object") {
    const objectNode = node as XmlObject;
    const ownText =
      "#text" in objectNode ? String(objectNode["#text"] ?? "") : "";
    const childText = Object.entries(objectNode)
      .filter(([key]) => key !== "#text" && !key.startsWith("@_"))
      .flatMap(([, value]) => ensureArray<XmlNode>(value as XmlNode))
      .map((value) => getTextContent(value))
      .filter((value) => value.length > 0);

    if (childText.length === 0) {
      return ownText;
    }
    return [ownText, ...childText]
      .filter((value) => value.length > 0)
      .join(" ");
  }
  return "";
}

function collectItemScores(
  itemResults: Iterable<XmlObject>,
): Array<{ scaled: number; scale: number }> {
  const scores: Array<{ scaled: number; scale: number }> = [];
  for (const itemResult of itemResults) {
    const outcomes = ensureArray(itemResult.outcomeVariable) as XmlObject[];
    const outcome = outcomes.find(
      (candidate) => candidate?.["@_identifier"] === "SCORE",
    );
    if (!outcome) {
      continue;
    }
    const rawValue = getTextContent((outcome as XmlObject).value as XmlNode);
    const parsed = parseScoreValue(rawValue);
    if (parsed) {
      scores.push(parsed);
    }
  }
  return scores;
}

function parseScoreValue(
  rawValue: string,
): { scaled: number; scale: number } | null {
  if (!rawValue) {
    return null;
  }
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const scale = decimalPlaces(rawValue);
  return { scaled: toScaledInt(rawValue, scale), scale };
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
    const rawValue = getTextContent((outcome as XmlObject).value as XmlNode);
    if (rawValue === "true") {
      result.set(index, true);
    } else if (rawValue === "false") {
      result.set(index, false);
    }
  }
  return result;
}

function normalizeItemOrder(
  itemOrder: string[],
  itemSourceById: Map<string, ParsedItemSource>,
): string[] {
  if (!Array.isArray(itemOrder) || itemOrder.length === 0) {
    failAssessmentTest("assessment test has no item refs");
  }
  const seen = new Set<string>();
  for (const identifier of itemOrder) {
    if (!identifier) {
      failAssessmentTest("assessment test item identifier missing");
    }
    if (seen.has(identifier)) {
      failAssessmentTest(
        `duplicate item identifier in assessment test: ${identifier}`,
      );
    }
    if (!itemSourceById.has(identifier)) {
      failAssessmentTest(
        `item identifier not found in item sources: ${identifier}`,
        identifier,
      );
    }
    seen.add(identifier);
  }
  return itemOrder;
}

function mapItemResultsBySequenceIndex(
  itemResults: XmlObject[],
  maxSequenceIndex: number,
): Map<number, XmlObject> {
  const map = new Map<number, XmlObject>();
  for (const itemResult of itemResults) {
    const raw = itemResult?.["@_sequenceIndex"];
    if (raw === undefined || raw === null || raw === "") {
      failResultItem(
        String(itemResult?.["@_identifier"] ?? ""),
        "sequenceIndex is required",
      );
    }
    const sequenceIndex = Number(raw);
    if (!Number.isInteger(sequenceIndex) || sequenceIndex < 1) {
      failResultItem(
        String(itemResult?.["@_identifier"] ?? ""),
        "sequenceIndex must be a positive integer",
      );
    }
    if (sequenceIndex > maxSequenceIndex) {
      failResultItem(
        String(itemResult?.["@_identifier"] ?? ""),
        "sequenceIndex exceeds assessment test item count",
      );
    }
    if (map.has(sequenceIndex)) {
      failResultItem(
        String(itemResult?.["@_identifier"] ?? ""),
        "duplicate sequenceIndex in results",
      );
    }
    map.set(sequenceIndex, itemResult);
  }
  return map;
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

function normalizeCriterionText(text: string): string {
  return text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[\p{P}\p{S}]/gu, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function upsertOutcomeVariable(
  outcomes: XmlObject[],
  identifier: string,
  baseType: string,
  value: string,
): void {
  const index = outcomes.findIndex(
    (outcome) => outcome?.["@_identifier"] === identifier,
  );
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

function removeOutcomeVariable(
  outcomes: XmlObject[],
  identifier: string,
): void {
  const index = outcomes.findIndex(
    (outcome) => outcome?.["@_identifier"] === identifier,
  );
  if (index >= 0) {
    outcomes.splice(index, 1);
  }
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
  fail(
    reason,
    `/assessmentResult/itemResult[@identifier='${identifier}']`,
    identifier,
  );
}

function failResultItem(identifier: string, reason: string): never {
  fail(
    reason,
    `/assessmentResult/itemResult[@identifier='${identifier}']`,
    identifier,
  );
}

function failAssessmentTest(reason: string, identifier?: string): never {
  fail(reason, "/assessmentTest", identifier);
}
