#!/usr/bin/env node
// Build the licensed H13 NAPSG facility sprite from vendored originals. No npm dependencies.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const input = resolve(process.argv[2] || join(repo, "web/public/napsg"));
const output = resolve(process.argv[3] || input);
const manifestPath = join(input, "acquisition-manifest.json");
const attribution = "NAPSG Foundation facility symbols (catalog v4.1.5)";
const license = "CC BY 4.0";
const licenseUrl = "https://creativecommons.org/licenses/by/4.0/";
const sourceUrl = "https://www.napsgfoundation.org/symbology/";
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

if (!existsSync(manifestPath)) throw new Error(`Missing acquisition manifest: ${manifestPath}`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (!Array.isArray(manifest.assets) || manifest.assets.length !== 9) {
  throw new Error("Expected the approved nine-asset H13 manifest");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodeRgbaPng(buffer, file) {
  if (!buffer.subarray(0, 8).equals(pngSignature)) throw new Error(`${file}: invalid PNG signature`);
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  const idat = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    }
    offset += length + 12;
    if (type === "IEND") break;
  }
  if (!width || !height || bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`${file}: builder requires a non-interlaced 8-bit RGBA PNG`);
  }
  const packed = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  if (packed.length !== (stride + 1) * height) throw new Error(`${file}: unexpected scanline length`);
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const filter = packed[y * (stride + 1)];
    const row = packed.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0;
      const value = filter === 0 ? row[x]
        : filter === 1 ? row[x] + left
          : filter === 2 ? row[x] + up
            : filter === 3 ? row[x] + Math.floor((left + up) / 2)
              : filter === 4 ? row[x] + paeth(left, up, upperLeft)
                : Number.NaN;
      if (!Number.isFinite(value)) throw new Error(`${file}: unsupported PNG filter ${filter}`);
      pixels[y * stride + x] = value & 255;
    }
  }
  return { width, height, pixels };
}

function downsample(image, size) {
  if (image.width % size !== 0 || image.height % size !== 0) {
    throw new Error(`Cannot downsample ${image.width}x${image.height} to ${size}x${size}`);
  }
  const scaleX = image.width / size;
  const scaleY = image.height / size;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sums = [0, 0, 0, 0];
      for (let sy = 0; sy < scaleY; sy += 1) {
        for (let sx = 0; sx < scaleX; sx += 1) {
          const source = (((y * scaleY + sy) * image.width) + x * scaleX + sx) * 4;
          for (let channel = 0; channel < 4; channel += 1) sums[channel] += image.pixels[source + channel];
        }
      }
      const samples = scaleX * scaleY;
      const target = (y * size + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) out[target + channel] = Math.round(sums[channel] / samples);
    }
  }
  return out;
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return out;
}

function encodeRgbaPng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4;
  const scanlines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) pixels.copy(scanlines, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([pngSignature, chunk("IHDR", header), chunk("IDAT", deflateSync(scanlines, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

function writeAtomic(path, data) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, data);
  renameSync(temporary, path);
}

function build(pixelRatio) {
  const size = 32 * pixelRatio;
  const atlas = Buffer.alloc(size * manifest.assets.length * size * 4);
  const metadata = {};
  for (const [index, asset] of manifest.assets.entries()) {
    const file = join(input, asset.file);
    const original = readFileSync(file);
    if (sha256(original) !== asset.sha256) throw new Error(`${asset.file}: SHA-256 does not match the acquisition manifest`);
    const icon = downsample(decodeRgbaPng(original, asset.file), size);
    for (let y = 0; y < size; y += 1) {
      icon.copy(atlas, (y * size * manifest.assets.length + index * size) * 4, y * size * 4, (y + 1) * size * 4);
    }
    metadata[`napsg-${asset.id}`] = {
      width: size,
      height: size,
      x: index * size,
      y: 0,
      pixelRatio,
      attribution,
      license,
      licenseUrl,
      source: asset.sourceUrl,
      sourceSha256: asset.sha256,
    };
  }
  const suffix = pixelRatio === 1 ? "" : "@2x";
  writeAtomic(join(output, `sprite${suffix}.png`), encodeRgbaPng(size * manifest.assets.length, size, atlas));
  writeAtomic(join(output, `sprite${suffix}.json`), `${JSON.stringify(metadata, null, 2)}\n`);
}

mkdirSync(output, { recursive: true });
build(1);
build(2);
console.log(`Built ${manifest.assets.length} NAPSG facility symbols at 1x and 2x in ${output}`);
console.log(`${attribution}; ${license}; ${sourceUrl}`);
