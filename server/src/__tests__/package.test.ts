import { describe, expect, it } from "vitest";
import { STANDARD_TEMPLATES } from "@openeoc/shared";
import { exportPackage, generateSigningKeyPair, verifyPackage } from "../boards/package.js";

describe("signed template packages (regional library)", () => {
  const keys = generateSigningKeyPair();
  const other = generateSigningKeyPair();

  it("round-trips a signed package under a trusted key", () => {
    const pkg = exportPackage(
      STANDARD_TEMPLATES.slice(0, 2),
      "NCR Region",
      keys.privateKeyPem,
      keys.publicKeyPem,
    );
    const templates = verifyPackage(pkg, [keys.publicKeyPem]);
    expect(templates).toHaveLength(2);
  });

  it("rejects tampered content", () => {
    const pkg = exportPackage(
      STANDARD_TEMPLATES.slice(0, 1),
      "NCR Region",
      keys.privateKeyPem,
      keys.publicKeyPem,
    );
    const tampered = structuredClone(pkg) as { templates: Array<{ title: string }> };
    tampered.templates[0]!.title = "Backdoored Board";
    expect(() => verifyPackage(tampered, [keys.publicKeyPem])).toThrow(/signature/);
  });

  it("rejects an untrusted publisher key even with a valid signature", () => {
    const pkg = exportPackage(
      STANDARD_TEMPLATES.slice(0, 1),
      "Unknown Org",
      other.privateKeyPem,
      other.publicKeyPem,
    );
    expect(() => verifyPackage(pkg, [keys.publicKeyPem])).toThrow(/untrusted/);
  });
});
