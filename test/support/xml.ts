import { XMLBuilder, XMLParser } from "fast-xml-parser";

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

export type XmlObject = Record<string, unknown>;

export function parseXml(xml: string): XmlObject {
  return parser.parse(xml) as XmlObject;
}

export function buildXml(obj: XmlObject): string {
  return builder.build(obj) as string;
}

export function normalizeXml(xml: string): XmlObject {
  return parseXml(xml);
}
