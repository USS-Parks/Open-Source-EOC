// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canReadCodes, QrCode, qrDecoder, readCodeFromImage } from "../qr.js";

afterEach(cleanup);

/** Paint an SVG path of `M x y h n v1 h-n z` runs, as QrCode draws it, into RGBA pixels at `scale` per module. */
function rasterize(svg: SVGSVGElement, scale: number): { data: Uint8ClampedArray; side: number } {
  const size = Number(svg.getAttribute("viewBox")!.split(" ")[2]);
  const side = size * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  const d = svg.querySelector("path")!.getAttribute("d")!;
  for (const [, x, y, n] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
    for (let row = Number(y) * scale; row < (Number(y) + 1) * scale; row += 1)
      for (let col = Number(x) * scale; col < (Number(x) + Number(n)) * scale; col += 1)
        data.fill(0, (row * side + col) * 4, (row * side + col) * 4 + 3);
  }
  return { data, side };
}

describe("QR codes", () => {
  it("draws a symbol, with its quiet zone, that decodes back to the value", async () => {
    const jsQR = await qrDecoder();
    const link = "https://eoc.example.org/app/index.html#/resources/pool/a3333333-3333-4333-8333-333333333333";
    render(<QrCode value={link} label="QR code linking to Tender 7" />);
    const svg = screen.getByRole("img", { name: "QR code linking to Tender 7" }) as unknown as SVGSVGElement;
    // Every drawn run is a whole number of modules inside the quiet zone.
    const d = svg.querySelector("path")!.getAttribute("d")!;
    expect(d.replace(/M\d+ \d+h(\d+)v1h-\1z/g, "")).toBe("");
    const { data, side } = rasterize(svg, 6);
    expect(jsQR(data, side, side)?.data).toBe(link);

    cleanup();
    const badge = "q1Wf-3kZr_0aPxY7mN2vB8cL5dT9sH4gJ6uE1oR0iUw";
    render(<QrCode value={badge} label="QR code of the badge code" />);
    const drawn = rasterize(screen.getByRole("img") as unknown as SVGSVGElement, 5);
    expect(jsQR(drawn.data, drawn.side, drawn.side)?.data).toBe(badge);
  });

  it("reads with the browser's detector where there is one, and reports none where it cannot read at all", async () => {
    const detector = Object.getOwnPropertyDescriptor(globalThis, "BarcodeDetector");
    const bitmap = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
    const close = vi.fn();
    const formats: unknown[] = [];
    try {
      Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: vi.fn().mockResolvedValue({ close }) });
      Object.defineProperty(globalThis, "BarcodeDetector", { configurable: true, value: class {
        constructor(options?: { formats?: string[] }) { formats.push(options?.formats); }
        async detect() { return [{ rawValue: "  TRK-1  " }]; }
      } });
      expect(canReadCodes()).toBe(true);
      expect(await readCodeFromImage(new Blob(["x"]), ["qr_code", "code_128"])).toBe("TRK-1");
      expect(formats).toEqual([["qr_code", "code_128"]]);
      expect(close).toHaveBeenCalledTimes(1);

      // Without a detector, a barcode-only read finds nothing; the bundled decoder reads QR codes only.
      delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
      expect(await readCodeFromImage(new Blob(["x"]), ["code_128"])).toBeNull();
      expect(close).toHaveBeenCalledTimes(2);

      delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
      expect(canReadCodes()).toBe(false);
      expect(await readCodeFromImage(new Blob(["x"]))).toBeNull();
    } finally {
      if (detector) Object.defineProperty(globalThis, "BarcodeDetector", detector);
      else delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
      if (bitmap) Object.defineProperty(globalThis, "createImageBitmap", bitmap);
      else delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
    }
  });
});
