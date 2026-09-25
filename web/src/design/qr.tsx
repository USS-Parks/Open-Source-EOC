import { useMemo } from "react";
import { create } from "qrcode";

/** The quiet zone the QR standard asks for around a symbol, in modules. */
const QUIET_ZONE = 4;
/** A camera photo is scaled to at most this many pixels on its long side before decoding. */
const DECODE_SIDE = 1600;

/** The dark modules of a QR symbol as one SVG path, a run of modules in a row at a time. */
function qrSymbol(value: string): { readonly size: number; readonly path: string } {
  const { modules } = create(value, { errorCorrectionLevel: "M" });
  const runs: string[] = [];
  for (let row = 0; row < modules.size; row += 1) {
    let col = 0;
    while (col < modules.size) {
      if (!modules.get(row, col)) { col += 1; continue; }
      const start = col;
      while (col < modules.size && modules.get(row, col)) col += 1;
      runs.push(`M${start + QUIET_ZONE} ${row + QUIET_ZONE}h${col - start}v1h-${col - start}z`);
    }
  }
  return { size: modules.size + QUIET_ZONE * 2, path: runs.join("") };
}

/**
 * A QR code (VA9) drawn as SVG, so it prints sharp at any size. It is black
 * on white in either theme: a scanner needs the contrast, and many do not
 * read an inverted symbol.
 */
export function QrCode(props: { readonly value: string; readonly label: string; readonly className?: string }) {
  const { size, path } = useMemo(() => qrSymbol(props.value), [props.value]);
  return (
    <svg className={props.className ? `eoc-qr ${props.className}` : "eoc-qr"} role="img" aria-label={props.label}
      viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

type Detector = new (options?: { formats?: string[] }) => {
  detect(source: ImageBitmap): Promise<Array<{ rawValue?: string }>>;
};
type DecodeQr = (data: Uint8ClampedArray, width: number, height: number) => { data: string } | null;

/**
 * Whether this browser can read a code from an image: with its own
 * BarcodeDetector, or with the QR decoder that ships with the app.
 */
export const canReadCodes = (): boolean => "BarcodeDetector" in globalThis || typeof globalThis.createImageBitmap === "function";

/** The bundled QR decoder, loaded the first time an image is read without BarcodeDetector. */
export async function qrDecoder(): Promise<DecodeQr> {
  const loaded = await import("jsqr") as unknown as { default: DecodeQr | { default: DecodeQr } };
  return typeof loaded.default === "function" ? loaded.default : loaded.default.default;
}

async function decodeQr(bitmap: ImageBitmap): Promise<string | null> {
  const scale = Math.min(1, DECODE_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const context = typeof OffscreenCanvas === "function"
    ? new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true })
    : Object.assign(document.createElement("canvas"), { width, height }).getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  return (await qrDecoder())(data, width, height)?.data.trim() || null;
}

/**
 * Read a code from a camera image. The browser's BarcodeDetector reads every
 * format it knows; where there is none (desktop Windows and Linux, iPhone and
 * iPad), the bundled decoder reads QR codes. Null when no code is found or the
 * browser can read none; a rejection means the image itself could not be read.
 */
export async function readCodeFromImage(file: Blob, formats?: readonly string[]): Promise<string | null> {
  if (!canReadCodes()) return null;
  const api = globalThis as typeof globalThis & { BarcodeDetector?: Detector };
  const bitmap = await createImageBitmap(file);
  try {
    if (api.BarcodeDetector) {
      const [result] = await new api.BarcodeDetector(formats ? { formats: [...formats] } : undefined).detect(bitmap);
      return result?.rawValue?.trim() || null;
    }
    return formats && !formats.includes("qr_code") ? null : await decodeQr(bitmap);
  } finally {
    bitmap.close();
  }
}
