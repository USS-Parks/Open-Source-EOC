import { fontStack, themes } from "../design/tokens.js";

export interface MapExportLayer {
  readonly title: string;
  readonly detail?: string | undefined;
}

export interface MapExportContext {
  readonly incidentName?: string | null | undefined;
  readonly operationalPeriod?: string | null | undefined;
  readonly handling?: string | null | undefined;
}

export interface MapExportMetadata extends MapExportContext {
  readonly operationalLayers: readonly MapExportLayer[];
  readonly referenceSources: readonly string[];
  readonly legendLines?: readonly string[] | undefined;
  readonly exportedAt: Date;
}

export interface MapExportResult {
  readonly dataUrl: string;
  readonly filename: string;
  readonly width: number;
  readonly height: number;
}

type CanvasFactory = () => HTMLCanvasElement;

const MIN_WIDTH = 960;
const MIN_HEADER_HEIGHT = 92;
const FOOTER_PADDING = 18;
const LINE_HEIGHT = 18;
const BRAND = themes.light;

function safeName(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "incident";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value
    .replace(/<[^>]*>/g, " ")
    .replace(/&copy;/gi, "©")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()).filter(Boolean))];
}

function wrapLine(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = words[0]!;
  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (context.measureText(candidate).width <= width) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

function receiptLines(metadata: MapExportMetadata): string[] {
  const layers = metadata.operationalLayers.length === 0
    ? "None visible"
    : metadata.operationalLayers.map((layer) => layer.detail ? `${layer.title} (${layer.detail})` : layer.title).join("; ");
  const sources = unique(metadata.referenceSources);
  return [
    "STATUS LEGEND: ◆ Critical   ▲ Warning   ● Normal   ? Unknown",
    ...(metadata.legendLines ?? []),
    `VISIBLE OPERATIONAL LAYERS: ${layers}`,
    `SOURCE PROVENANCE: ${sources.length > 0 ? sources.join("; ") : "No source attribution supplied"}`,
    `EXPORTED: ${metadata.exportedAt.toISOString()} | Snapshot of the visible map frame; not a live feed.`,
  ];
}

function drawCompass(context: CanvasRenderingContext2D, x: number, y: number): void {
  context.save();
  context.strokeStyle = BRAND.brandNavyText;
  context.fillStyle = BRAND.brandSignal;
  context.lineWidth = 2;
  context.beginPath();
  context.arc(x, y, 17, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.moveTo(x, y - 13);
  context.lineTo(x + 5, y + 3);
  context.lineTo(x, y);
  context.lineTo(x - 5, y + 3);
  context.closePath();
  context.fill();
  context.beginPath();
  context.moveTo(x - 11, y);
  context.lineTo(x + 11, y);
  context.moveTo(x, y - 11);
  context.lineTo(x, y + 11);
  context.stroke();
  context.restore();
}

/** Compose a print-friendly PNG around the exact current MapLibre canvas. */
export function renderMapExport(
  source: HTMLCanvasElement,
  metadata: MapExportMetadata,
  createCanvas: CanvasFactory = () => document.createElement("canvas"),
): MapExportResult {
  if (source.width <= 0 || source.height <= 0) throw new Error("Map canvas is empty.");
  const width = Math.max(MIN_WIDTH, source.width);
  const mapHeight = Math.round(source.height * (width / source.width));
  const output = createCanvas();
  output.width = width;
  const context = output.getContext("2d");
  if (!context) throw new Error("PNG export is unavailable in this browser.");

  context.font = `13px ${fontStack}`;
  const wrappedReceipt = receiptLines(metadata).flatMap((line) => wrapLine(context, line, width - FOOTER_PADDING * 2));
  const footerHeight = FOOTER_PADDING * 2 + wrappedReceipt.length * LINE_HEIGHT;
  const handlingLabel = metadata.handling?.trim() ? `HANDLING: ${metadata.handling.trim()}` : "";
  const handlingWidth = handlingLabel ? context.measureText(handlingLabel).width + 18 : 0;
  const headerTextWidth = Math.max(240, width - 86 - (handlingWidth ? handlingWidth + 36 : 18));
  context.font = `750 22px ${fontStack}`;
  const incidentLines = wrapLine(context, metadata.incidentName?.trim() || "No incident selected", headerTextWidth);
  context.font = `13px ${fontStack}`;
  const periodLines = wrapLine(context, metadata.operationalPeriod?.trim() || "Operational period not selected", headerTextWidth);
  const headerHeight = Math.max(MIN_HEADER_HEIGHT, 43 + incidentLines.length * 26 + periodLines.length * 18);
  output.height = headerHeight + mapHeight + footerHeight;

  context.fillStyle = BRAND.brandNavy;
  context.fillRect(0, 0, width, headerHeight);
  context.fillStyle = BRAND.brandTeal;
  context.fillRect(0, headerHeight - 5, width, 5);
  drawCompass(context, 38, 39);

  context.fillStyle = BRAND.brandNavyText;
  context.font = `750 13px ${fontStack}`;
  context.fillText("OPEN SOURCE EOC", 68, 27);
  context.font = `750 22px ${fontStack}`;
  let headerY = 55;
  for (const line of incidentLines) {
    context.fillText(line, 68, headerY);
    headerY += 26;
  }
  context.font = `13px ${fontStack}`;
  for (const line of periodLines) {
    context.fillText(line, 68, headerY);
    headerY += 18;
  }
  if (handlingLabel) {
    context.strokeStyle = BRAND.brandSignal;
    context.lineWidth = 1.5;
    context.strokeRect(width - handlingWidth - 18, 17, handlingWidth, 26);
    context.fillText(handlingLabel, width - handlingWidth - 9, 35);
  }

  context.drawImage(source, 0, headerHeight, width, mapHeight);

  const footerTop = headerHeight + mapHeight;
  context.fillStyle = BRAND.surface;
  context.fillRect(0, footerTop, width, footerHeight);
  context.fillStyle = BRAND.brandTeal;
  context.fillRect(0, footerTop, width, 3);
  context.fillStyle = BRAND.textStrong;
  context.font = `13px ${fontStack}`;
  let y = footerTop + FOOTER_PADDING + 10;
  for (const line of wrappedReceipt) {
    context.fillText(line, FOOTER_PADDING, y);
    y += LINE_HEIGHT;
  }

  const iso = metadata.exportedAt.toISOString().replace(/[:.]/g, "-");
  return {
    dataUrl: output.toDataURL("image/png"),
    filename: `cop-${safeName(metadata.incidentName?.trim() || "incident")}-${iso}.png`,
    width,
    height: output.height,
  };
}

export function downloadMapExport(result: MapExportResult): void {
  const anchor = document.createElement("a");
  anchor.href = result.dataUrl;
  anchor.download = result.filename;
  anchor.click();
}
