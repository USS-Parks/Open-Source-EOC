import { z } from "zod";
import { allEnums } from "./citations.js";

export * from "./citations.js";
export * from "./ics.js";
export * from "./resource-request.js";
export * from "./lifelines.js";
export * from "./esf.js";
export * from "./core-capabilities.js";
export * from "./pda.js";
export * from "./have.js";
export * from "./tracking.js";
export * from "./symbology.js";

/**
 * Export every registered enumeration as JSON Schema, keyed by dictionary id.
 * Consumers outside the TypeScript world (form runners, validators, other
 * languages) build from this, not from the TS source.
 */
export function toJsonSchemas(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const e of allEnums()) {
    out[e.id] = z.toJSONSchema(e.schema as z.ZodType);
  }
  return out;
}
