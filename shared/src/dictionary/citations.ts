import { z } from "zod";

/** Doctrinal source citation. Every enumeration in the dictionary carries one. */
export interface Citation {
  /** Issuing authority, e.g. "FEMA", "OASIS", "NAPSG Foundation". */
  readonly authority: string;
  /** Document title and edition/date. */
  readonly document: string;
  /** Section, form number, or page when applicable. */
  readonly section?: string;
}

/** A cited, versioned enumeration usable as both a TS type and a zod schema. */
export interface DictEnum {
  readonly id: string;
  readonly values: readonly string[];
  readonly schema: z.ZodType<string>;
  readonly citation: Citation;
}

const registry: DictEnum[] = [];

/** Define a cited enumeration and register it for the citation lint. */
export function defineEnum(
  id: string,
  values: readonly [string, ...string[]],
  citation: Citation,
): DictEnum {
  const entry: DictEnum = {
    id,
    values,
    schema: z.enum(values as [string, ...string[]]),
    citation,
  };
  registry.push(entry);
  return entry;
}

/** All registered enumerations (used by tests and schema export). */
export function allEnums(): readonly DictEnum[] {
  return registry;
}
