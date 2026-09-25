import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { writeIso } from "./lib/iso9660.mjs";

/** Read an ISO 9660 image back through its Rock Ridge entries, as macOS does: every path with its type, mode, bytes or link. */
function readIso(path) {
  const image = readFileSync(path);
  const sector = (lba) => image.subarray(lba * 2048, (lba + 1) * 2048);
  const pvd = sector(16);
  assert.equal(pvd.toString("ascii", 1, 6), "CD001");
  const entries = (area) => {
    const found = [];
    for (let at = 0; at + 4 <= area.length;) {
      const signature = area.toString("ascii", at, at + 2);
      const length = area[at + 2];
      if (length < 4) break;
      const body = area.subarray(at + 4, at + length);
      found.push({ signature, body });
      if (signature === "CE") {
        const lba = body.readUInt32LE(0);
        const offset = body.readUInt32LE(8);
        found.push(...entries(image.subarray(lba * 2048 + offset, lba * 2048 + offset + body.readUInt32LE(16))));
      }
      at += length;
    }
    return found;
  };
  const records = (lba, size) => {
    const list = [];
    for (let base = lba * 2048; base < lba * 2048 + size; base += 2048) {
      for (let at = base; at < base + 2048 && image[at] > 0;) {
        const length = image[at];
        const record = image.subarray(at, at + length);
        const nameLength = record[32];
        const suStart = 33 + nameLength + (nameLength % 2 === 0 ? 1 : 0);
        list.push({ lba: record.readUInt32LE(2), size: record.readUInt32LE(10), dir: (record[25] & 2) !== 0, id: record.subarray(33, 33 + nameLength), su: entries(record.subarray(suStart, length)) });
        at += length;
      }
    }
    return list;
  };
  const tree = new Map();
  const walk = (lba, size, prefix) => {
    for (const record of records(lba, size)) {
      if (record.id.length === 1 && record.id[0] <= 1) continue;
      const name = record.su.find((item) => item.signature === "NM").body.subarray(1).toString("utf8");
      const mode = record.su.find((item) => item.signature === "PX").body.readUInt32LE(0);
      const link = record.su.find((item) => item.signature === "SL");
      const path = prefix ? `${prefix}/${name}` : name;
      if (link) {
        let target = "";
        const body = link.body.subarray(1);
        for (let at = 0; at < body.length; at += 2 + body[at + 1]) {
          if (body[at] & 0x08) target = "/";
          else target += `${target && !target.endsWith("/") ? "/" : ""}${body.toString("utf8", at + 2, at + 2 + body[at + 1])}`;
        }
        tree.set(path, { type: "symlink", mode, target });
      } else if (record.dir) {
        tree.set(path, { type: "dir", mode });
        walk(record.lba, record.size, path);
      } else tree.set(path, { type: "file", mode, bytes: image.subarray(record.lba * 2048, record.lba * 2048 + record.size) });
    }
  };
  const rootLba = pvd.readUInt32LE(158);
  const rootSize = pvd.readUInt32LE(166);
  const rootSelf = records(rootLba, rootSize)[0];
  walk(rootLba, rootSize, "");
  return { tree, rootSelf, volumeId: pvd.toString("ascii", 40, 72).trim() };
}

test("a disk image keeps names, permissions, links and bytes through Rock Ridge", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "openeoc-iso-"));
  try {
    const big = resolve(root, "big.bin");
    const bigBytes = Buffer.alloc(5_000_123, 7);
    bigBytes.write("start", 0); bigBytes.write("end", bigBytes.length - 3);
    writeFileSync(big, bigBytes);
    const many = Array.from({ length: 300 }, (_, index) => ({ name: `file-${String(index).padStart(3, "0")}.txt`, type: "file", data: Buffer.from(`file ${index}`) }));
    const longName = `${"a-rather-long-name-".repeat(10)}end.txt`;
    const tree = { type: "dir", children: [
      { name: "Open Source EOC.app", type: "dir", children: [{ name: "Contents", type: "dir", children: [
        { name: "Info.plist", type: "file", data: Buffer.from("<plist/>") },
        { name: "MacOS", type: "dir", children: [{ name: "Open Source EOC", type: "file", mode: 0o100755, data: Buffer.from("#!/bin/bash\necho ready\n") }] },
      ] }] },
      { name: "Applications", type: "symlink", target: "/Applications" },
      { name: "READ-ME-FIRST.txt", type: "file", data: Buffer.from("read me") },
      { name: "many", type: "dir", children: many },
      { name: longName, type: "file", data: Buffer.from("long") },
      { name: "big.bin", type: "file", source: big },
      { name: "empty", type: "file", data: Buffer.alloc(0) },
    ] };
    const output = resolve(root, "image.dmg");
    const written = await writeIso({ tree, output, volumeId: "Open Source EOC 0.9.2" });
    assert.equal(readFileSync(output).length, written.bytes);

    const { tree: read, rootSelf, volumeId } = readIso(output);
    assert.equal(volumeId, "OPEN_SOURCE_EOC_0_9_2");
    assert.equal(rootSelf.su[0].signature, "SP", "SP opens the root's system use area");
    assert.ok(rootSelf.su.some((item) => item.signature === "ER" && item.body.includes(Buffer.from("RRIP_1991A"))));
    const launcher = read.get("Open Source EOC.app/Contents/MacOS/Open Source EOC");
    assert.equal(launcher.mode, 0o100755);
    assert.equal(launcher.bytes.toString(), "#!/bin/bash\necho ready\n");
    assert.equal(read.get("Open Source EOC.app/Contents/Info.plist").mode, 0o100644);
    assert.equal(read.get("Open Source EOC.app").mode, 0o040755);
    assert.deepEqual(read.get("Applications"), { type: "symlink", mode: 0o120777, target: "/Applications" });
    assert.equal(read.get(longName).bytes.toString(), "long");
    assert.equal(Buffer.compare(read.get("big.bin").bytes, bigBytes), 0);
    assert.equal(read.get("empty").bytes.length, 0);
    for (let index = 0; index < 300; index += 1)
      assert.equal(read.get(`many/file-${String(index).padStart(3, "0")}.txt`).bytes.toString(), `file ${index}`);
    assert.equal([...read.keys()].length, 311);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
