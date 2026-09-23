import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * Where webhook and push channels may send. Each jurisdiction keeps a list of
 * destinations; with no list, nothing external is reachable. An entry is an
 * exact origin (`https://hooks.example.org:8443`) or a host suffix
 * (`*.example.org`, https only). Plain http is accepted only for a loopback
 * origin named exactly.
 *
 * A host admitted only by a suffix must resolve to public addresses: a
 * private, loopback or link-local address is reachable only through an
 * exact-origin entry that names its host.
 */

export type Resolve = (host: string) => Promise<readonly { address: string; family: number }[]>;

const loopback = new BlockList();
loopback.addSubnet("127.0.0.0", 8, "ipv4");
loopback.addAddress("::1", "ipv6");

// BlockList also matches IPv4-mapped IPv6 addresses against the IPv4 ranges.
const internal = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 3],
] as const) {
  internal.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 127],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  internal.addSubnet(net, prefix, "ipv6");
}

function inRange(list: BlockList, address: string): boolean {
  const family = isIP(address);
  return family !== 0 && list.check(address, family === 4 ? "ipv4" : "ipv6");
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "");
  return host === "localhost" || inRange(loopback, host);
}

/** The stored form of an allowlist entry, or null when the text is not one. */
export function normalizeEntry(raw: string): string | null {
  const suffix = /^\*\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i.exec(raw.trim());
  if (suffix) return `*.${suffix[1]!.toLowerCase()}`;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) return url.origin;
  return null;
}

/** How the list admits a target URL: by exact origin, by host suffix, or not at all. */
export function admittedBy(entries: readonly string[], target: string): "origin" | "suffix" | null {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  if (entries.includes(url.origin)) return "origin";
  const suffixed = entries.some(
    (e) => e.startsWith("*.") && url.protocol === "https:" && url.hostname.endsWith(e.slice(1)),
  );
  return suffixed ? "suffix" : null;
}

/** Why a delivery to `target` is refused, or null when it may be sent. */
export async function destinationRefusal(
  entries: readonly string[],
  target: string,
  resolve: Resolve = (host) => lookup(host, { all: true }),
): Promise<string | null> {
  const admitted = admittedBy(entries, target);
  if (!admitted) return "destination is not on the jurisdiction's notification allowlist";
  if (admitted === "origin") return null;
  // ponytail: fetch resolves the host again, so a rebinding DNS server can
  // answer differently in between; pin the checked address in a custom
  // dispatcher if that window matters.
  const addresses = await resolve(new URL(target).hostname).catch(() => []);
  return addresses.some((a) => inRange(internal, a.address))
    ? "destination resolves to a private address that no exact allowlist entry names"
    : null;
}
