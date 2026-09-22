import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { CAP_NS, CapAlertSchema, type CapAlert, type CapArea, type CapInfo } from "./model.js";

/**
 * CAP 1.2 XML serialization and parsing. Full fidelity: an
 * alert authored in the model round-trips to CAP XML and back with every
 * element preserved, so an ingested external alert renders exactly and an
 * authored alert is byte-faithful to the standard's structure.
 */

const REPEATABLE = new Set([
  "code", "info", "category", "responseType", "eventCode", "parameter",
  "area", "polygon", "circle", "geocode",
]);

interface NamedValue {
  valueName: string;
  value: string;
}

function nv(list: readonly NamedValue[] | undefined): NamedValue[] | undefined {
  return list && list.length ? list.map((n) => ({ valueName: n.valueName, value: n.value })) : undefined;
}

function drop<T extends Record<string, unknown>>(obj: T): T {
  for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k];
  return obj;
}

function areaNode(a: CapArea): Record<string, unknown> {
  return drop({
    areaDesc: a.areaDesc,
    polygon: a.polygon && a.polygon.length ? a.polygon : undefined,
    circle: a.circle && a.circle.length ? a.circle : undefined,
    geocode: nv(a.geocode),
    altitude: a.altitude,
    ceiling: a.ceiling,
  });
}

function infoNode(i: CapInfo): Record<string, unknown> {
  return drop({
    language: i.language,
    category: i.category,
    event: i.event,
    responseType: i.responseType && i.responseType.length ? i.responseType : undefined,
    urgency: i.urgency,
    severity: i.severity,
    certainty: i.certainty,
    audience: i.audience,
    eventCode: nv(i.eventCode),
    effective: i.effective,
    onset: i.onset,
    expires: i.expires,
    senderName: i.senderName,
    headline: i.headline,
    description: i.description,
    instruction: i.instruction,
    web: i.web,
    contact: i.contact,
    parameter: nv(i.parameter),
    area: i.area && i.area.length ? i.area.map(areaNode) : undefined,
  });
}

export function capToXml(alert: CapAlert): string {
  const tree = {
    alert: drop({
      "@_xmlns": CAP_NS,
      identifier: alert.identifier,
      sender: alert.sender,
      sent: alert.sent,
      status: alert.status,
      msgType: alert.msgType,
      source: alert.source,
      scope: alert.scope,
      restriction: alert.restriction,
      addresses: alert.addresses,
      code: alert.code && alert.code.length ? alert.code : undefined,
      note: alert.note,
      references: alert.references,
      incidents: alert.incidents,
      info: alert.info.map(infoNode),
    }),
  };
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    format: true,
    suppressEmptyNode: true,
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(tree)}`;
}

export function capFromXml(xml: string): CapAlert {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: true,
    isArray: (name) => REPEATABLE.has(name),
  });
  const doc = parser.parse(xml) as { alert?: Record<string, unknown> };
  if (!doc.alert) throw new Error("not a CAP alert document");
  const a = doc.alert;
  const infos = ((a.info as Record<string, unknown>[] | undefined) ?? []).map((i) =>
    drop({
      language: (i.language as string) ?? "en-US",
      category: i.category as string[],
      event: i.event as string,
      responseType: i.responseType as string[] | undefined,
      urgency: i.urgency as string,
      severity: i.severity as string,
      certainty: i.certainty as string,
      audience: i.audience as string | undefined,
      eventCode: i.eventCode as NamedValue[] | undefined,
      effective: i.effective as string | undefined,
      onset: i.onset as string | undefined,
      expires: i.expires as string | undefined,
      senderName: i.senderName as string | undefined,
      headline: i.headline as string | undefined,
      description: i.description as string | undefined,
      instruction: i.instruction as string | undefined,
      web: i.web as string | undefined,
      contact: i.contact as string | undefined,
      parameter: i.parameter as NamedValue[] | undefined,
      area: (i.area as Record<string, unknown>[] | undefined)?.map((ar) =>
        drop({
          areaDesc: ar.areaDesc as string,
          polygon: ar.polygon as string[] | undefined,
          circle: ar.circle as string[] | undefined,
          geocode: ar.geocode as NamedValue[] | undefined,
          altitude: ar.altitude as string | undefined,
          ceiling: ar.ceiling as string | undefined,
        }),
      ),
    }),
  );
  return CapAlertSchema.parse(
    drop({
      identifier: a.identifier as string,
      sender: a.sender as string,
      sent: a.sent as string,
      status: a.status as string,
      msgType: a.msgType as string,
      source: a.source as string | undefined,
      scope: a.scope as string,
      restriction: a.restriction as string | undefined,
      addresses: a.addresses as string | undefined,
      code: a.code as string[] | undefined,
      note: a.note as string | undefined,
      references: a.references as string | undefined,
      incidents: a.incidents as string | undefined,
      info: infos,
    }),
  );
}
