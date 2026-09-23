import { closeSync, existsSync, fstatSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs";

export const LOG_MAX_BYTES = 10 * 1024 * 1024;
export const LOG_KEEP = 5;

// name -> name.1 -> name.2 ... and the oldest past `keep` is removed.
function rotate(path, keep) {
  rmSync(`${path}.${keep}`, { force: true });
  for (let i = keep - 1; i >= 1; i -= 1) {
    if (existsSync(`${path}.${i}`)) renameSync(`${path}.${i}`, `${path}.${i + 1}`);
  }
  renameSync(path, `${path}.1`);
}

/** Rotate a log another process writes, before that process opens it. */
export function rotateIfLarger(path, maxBytes = LOG_MAX_BYTES, keep = LOG_KEEP) {
  if (existsSync(path) && statSync(path).size > maxBytes) rotate(path, keep);
}

/**
 * An append-only log the server writes itself, rotated by size while it runs.
 * Writes are synchronous so a crash loses nothing already logged.
 */
export function rotatingLog(path, maxBytes = LOG_MAX_BYTES, keep = LOG_KEEP) {
  let fd = openSync(path, "a");
  let size = fstatSync(fd).size;
  return {
    write(line) {
      const bytes = Buffer.byteLength(line);
      if (size > 0 && size + bytes > maxBytes) {
        closeSync(fd);
        rotate(path, keep);
        fd = openSync(path, "a");
        size = 0;
      }
      writeSync(fd, line);
      size += bytes;
    },
  };
}
