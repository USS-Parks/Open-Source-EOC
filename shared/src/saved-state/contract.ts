import { z } from "zod";

export const SAVED_STATE_KINDS = [
  "workspace_preferences",
  "workspace_layout",
  "table_view",
  "dashboard_config",
] as const;

export const MAX_SAVED_STATE_BYTES = 65_536;
export const MAX_SAVED_STATE_LIST = 100;

export const SavedStateKindSchema = z.enum(SAVED_STATE_KINDS);
export type SavedStateKind = z.infer<typeof SavedStateKindSchema>;

export const SavedStateKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export type SavedStateJson =
  | null
  | boolean
  | number
  | string
  | readonly SavedStateJson[]
  | SavedStatePayload;

export interface SavedStatePayload {
  readonly [key: string]: SavedStateJson;
}

function isJsonPayload(value: unknown): value is SavedStatePayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const pending: unknown[] = [value];
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null) continue;
    if (["string", "boolean"].includes(typeof current)) continue;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) return false;
      continue;
    }
    if (typeof current !== "object") return false;
    if (seen.has(current)) return false;
    seen.add(current);
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) return false;
    pending.push(...Object.values(current));
  }
  return true;
}

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

export const SavedStatePayloadSchema = z
  .custom<SavedStatePayload>(isJsonPayload, "payload must be a JSON object")
  .superRefine((payload, ctx) => {
    if (utf8Bytes(JSON.stringify(payload)) > MAX_SAVED_STATE_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: `payload must be at most ${MAX_SAVED_STATE_BYTES} UTF-8 bytes`,
      });
    }
  });

export const SavedStateWriteSchema = z
  .object({
    schemaVersion: z.number().int().min(1).max(2_147_483_647),
    expectedRevision: z.number().int().min(0).max(2_147_483_647),
    payload: SavedStatePayloadSchema,
  })
  .strict();

export type SavedStateWrite = z.infer<typeof SavedStateWriteSchema>;

export interface SavedStateRecord {
  readonly incidentId: string;
  readonly kind: SavedStateKind;
  readonly key: string;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly payload: SavedStatePayload;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SavedStateListPage {
  readonly states: readonly SavedStateRecord[];
  readonly nextCursor: string | null;
}
