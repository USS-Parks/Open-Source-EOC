import { z } from "zod";
import { allEnums } from "./citations.js";

export * from "./citations.js";
export * from "./ics.js";
export * from "./resource-request.js";
export * from "./resource-typing.js";
export * from "./lifelines.js";
export * from "./esf.js";
export * from "./core-capabilities.js";
export * from "./pda.js";
export * from "./have.js";
export * from "./tracking.js";
export * from "./symbology.js";

/**
 * A stored enumeration value as people read it: "shelter_open" reads "Shelter
 * open". Human outputs show this; stored codes stay in exports meant for
 * import and in machine payloads.
 */
export function choiceLabel(value: string): string {
  const words = value.replaceAll("_", " ");
  return words.charAt(0).toLocaleUpperCase() + words.slice(1);
}

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
