import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PWA packaging: the app is installable and its shell caches
 * for offline boot. The install-prompt and airplane-mode boot are
 * validated in a real browser at pilot; here we hold the static contract.
 */

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "public");

describe("the PWA is installable and offline-capable", () => {
  it("ships a standalone manifest with a start_url and icons", () => {
    const manifest = JSON.parse(readFileSync(join(PUBLIC, "manifest.webmanifest"), "utf8")) as {
      display: string;
      start_url: string;
      icons: Array<{ sizes: string; purpose?: string }>;
    };
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.icons.map((i) => i.sizes)).toContain("512x512");
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("ships a service worker that caches the shell and never caches the API", () => {
    const sw = readFileSync(join(PUBLIC, "sw.js"), "utf8");
    expect(sw).toContain("addEventListener(\"install\"");
    expect(sw).toContain("cache.addAll(SHELL_ASSETS)");
    // API traffic must pass through, not be served from a stale cache.
    expect(sw).toMatch(/pathname\.startsWith\("\/api\/"\)/);
  });
});
