import { buildXml, parseXml, type XmlObject } from "./xml.ts";

export type ScoringError = {
  path: string;
  identifier?: string;
  reason: string;
};

type ScoringInput = {
  assessmentIdentifier?: string;
  candidateIdentifier?: string;
  items: Array<{
    identifier: string;
    criteria: Array<{
      met: boolean;
      criterionText?: string;
    }>;
  }>;
};

type RubricCriterion = {
  points: number;
  text: string;
};

type ItemRubric = {
  identifier: string;
  criteria: RubricCriterion[] | null;
};

const RUBRIC_LINE_REGEX = /^\s*\[(?<points>-?\d+(?:\.\d+)?)\]\s*(?<text>.+?)\s*$/;

export function applyScoringUpdate(params: {
  resultsXml: string;
  itemXmlList: string[];
  scoringJson: string;
}): string | ScoringError {
  const scoring = parseScoringInput(params.scoringJson);
  const rubricMap = parseItemRubrics(params.itemXmlList);

  const resultsDoc = parseXml(params.resultsXml);
  const rootKey = getRootKey(resultsDoc, "assessmentResult");
  if (!rootKey) {
    return error("/", undefined, "root element must be assessmentResult");
  }

  const assessmentResult = resultsDoc[rootKey] as XmlObject;
  const itemResults = toArray(assessmentResult["itemResult"] as XmlObject | XmlObject[] | undefined);
  if (itemResults.length === 0) {
    return error("/assessmentResult", undefined, "itemResult not found");
  }

  const itemScoreMap = new Map<string, number>();

  for (const itemInput of scoring.items) {
    const itemIdentifier = itemInput.identifier;
    const rubric = rubricMap.get(itemIdentifier);
    if (!rubric || rubric.criteria === null) {
      return error(
        `/assessmentResult/itemResult[@identifier='${itemIdentifier}']`,
        itemIdentifier,
        "scorer rubric not found"
      );
    }

    const itemResult = itemResults.find(
      (entry) => getAttribute(entry, "identifier") === itemIdentifier
    );
    if (!itemResult) {
      return error(
        `/assessmentResult/itemResult[@identifier='${itemIdentifier}']`,
        itemIdentifier,
        "itemResult not found"
      );
    }

    if (itemInput.criteria.length !== rubric.criteria.length) {
      return error(
        `/assessmentResult/itemResult[@identifier='${itemIdentifier}']`,
        itemIdentifier,
        `criteria length (${itemInput.criteria.length}) does not match rubric criteria count (${rubric.criteria.length})`
      );
    }

    for (let index = 0; index < itemInput.criteria.length; index += 1) {
      const criterion = itemInput.criteria[index];
      const rubricCriterion = rubric.criteria[index];
      if (criterion.criterionText && criterion.criterionText !== rubricCriterion.text) {
        return error(
          `/assessmentResult/itemResult[@identifier='${itemIdentifier}']`,
          itemIdentifier,
          `criterionText does not match rubric criterion at index ${index + 1}`
        );
      }
    }

    const score = itemInput.criteria.reduce((sum, criterion, index) => {
      if (!criterion.met) {
        return sum;
      }
      return sum + rubric.criteria[index].points;
    }, 0);

    itemScoreMap.set(itemIdentifier, score);
  }

  const updatedItemResults: XmlObject[] = itemResults.map((itemResult) => {
    const identifier = getAttribute(itemResult, "identifier");
    if (!identifier) {
      return itemResult;
    }

    const score = itemScoreMap.get(identifier);
    if (score === undefined) {
      return itemResult;
    }

    const outcomeVariables = ensureArray(itemResult, "outcomeVariable");

    const scoreVariable = findOutcomeVariable(outcomeVariables, "SCORE");
    if (scoreVariable) {
      setOutcomeValue(scoreVariable, score.toString(), "float");
    } else {
      outcomeVariables.push(makeOutcomeVariable("SCORE", "float", score.toString()));
    }

    const rubric = rubricMap.get(identifier);
    if (!rubric) {
      return itemResult;
    }

    if (!rubric || rubric.criteria === null) {
      return itemResult;
    }

    for (let index = 0; index < rubric.criteria.length; index += 1) {
      const rubricId = `RUBRIC_${index + 1}_MET`;
      const met = itemInputMet(scoring, identifier, index);
      const existing = findOutcomeVariable(outcomeVariables, rubricId);
      if (existing) {
        setOutcomeValue(existing, met ? "true" : "false", "boolean");
      } else {
        outcomeVariables.push(makeOutcomeVariable(rubricId, "boolean", met ? "true" : "false"));
      }
    }

    itemResult["outcomeVariable"] = outcomeVariables;
    return itemResult;
  });

  assessmentResult["itemResult"] = normalizeArray(updatedItemResults);

  const totalScore = Array.from(itemScoreMap.values()).reduce((sum, value) => sum + value, 0);
  const testResult = assessmentResult["testResult"] as XmlObject | XmlObject[] | undefined;
  if (testResult) {
    const testResultNode = Array.isArray(testResult) ? testResult[0] : testResult;
    const outcomeVariables = ensureArray(testResultNode, "outcomeVariable");
    const scoreVariable = findOutcomeVariable(outcomeVariables, "SCORE");
    if (scoreVariable) {
      setOutcomeValue(scoreVariable, totalScore.toString(), "float");
    } else {
      outcomeVariables.push(makeOutcomeVariable("SCORE", "float", totalScore.toString()));
    }
    testResultNode["outcomeVariable"] = outcomeVariables;
    assessmentResult["testResult"] = testResultNode;
  }

  resultsDoc[rootKey] = assessmentResult;
  return buildXml(resultsDoc);
}

function parseScoringInput(jsonText: string): ScoringInput {
  const data = JSON.parse(jsonText) as ScoringInput;
  if (!data.items || !Array.isArray(data.items)) {
    throw new Error("Invalid scoring input: items is required");
  }
  return data;
}

function parseItemRubrics(itemXmlList: string[]): Map<string, ItemRubric> {
  const rubricMap = new Map<string, ItemRubric>();

  for (const xml of itemXmlList) {
    const doc = parseXml(xml);
    const rootKey = getRootKey(doc, "qti-assessment-item");
    if (!rootKey) {
      throw new Error("Item source root element must be qti-assessment-item");
    }
    const root = doc[rootKey] as XmlObject;
    const identifier = getAttribute(root, "identifier");
    if (!identifier) {
      throw new Error("Item source is missing identifier");
    }
    if (rubricMap.has(identifier)) {
      throw new Error(`Duplicate item source identifier: ${identifier}`);
    }

    const itemBody = root["qti-item-body"] as XmlObject | undefined;
    if (!itemBody) {
      rubricMap.set(identifier, { identifier, criteria: null });
      continue;
    }

    const rubricBlocks = toArray(itemBody["qti-rubric-block"] as XmlObject | XmlObject[] | undefined);
    const scorerBlock = rubricBlocks.find((block) => getAttribute(block, "view") === "scorer");
    if (!scorerBlock) {
      rubricMap.set(identifier, { identifier, criteria: null });
      continue;
    }

    const rubricEntries = toArray(scorerBlock["qti-p"] as XmlObject | XmlObject[] | string | undefined);
    const criteria = rubricEntries.map((entry) => {
      const text = getText(entry);
      const match = RUBRIC_LINE_REGEX.exec(text);
      if (!match || !match.groups) {
        throw new Error(`Invalid rubric line format: ${text}`);
      }
      const points = Number(match.groups.points);
      if (Number.isNaN(points)) {
        throw new Error(`Invalid rubric points: ${match.groups.points}`);
      }
      return {
        points,
        text: match.groups.text,
      } as RubricCriterion;
    });

    rubricMap.set(identifier, { identifier, criteria });
  }

  return rubricMap;
}

function getRootKey(doc: XmlObject, expectedName: string): string | null {
  const keys = Object.keys(doc).filter((key) => key !== "?xml");
  if (keys.length !== 1) {
    return null;
  }
  const rootKey = keys[0];
  if (rootKey !== expectedName) {
    return null;
  }
  return rootKey;
}

function getAttribute(node: XmlObject, name: string): string | undefined {
  return node[`@_${name}`] as string | undefined;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function ensureArray(node: XmlObject, key: string): XmlObject[] {
  const current = toArray(node[key] as XmlObject | XmlObject[] | undefined);
  return [...current];
}

function normalizeArray(values: XmlObject[]): XmlObject | XmlObject[] {
  if (values.length === 1) {
    return values[0];
  }
  return values;
}

function findOutcomeVariable(variables: XmlObject[], identifier: string): XmlObject | undefined {
  return variables.find((variable) => getAttribute(variable, "identifier") === identifier);
}

function setOutcomeValue(variable: XmlObject, value: string, baseType: string): void {
  variable["@_baseType"] = baseType;
  variable["value"] = value;
}

function makeOutcomeVariable(identifier: string, baseType: string, value: string): XmlObject {
  return {
    "@_identifier": identifier,
    "@_baseType": baseType,
    value,
  };
}

function itemInputMet(scoring: ScoringInput, identifier: string, index: number): boolean {
  const item = scoring.items.find((entry) => entry.identifier === identifier);
  if (!item) {
    return false;
  }
  return Boolean(item.criteria[index]?.met);
}

function error(path: string, identifier: string | undefined, reason: string): ScoringError {
  return {
    path,
    identifier,
    reason,
  };
}

function getText(entry: XmlObject | string | undefined): string {
  if (!entry) {
    return "";
  }
  if (typeof entry === "string") {
    return entry;
  }
  const text = entry["#text"];
  if (typeof text === "string") {
    return text;
  }
  return "";
}
