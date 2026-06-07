import { XMLBuilder, XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

const orderPreservingParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  preserveOrder: true,
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

export function parseXmlPreserveOrder(xml: string): unknown {
  return orderPreservingParser.parse(xml) as unknown;
}

export function buildXml(obj: XmlObject): string {
  return builder.build(obj) as string;
}
