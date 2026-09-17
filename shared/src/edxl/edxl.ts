import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { z } from "zod";

/**
 * EDXL-DE 1.0 distribution envelope and EDXL-RM 1.0 resource messaging
 * (VEOC-27, F20/INV-4), bound to the ICS-213RR lifecycle. A resource
 * request leaves the platform as an EDXL-RM message wrapped in an EDXL-DE
 * envelope and re-enters another instance without loss; the DE routing
 * metadata (explicit addresses) governs who may consume it.
 *
 * 213RR ↔ EDXL-RM field mapping (documented, and bijective for these):
 *   item      ↔ resourceInformation.resource.name
 *   notes     ↔ resourceInformation.resource.description
 *   quantity  ↔ resourceInformation.assignmentInformation.quantity.amount
 *   priority  ↔ resourceInformation.assignmentInformation.priorityLevel
 *   needed_by ↔ resourceInformation.scheduleInformation[RequestedArrival].dateTime
 *   state     ↔ resourceInformation.resource.keyword[urn:openeoc:rr:state]
 */

export const DE_NS = "urn:oasis:names:tc:emergency:EDXL:DE:1.0";
export const RM_NS = "urn:oasis:names:tc:emergency:EDXL:RM:1.0";
const RR_STATE_URN = "urn:openeoc:rr:state";

const NamedValue = z.object({ valueListUrn: z.string(), value: z.string() });
const ExplicitAddress = z.object({
  explicitAddressScheme: z.string(),
  explicitAddressValue: z.string(),
});

export const ResourceMessageSchema = z.object({
  messageID: z.string().min(1),
  sentDateTime: z.string().min(1),
  messageContentType: z.string().min(1),
  originatingMessageID: z.string().optional(),
  incidentID: z.string().optional(),
  resource: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    keyword: z.array(NamedValue).optional(),
  }),
  assignmentInformation: z
    .object({
      quantityAmount: z.string().optional(),
      quantityUnits: z.string().optional(),
      priorityLevel: z.string().optional(),
    })
    .optional(),
  scheduleInformation: z
    .array(z.object({ scheduleType: z.string(), dateTime: z.string() }))
    .optional(),
});
export type ResourceMessage = z.infer<typeof ResourceMessageSchema>;

export const DistributionSchema = z.object({
  distributionID: z.string().min(1),
  senderID: z.string().min(1),
  dateTimeSent: z.string().min(1),
  distributionStatus: z.string().min(1),
  distributionType: z.string().min(1),
  combinedConfidentiality: z.string().optional(),
  explicitAddress: z.array(ExplicitAddress).optional(),
  content: ResourceMessageSchema,
});
export type Distribution = z.infer<typeof DistributionSchema>;

/** A 213RR resource-request board record's fields. */
export interface ResourceRequest {
  readonly item: string;
  readonly quantity: number;
  readonly priority?: string | undefined;
  readonly state?: string | undefined;
  readonly needed_by?: string | undefined;
  readonly notes?: string | undefined;
}

function drop<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

/** Map a 213RR record to an EDXL-RM RequestResource message. */
export function resourceRequestToRm(
  rr: ResourceRequest,
  meta: { messageID: string; sentDateTime: string; incidentID?: string | undefined },
): ResourceMessage {
  return ResourceMessageSchema.parse(
    drop({
      messageID: meta.messageID,
      sentDateTime: meta.sentDateTime,
      messageContentType: "RequestResource",
      incidentID: meta.incidentID,
      resource: drop({
        name: rr.item,
        description: rr.notes,
        keyword: rr.state
          ? [{ valueListUrn: RR_STATE_URN, value: rr.state }]
          : undefined,
      }),
      assignmentInformation: drop({
        quantityAmount: String(rr.quantity),
        quantityUnits: "each",
        priorityLevel: rr.priority,
      }),
      scheduleInformation: rr.needed_by
        ? [{ scheduleType: "RequestedArrival", dateTime: rr.needed_by }]
        : undefined,
    }),
  );
}

/** Map an EDXL-RM message back to a 213RR record's fields (no loss). */
export function rmToResourceRequest(rm: ResourceMessage): ResourceRequest {
  const state = (rm.resource.keyword ?? []).find((k) => k.valueListUrn === RR_STATE_URN)?.value;
  const arrival = (rm.scheduleInformation ?? []).find((s) => s.scheduleType === "RequestedArrival");
  const amount = rm.assignmentInformation?.quantityAmount;
  return {
    item: rm.resource.name,
    quantity: amount !== undefined ? Number(amount) : 0,
    priority: rm.assignmentInformation?.priorityLevel,
    state,
    needed_by: arrival?.dateTime,
    notes: rm.resource.description,
  };
}

function rmNode(rm: ResourceMessage): Record<string, unknown> {
  return drop({
    "@_xmlns": RM_NS,
    messageID: rm.messageID,
    sentDateTime: rm.sentDateTime,
    messageContentType: rm.messageContentType,
    originatingMessageID: rm.originatingMessageID,
    incidentInformation: rm.incidentID ? { incidentID: rm.incidentID } : undefined,
    resourceInformation: drop({
      resource: drop({
        name: rm.resource.name,
        description: rm.resource.description,
        keyword: rm.resource.keyword?.map((k) => ({ valueListUrn: k.valueListUrn, value: k.value })),
      }),
      assignmentInformation: rm.assignmentInformation
        ? drop({
            quantity: rm.assignmentInformation.quantityAmount
              ? {
                  measuredQuantity: drop({
                    amount: rm.assignmentInformation.quantityAmount,
                    unitOfMeasure: rm.assignmentInformation.quantityUnits,
                  }),
                }
              : undefined,
            priorityLevel: rm.assignmentInformation.priorityLevel,
          })
        : undefined,
      scheduleInformation: rm.scheduleInformation?.map((s) => ({
        scheduleType: s.scheduleType,
        dateTime: s.dateTime,
      })),
    }),
  });
}

export function distributionToXml(de: Distribution): string {
  const tree = {
    EDXLDistribution: drop({
      "@_xmlns": DE_NS,
      distributionID: de.distributionID,
      senderID: de.senderID,
      dateTimeSent: de.dateTimeSent,
      distributionStatus: de.distributionStatus,
      distributionType: de.distributionType,
      combinedConfidentiality: de.combinedConfidentiality,
      explicitAddress: de.explicitAddress?.map((a) => ({
        explicitAddressScheme: a.explicitAddressScheme,
        explicitAddressValue: a.explicitAddressValue,
      })),
      contentObject: {
        xmlContent: { embeddedXMLContent: { ResourceMessage: rmNode(de.content) } },
      },
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

const ARRAYS = new Set(["explicitAddress", "keyword", "scheduleInformation"]);

export function distributionFromXml(xml: string): Distribution {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: true,
    isArray: (name) => ARRAYS.has(name),
  });
  const doc = parser.parse(xml) as { EDXLDistribution?: Record<string, unknown> };
  const de = doc.EDXLDistribution;
  if (!de) throw new Error("not an EDXL-DE document");
  const rmXml = (
    ((de.contentObject as Record<string, unknown>)?.xmlContent as Record<string, unknown>)
      ?.embeddedXMLContent as Record<string, unknown>
  )?.ResourceMessage as Record<string, unknown> | undefined;
  if (!rmXml) throw new Error("EDXL-DE carries no EDXL-RM content");
  const ri = rmXml.resourceInformation as Record<string, unknown>;
  const resource = ri.resource as Record<string, unknown>;
  const ai = ri.assignmentInformation as Record<string, unknown> | undefined;
  const mq = (ai?.quantity as Record<string, unknown> | undefined)?.measuredQuantity as
    | Record<string, unknown>
    | undefined;
  const content = ResourceMessageSchema.parse(
    drop({
      messageID: rmXml.messageID as string,
      sentDateTime: rmXml.sentDateTime as string,
      messageContentType: rmXml.messageContentType as string,
      originatingMessageID: rmXml.originatingMessageID as string | undefined,
      incidentID: (rmXml.incidentInformation as Record<string, unknown> | undefined)?.incidentID as
        | string
        | undefined,
      resource: drop({
        name: resource.name as string,
        description: resource.description as string | undefined,
        keyword: resource.keyword as { valueListUrn: string; value: string }[] | undefined,
      }),
      assignmentInformation: ai
        ? drop({
            quantityAmount: mq?.amount as string | undefined,
            quantityUnits: mq?.unitOfMeasure as string | undefined,
            priorityLevel: ai.priorityLevel as string | undefined,
          })
        : undefined,
      scheduleInformation: ri.scheduleInformation as
        | { scheduleType: string; dateTime: string }[]
        | undefined,
    }),
  );
  return DistributionSchema.parse(
    drop({
      distributionID: de.distributionID as string,
      senderID: de.senderID as string,
      dateTimeSent: de.dateTimeSent as string,
      distributionStatus: de.distributionStatus as string,
      distributionType: de.distributionType as string,
      combinedConfidentiality: de.combinedConfidentiality as string | undefined,
      explicitAddress: de.explicitAddress as
        | { explicitAddressScheme: string; explicitAddressValue: string }[]
        | undefined,
      content,
    }),
  );
}

/**
 * Whether an instance addressed as `address` may consume this envelope.
 * With no explicit addresses the envelope is a broadcast; with them, only
 * a listed recipient may import it.
 */
export function addressedTo(de: Distribution, address: string): boolean {
  const list = de.explicitAddress ?? [];
  if (list.length === 0) return true;
  return list.some((a) => a.explicitAddressValue === address);
}
