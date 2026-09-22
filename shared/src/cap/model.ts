import { z } from "zod";

/**
 * CAP v1.2 alert model (F20/INV-4). OASIS Common Alerting
 * Protocol 1.2 (urn:oasis:names:tc:emergency:cap:1.2). The shape mirrors
 * the standard so an authored alert round-trips to XML with full fidelity
 * and validates against both the base schema and the IPAWS profile.
 */

export const CAP_NS = "urn:oasis:names:tc:emergency:cap:1.2";

export const CAP_STATUS = ["Actual", "Exercise", "System", "Test", "Draft"] as const;
export const CAP_MSGTYPE = ["Alert", "Update", "Cancel", "Ack", "Error"] as const;
export const CAP_SCOPE = ["Public", "Restricted", "Private"] as const;
export const CAP_CATEGORY = [
  "Geo", "Met", "Safety", "Security", "Rescue", "Fire", "Health", "Env",
  "Transport", "Infra", "CBRNE", "Other",
] as const;
export const CAP_URGENCY = ["Immediate", "Expected", "Future", "Past", "Unknown"] as const;
export const CAP_SEVERITY = ["Extreme", "Severe", "Moderate", "Minor", "Unknown"] as const;
export const CAP_CERTAINTY = ["Observed", "Likely", "Possible", "Unlikely", "Unknown"] as const;
export const CAP_RESPONSE_TYPE = [
  "Shelter", "Evacuate", "Prepare", "Execute", "Avoid", "Monitor", "Assess",
  "AllClear", "None",
] as const;

const NamedValue = z.object({ valueName: z.string().min(1), value: z.string() });

export const CapAreaSchema = z.object({
  areaDesc: z.string().min(1),
  polygon: z.array(z.string()).optional(),
  circle: z.array(z.string()).optional(),
  geocode: z.array(NamedValue).optional(),
  altitude: z.string().optional(),
  ceiling: z.string().optional(),
});
export type CapArea = z.infer<typeof CapAreaSchema>;

export const CapInfoSchema = z.object({
  language: z.string().default("en-US"),
  category: z.array(z.enum(CAP_CATEGORY)).min(1),
  event: z.string().min(1),
  responseType: z.array(z.enum(CAP_RESPONSE_TYPE)).optional(),
  urgency: z.enum(CAP_URGENCY),
  severity: z.enum(CAP_SEVERITY),
  certainty: z.enum(CAP_CERTAINTY),
  audience: z.string().optional(),
  eventCode: z.array(NamedValue).optional(),
  effective: z.string().optional(),
  onset: z.string().optional(),
  expires: z.string().optional(),
  senderName: z.string().optional(),
  headline: z.string().optional(),
  description: z.string().optional(),
  instruction: z.string().optional(),
  web: z.string().optional(),
  contact: z.string().optional(),
  parameter: z.array(NamedValue).optional(),
  area: z.array(CapAreaSchema).optional(),
});
export type CapInfo = z.infer<typeof CapInfoSchema>;

export const CapAlertSchema = z.object({
  identifier: z.string().min(1),
  sender: z.string().min(1),
  sent: z.string().min(1),
  status: z.enum(CAP_STATUS),
  msgType: z.enum(CAP_MSGTYPE),
  source: z.string().optional(),
  scope: z.enum(CAP_SCOPE),
  restriction: z.string().optional(),
  addresses: z.string().optional(),
  code: z.array(z.string()).optional(),
  note: z.string().optional(),
  references: z.string().optional(),
  incidents: z.string().optional(),
  info: z.array(CapInfoSchema).default([]),
});
export type CapAlert = z.infer<typeof CapAlertSchema>;
