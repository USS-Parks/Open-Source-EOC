import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { z } from "zod";
import { BoardTemplateSchema, type BoardTemplate } from "@openeoc/shared";

/**
 * Signed template packages: the regional standard-library mechanism
 * (INV-5, the Bay Area lesson). A region publishes its board set as one
 * signed package; member jurisdictions import it and can re-converge on it
 * after local divergence. Signatures are Ed25519 over the canonical JSON
 * of the template list.
 */

export const TemplatePackageSchema = z.object({
  format: z.literal("openeoc-templates-v1"),
  publisher: z.string().min(1),
  publishedAt: z.iso.datetime({ offset: true }),
  templates: z.array(BoardTemplateSchema).min(1),
  signature: z.string().min(1),
  publicKey: z.string().min(1),
});

export type TemplatePackage = z.infer<typeof TemplatePackageSchema>;

/** Deterministic serialization: sorted keys, no whitespace variance. */
function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

export function generateSigningKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

export function exportPackage(
  templates: readonly BoardTemplate[],
  publisher: string,
  privateKeyPem: string,
  publicKeyPem: string,
): TemplatePackage {
  const body = {
    publisher,
    publishedAt: new Date().toISOString(),
    templates: templates as BoardTemplate[],
  };
  const signature = sign(null, Buffer.from(canonical(body)), createPrivateKey(privateKeyPem));
  return {
    format: "openeoc-templates-v1",
    ...body,
    signature: signature.toString("base64"),
    publicKey: publicKeyPem,
  };
}

/**
 * Verify and unpack. The caller decides which publisher keys it trusts;
 * the embedded key is checked against that allowlist, never trusted bare.
 */
export function verifyPackage(
  raw: unknown,
  trustedPublicKeysPem: readonly string[],
): readonly BoardTemplate[] {
  const pkg = TemplatePackageSchema.parse(raw);
  const normalize = (pem: string) => pem.replace(/\s+/g, "");
  if (!trustedPublicKeysPem.some((k) => normalize(k) === normalize(pkg.publicKey))) {
    throw new Error("template package signed by an untrusted key");
  }
  const body = {
    publisher: pkg.publisher,
    publishedAt: pkg.publishedAt,
    templates: pkg.templates,
  };
  const ok = verify(
    null,
    Buffer.from(canonical(body)),
    createPublicKey(pkg.publicKey),
    Buffer.from(pkg.signature, "base64"),
  );
  if (!ok) throw new Error("template package signature verification failed");
  return pkg.templates;
}
