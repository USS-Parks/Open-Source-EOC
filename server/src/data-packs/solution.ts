import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { z } from "zod";
import { BoardTemplateSchema, DashboardTemplateSchema, FormDefinitionSchema } from "@openeoc/shared";
import { canonical } from "../boards/package.js";
import { IncidentTemplateSchema } from "../incidents/service.js";
import { ConditionSchema } from "../notify/engine.js";
import { CadenceSchema, ReportDefinitionSchema } from "../reports/service.js";

/**
 * Signed solution packages, version 2 (VA11, VC-07). One file carries what an
 * instance is set up with: board templates, incident templates, forms,
 * dashboard templates, report templates and rule templates. The publisher
 * signs it with an Ed25519 key (the `sign-package` command); an instance
 * imports it only when it trusts that key, from the same PEM bundle as the
 * version 1 board template package (OPENEOC_TRUSTED_TEMPLATE_KEYS), and the
 * signature holds over everything in the file but the signature itself.
 */

export const SOLUTION_FORMAT = "openeoc-package-v2";

const Key = z.string().regex(/^[a-z][a-z0-9_]*$/, "use a lower_snake key").max(80);
const Version = z.number().int().positive();
const Title = z.string().trim().min(1).max(200);

/**
 * A report as a template: the board template it runs on, by key, its columns,
 * conditions, groups, totals and sorts, and optionally when it runs and in
 * which format. Recipients are a jurisdiction's own, so they are not carried.
 */
export const ReportTemplateSchema = z.object({
  key: Key,
  version: Version,
  title: Title,
  board: Key,
  definition: ReportDefinitionSchema,
  schedule: z.object({ cadence: CadenceSchema, format: z.enum(["pdf", "xlsx", "csv"]) }).strict().optional(),
}).strict();
export type ReportTemplate = z.infer<typeof ReportTemplateSchema>;

const Via = z.array(z.enum(["inapp", "email", "sms"])).min(1).max(3);

/**
 * Who a rule reaches, named so it means the same in any jurisdiction: the
 * position that asked, a position by its key, a contact group by its name.
 * Webhook and ntfy addresses and email and SMS numbers are a jurisdiction's
 * own and are not carried.
 */
export const PortableChannelSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inapp"), target: z.enum(["requesting_position"]) }).strict(),
  z.object({ kind: z.literal("position"), position: Key, reach: z.enum(["holders", "on_call"]).default("holders"), via: Via }).strict(),
  z.object({ kind: z.literal("group"), group: Title, via: Via }).strict(),
]);

/** A notification rule as a template: the board template it watches, by key, its event, condition and who it reaches. */
export const RuleTemplateSchema = z.object({
  key: Key,
  version: Version,
  title: Title,
  board: Key.nullable(),
  event: z.enum(["record.created", "record.updated", "scheduled"]),
  condition: ConditionSchema.default({ op: "any" }),
  channels: z.array(PortableChannelSchema).min(1).max(10),
  scheduleIntervalMinutes: z.number().int().positive().max(10_080).optional(),
}).strict();
export type RuleTemplate = z.infer<typeof RuleTemplateSchema>;

/** The kinds of content a package carries, in the order a summary lists them. */
export const PART_KINDS = ["boardTemplates", "incidentTemplates", "forms", "dashboardTemplates", "reportTemplates", "ruleTemplates"] as const;
export type PartKind = (typeof PART_KINDS)[number];

function unique<T>(items: readonly T[], id: (item: T) => string, what: string, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const item of items) {
    const key = id(item);
    if (seen.has(key)) ctx.addIssue({ code: "custom", message: `${what} ${key} appears twice` });
    seen.add(key);
  }
}

export const SolutionContentsSchema = z.object({
  boardTemplates: z.array(BoardTemplateSchema).max(200).default([]),
  incidentTemplates: z.array(IncidentTemplateSchema).max(100).default([]),
  forms: z.array(FormDefinitionSchema).max(200).default([]),
  dashboardTemplates: z.array(DashboardTemplateSchema).max(100).default([]),
  reportTemplates: z.array(ReportTemplateSchema).max(200).default([]),
  ruleTemplates: z.array(RuleTemplateSchema).max(200).default([]),
}).strict().superRefine((contents, ctx) => {
  if (PART_KINDS.every((kind) => contents[kind].length === 0)) ctx.addIssue({ code: "custom", message: "a package carries at least one item" });
  const versioned = (item: { key: string; version: number }) => `${item.key} version ${item.version}`;
  unique(contents.boardTemplates, versioned, "board template", ctx);
  unique(contents.incidentTemplates, (item) => item.key, "incident template", ctx);
  unique(contents.forms, versioned, "form", ctx);
  unique(contents.dashboardTemplates, versioned, "dashboard template", ctx);
  unique(contents.reportTemplates, versioned, "report template", ctx);
  unique(contents.ruleTemplates, versioned, "rule template", ctx);
});
export type SolutionContents = z.infer<typeof SolutionContentsSchema>;

/** What a publisher writes and `sign-package` signs. */
export const UnsignedPackageSchema = z.object({
  publisher: Title,
  name: Title,
  version: z.string().trim().min(1).max(40),
  description: z.string().trim().max(2000).optional(),
  contents: SolutionContentsSchema,
}).strict();

export const SignedPackageSchema = z.object({
  format: z.literal(SOLUTION_FORMAT),
  publisher: Title,
  name: Title,
  version: z.string().trim().min(1).max(40),
  description: z.string().trim().max(2000).optional(),
  publishedAt: z.iso.datetime({ offset: true }),
  publicKey: z.string().min(1),
  contents: SolutionContentsSchema,
  signature: z.string().min(1),
}).strict();
export type SignedPackage = z.infer<typeof SignedPackageSchema>;

/** Why a package was refused, in words an administrator can act on. */
export class PackageRefused extends Error {}

/** The first problem zod found, as "where: what". */
function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return `${issue?.path.join(".") || "package"}: ${issue?.message ?? "invalid"}`;
}

/** A key's fingerprint: the SHA-256 of its public key's DER bytes, in hex. */
export function keyFingerprint(key: KeyObject): string {
  return createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
}

/**
 * Sign a package: check it as an instance would, add the format, the time and
 * the public key, and sign the canonical JSON of all of it. The file written
 * is exactly what was signed, plus the signature.
 */
export function signSolutionPackage(input: unknown, privateKeyPem: string, now: Date = new Date()): SignedPackage {
  const parsed = UnsignedPackageSchema.safeParse(input);
  if (!parsed.success) throw new PackageRefused(firstIssue(parsed.error));
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new PackageRefused("the signing key must be an Ed25519 private key");
  const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  const body = { format: SOLUTION_FORMAT, ...parsed.data, publishedAt: now.toISOString(), publicKey };
  const signature = sign(null, Buffer.from(canonical(body)), privateKey).toString("base64");
  return { ...body, signature } as SignedPackage;
}

export interface VerifiedPackage {
  readonly package: SignedPackage;
  readonly keyFingerprint: string;
  /** SHA-256 of the signed content, in hex: the same package imported twice has the same digest. */
  readonly digest: string;
}

/**
 * Verify a package before reading anything in it: the format, a trusted key,
 * and the signature over everything but the signature. Only then is the
 * content checked against the schemas, so a changed package is refused as
 * changed whatever else is wrong with it.
 */
export function verifySolutionPackage(raw: unknown, trustedPublicKeysPem: readonly string[]): VerifiedPackage {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PackageRefused("a package is a JSON object");
  const { signature, ...body } = raw as Record<string, unknown>;
  if (body.format !== SOLUTION_FORMAT) throw new PackageRefused(`not a signed solution package (format ${SOLUTION_FORMAT})`);
  if (typeof signature !== "string" || typeof body.publicKey !== "string") throw new PackageRefused("the package is not signed");
  const normalize = (pem: string) => pem.replace(/\s+/g, "");
  if (!trustedPublicKeysPem.some((pem) => normalize(pem) === normalize(body.publicKey as string))) {
    throw new PackageRefused("the package is signed by a key this instance does not trust");
  }
  let key: KeyObject;
  try {
    key = createPublicKey(body.publicKey);
  } catch {
    throw new PackageRefused("the package's public key cannot be read");
  }
  const signed = Buffer.from(canonical(body));
  if (!verify(null, signed, key, Buffer.from(signature, "base64"))) {
    throw new PackageRefused("the signature does not match the contents: the package was changed after it was signed");
  }
  const parsed = SignedPackageSchema.safeParse(raw);
  if (!parsed.success) throw new PackageRefused(firstIssue(parsed.error));
  return { package: parsed.data, keyFingerprint: keyFingerprint(key), digest: createHash("sha256").update(signed).digest("hex") };
}
