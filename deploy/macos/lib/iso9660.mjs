import { closeSync, openSync, readSync, statSync, writeSync, ftruncateSync } from "node:fs";

/**
 * A disk image macOS mounts, written on any computer: ISO 9660 with the Rock
 * Ridge extensions, which carry each file's name, POSIX permissions (so a
 * launcher stays executable) and symbolic links (the Applications link beside
 * an app). The image is read only, as a disk image for distribution is.
 *
 * A tree node is { name, type: "dir", children } or { name, type: "file",
 * source (a path) | data (a Buffer), mode } or { name, type: "symlink",
 * target }. Directories are 0755 and files 0644 unless given a mode.
 */

const SECTOR = 2048;
const bothEndian32 = (buffer, offset, value) => { buffer.writeUInt32LE(value, offset); buffer.writeUInt32BE(value, offset + 4); };
const bothEndian16 = (buffer, offset, value) => { buffer.writeUInt16LE(value, offset); buffer.writeUInt16BE(value, offset + 2); };

function recordingDate(date) {
  return Buffer.from([date.getUTCFullYear() - 1900, date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), 0]);
}

function volumeDate(date) {
  const pad = (value, width) => String(value).padStart(width, "0");
  const text = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1, 2)}${pad(date.getUTCDate(), 2)}${pad(date.getUTCHours(), 2)}${pad(date.getUTCMinutes(), 2)}${pad(date.getUTCSeconds(), 2)}00`;
  return Buffer.concat([Buffer.from(text, "ascii"), Buffer.from([0])]);
}

function field(text, length) {
  return Buffer.from(String(text).padEnd(length, " ").slice(0, length), "ascii");
}

/** A Rock Ridge / SUSP entry: two letters, its length, version 1, then its body. */
function entry(signature, body) {
  const head = Buffer.from([signature.charCodeAt(0), signature.charCodeAt(1), 4 + body.length, 1]);
  return Buffer.concat([head, body]);
}

function px(mode, links) {
  const body = Buffer.alloc(32);
  bothEndian32(body, 0, mode);
  bothEndian32(body, 8, links);
  return entry("PX", body);
}

function nm(name) {
  return entry("NM", Buffer.concat([Buffer.from([0]), Buffer.from(name, "utf8")]));
}

function sl(target) {
  const parts = [];
  let path = target;
  if (path.startsWith("/")) { parts.push(Buffer.from([0x08, 0])); path = path.slice(1); }
  for (const component of path.split("/").filter(Boolean)) {
    if (component === ".") parts.push(Buffer.from([0x02, 0]));
    else if (component === "..") parts.push(Buffer.from([0x04, 0]));
    else { const bytes = Buffer.from(component, "utf8"); parts.push(Buffer.from([0, bytes.length]), bytes); }
  }
  return entry("SL", Buffer.concat([Buffer.from([0]), ...parts]));
}

const rr = (flags) => entry("RR", Buffer.from([flags]));
const sp = () => entry("SP", Buffer.from([0xbe, 0xef, 0]));
const ceEntry = (lba, offset, length) => { const body = Buffer.alloc(24); bothEndian32(body, 0, lba); bothEndian32(body, 8, offset); bothEndian32(body, 16, length); return entry("CE", body); };
function er() {
  const id = Buffer.from("RRIP_1991A", "ascii");
  const description = Buffer.from("THE ROCK RIDGE INTERCHANGE PROTOCOL PROVIDES SUPPORT FOR POSIX FILE SYSTEM SEMANTICS", "ascii");
  const source = Buffer.from("PLEASE CONTACT DISC PUBLISHER FOR SPECIFICATION SOURCE.  SEE PUBLISHER IDENTIFIER IN PRIMARY VOLUME DESCRIPTOR FOR CONTACT INFORMATION.", "ascii");
  return entry("ER", Buffer.concat([Buffer.from([id.length, description.length, source.length, 1]), id, description, source]));
}

const MODES = { dir: 0o040755, file: 0o100644, symlink: 0o120777 };

export async function writeIso({ tree, output, volumeId, date = new Date() }) {
  // Number the directories breadth first, as the path tables list them, and
  // give every entry an ISO name that sorts in the order it is written.
  const directories = [];
  const files = [];
  const queue = [{ node: tree, parent: null }];
  while (queue.length) {
    const { node, parent } = queue.shift();
    node.number = directories.length + 1;
    node.parent = parent ?? node;
    directories.push(node);
    node.children = [...(node.children ?? [])].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    node.children.forEach((child, index) => {
      const serial = `N${String(index + 1).padStart(6, "0")}`;
      child.isoName = child.type === "dir" ? serial : `${serial}.;1`;
      if (child.type === "dir") queue.push({ node: child, parent: node });
      else if (child.type === "file") {
        child.size = child.data ? child.data.length : statSync(child.source).size;
        files.push(child);
      } else child.size = 0;
    });
  }

  // Continuation areas hold the Rock Ridge entries a record has no room for.
  const continuations = [];
  const addContinuation = (bytes) => {
    const last = continuations.at(-1);
    if (last && last.length + bytes.length <= SECTOR) {
      const offset = last.length;
      last.parts.push(bytes);
      last.length += bytes.length;
      return { block: last, offset };
    }
    const block = { parts: [bytes], length: bytes.length, lba: 0 };
    continuations.push(block);
    return { block, offset: 0 };
  };

  // Each directory's records: ".", "..", then its entries.
  // One directory record: kind "self" (.), "parent" (..) or "entry". The root's
  // "." carries SP first and, in a continuation area, the ER that names Rock
  // Ridge; an entry's name and link go in a continuation area when the record
  // (at most 255 bytes) has no room for them.
  const plan = (node, kind) => {
    const target = kind === "parent" ? node.parent : node;
    const rootSelf = kind === "self" && node === tree;
    const isDir = kind !== "entry" || node.type === "dir";
    const name = kind === "self" ? Buffer.from([0]) : kind === "parent" ? Buffer.from([1]) : Buffer.from(node.isoName, "ascii");
    const mode = kind === "entry" ? (node.mode ?? MODES[node.type]) : (target.mode ?? MODES.dir);
    let flags = 0x01;
    const extra = [];
    if (kind === "entry") { extra.push(nm(node.name)); flags |= 0x08; }
    if (kind === "entry" && node.type === "symlink") { extra.push(sl(node.target)); flags |= 0x04; }
    if (rootSelf) extra.push(er());
    const inlineBytes = [...(rootSelf ? [sp()] : []), rr(flags), px(mode, isDir ? 2 : 1)];
    const base = 33 + name.length + (name.length % 2 === 0 ? 1 : 0);
    const inlineLength = inlineBytes.reduce((sum, bytes) => sum + bytes.length, 0);
    const extraLength = extra.reduce((sum, bytes) => sum + bytes.length, 0);
    let continuation = null;
    let suArea;
    if (!rootSelf && base + inlineLength + extraLength <= 254) suArea = Buffer.concat([...inlineBytes, ...extra]);
    else {
      continuation = addContinuation(Buffer.concat(extra));
      suArea = Buffer.concat([...inlineBytes, Buffer.alloc(28)]);
    }
    let length = base + suArea.length;
    if (length % 2) length += 1;
    return { target, isDir, name, suArea, continuation, extraLength, length };
  };
  for (const node of directories) {
    node.records = [plan(node, "self"), plan(node, "parent"), ...node.children.map((child) => plan(child, "entry"))];
    let size = 0;
    for (const record of node.records) {
      if ((size % SECTOR) + record.length > SECTOR) size = Math.ceil(size / SECTOR) * SECTOR;
      record.offset = size;
      size += record.length;
    }
    node.extentSize = Math.ceil(size / SECTOR) * SECTOR;
  }

  // Path tables.
  const pathEntry = (node, littleEndian) => {
    const name = node === tree ? Buffer.from([0]) : Buffer.from(node.isoName, "ascii");
    const buffer = Buffer.alloc(8 + name.length + (name.length % 2));
    buffer[0] = name.length;
    if (littleEndian) { buffer.writeUInt32LE(node.lba, 2); buffer.writeUInt16LE(node.parent.number, 6); }
    else { buffer.writeUInt32BE(node.lba, 2); buffer.writeUInt16BE(node.parent.number, 6); }
    name.copy(buffer, 8);
    return buffer;
  };
  const pathTableSize = directories.reduce((sum, node) => sum + 8 + (node === tree ? 1 : node.isoName.length) + ((node === tree ? 1 : node.isoName.length) % 2), 0);
  const pathSectors = Math.ceil(pathTableSize / SECTOR);

  // Layout: descriptors, path tables, continuation areas, directories, files.
  let lba = 18;
  const lPath = lba; lba += pathSectors;
  const mPath = lba; lba += pathSectors;
  for (const block of continuations) block.lba = lba++;
  for (const node of directories) { node.lba = lba; lba += node.extentSize / SECTOR; }
  for (const file of files) { file.lba = file.size === 0 ? 0 : lba; lba += Math.ceil(file.size / SECTOR); }
  const totalSectors = lba;

  const recordBytes = (record) => {
    const buffer = Buffer.alloc(record.length);
    buffer[0] = record.length;
    const node = record.target;
    const isDir = record.isDir;
    const extentLba = isDir ? node.lba : node.lba;
    const extentSize = isDir ? node.extentSize : node.size;
    bothEndian32(buffer, 2, extentLba);
    bothEndian32(buffer, 10, extentSize);
    recordingDate(date).copy(buffer, 18);
    buffer[25] = isDir ? 0x02 : 0;
    bothEndian16(buffer, 28, 1);
    buffer[32] = record.name.length;
    record.name.copy(buffer, 33);
    const suStart = 33 + record.name.length + (record.name.length % 2 === 0 ? 1 : 0);
    let su = record.suArea;
    if (record.continuation) {
      su = Buffer.from(su);
      ceEntry(record.continuation.block.lba, record.continuation.offset, record.extraLength).copy(su, su.length - 28);
    }
    su.copy(buffer, suStart);
    return buffer;
  };

  const fd = openSync(output, "w");
  try {
    ftruncateSync(fd, totalSectors * SECTOR);
    const write = (bytes, position) => writeSync(fd, bytes, 0, bytes.length, position);

    const pvd = Buffer.alloc(SECTOR);
    pvd[0] = 1; pvd.write("CD001", 1, "ascii"); pvd[6] = 1;
    field("", 32).copy(pvd, 8);
    field(volumeId.toUpperCase().replace(/[^A-Z0-9_]/g, "_"), 32).copy(pvd, 40);
    bothEndian32(pvd, 80, totalSectors);
    bothEndian16(pvd, 120, 1); bothEndian16(pvd, 124, 1); bothEndian16(pvd, 128, SECTOR);
    bothEndian32(pvd, 132, pathTableSize);
    pvd.writeUInt32LE(lPath, 140); pvd.writeUInt32BE(mPath, 148);
    recordBytes(tree.records[0]).subarray(0, 34).copy(pvd, 156);
    pvd[156] = 34;
    for (const [offset, length] of [[190, 128], [318, 128], [446, 128], [574, 128], [702, 37], [739, 37], [776, 37]]) field("", length).copy(pvd, offset);
    field("OPEN SOURCE EOC", 128).copy(pvd, 574);
    volumeDate(date).copy(pvd, 813); volumeDate(date).copy(pvd, 830);
    Buffer.from("0000000000000000\0", "ascii").copy(pvd, 847); volumeDate(date).copy(pvd, 864);
    pvd[881] = 1;
    write(pvd, 16 * SECTOR);
    const terminator = Buffer.alloc(SECTOR);
    terminator[0] = 255; terminator.write("CD001", 1, "ascii"); terminator[6] = 1;
    write(terminator, 17 * SECTOR);

    write(Buffer.concat(directories.map((node) => pathEntry(node, true))), lPath * SECTOR);
    write(Buffer.concat(directories.map((node) => pathEntry(node, false))), mPath * SECTOR);
    for (const block of continuations) write(Buffer.concat(block.parts), block.lba * SECTOR);
    for (const node of directories)
      for (const record of node.records) write(recordBytes(record), node.lba * SECTOR + record.offset);

    const chunk = Buffer.alloc(8 * 1024 * 1024);
    for (const file of files) {
      if (file.size === 0) continue;
      if (file.data) { write(file.data, file.lba * SECTOR); continue; }
      const input = openSync(file.source, "r");
      try {
        let position = 0;
        while (position < file.size) {
          const read = readSync(input, chunk, 0, Math.min(chunk.length, file.size - position), position);
          if (read === 0) throw new Error(`${file.source} ended early`);
          writeSync(fd, chunk, 0, read, file.lba * SECTOR + position);
          position += read;
        }
      } finally {
        closeSync(input);
      }
    }
  } finally {
    closeSync(fd);
  }
  return { sectors: totalSectors, bytes: totalSectors * SECTOR, directories: directories.length, files: files.length };
}
