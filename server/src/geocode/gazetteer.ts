import { readFileSync } from "node:fs";
import { expandToken, foldTokens, GAZETTEER_HEADER, searchKey } from "./normalize.js";

/**
 * The offline gazetteer: places, streets with their house numbers, and
 * points of interest, built from the street basemap archive by
 * tools/basemap/build-gazetteer.mjs. The file stays in memory as bytes;
 * search keys, kinds and coordinates are indexed, and names, contexts and
 * house numbers are read back from the bytes only for the entries a search
 * returns.
 */

export type GeocodeKind = "address" | "street" | "place" | "poi";

export interface GeocodeResult {
  readonly kind: GeocodeKind;
  readonly label: string;
  readonly detail: string;
  readonly lon: number;
  readonly lat: number;
  /** The map zoom that frames the result. */
  readonly zoom: number;
}

export interface GeocodeOptions {
  readonly limit: number;
  /** Ties between equally good matches go to the nearest, when given. */
  readonly near?: readonly [number, number] | undefined;
}

const STREET = 0;
const PLACE = 1;
const POI = 2;
const KINDS: Readonly<Record<string, number>> = { street: STREET, place: PLACE, poi: POI };
/** Among equally good matches: places, then streets, then points of interest. */
const KIND_ORDER = [1, 0, 2];
const PLACE_RANK: Readonly<Record<string, number>> = {
  city: 0, county: 1, town: 1, village: 2, suburb: 3, hamlet: 3, quarter: 4, neighbourhood: 4,
};
const PLACE_ZOOM: Readonly<Record<string, number>> = {
  county: 9, city: 12, town: 13, village: 14, suburb: 14, hamlet: 15, quarter: 15, neighbourhood: 15,
};
/** Candidates examined per search; only a one- or two-letter query reaches it. */
const MAX_CANDIDATES = 5000;

interface Scored {
  readonly result: GeocodeResult;
  readonly rank: readonly number[];
}

export class Gazetteer {
  readonly size: number;
  private readonly bytes: Buffer;
  /** Byte offset of each entry's line. */
  private readonly starts: Uint32Array;
  private readonly kinds: Uint8Array;
  private readonly importance: Uint8Array;
  private readonly lons: Float64Array;
  private readonly lats: Float64Array;
  /** Search keys with a leading space, so " " + prefix finds a word start. */
  private readonly keys: string[];
  /** The nearby settlement's key, the same way, so "3rd st eureka" narrows a street. */
  private readonly contexts: string[];
  /** Distinct key and context words, sorted, with their entry postings in CSR form. */
  private readonly words: string[];
  private readonly wordOffsets: Uint32Array;
  private readonly postings: Uint32Array;
  private readonly seen: Uint32Array;
  private stamp = 0;

  constructor(bytes: Buffer) {
    const headerEnd = bytes.indexOf(10);
    if (headerEnd < 0 || !bytes.toString("utf8", 0, headerEnd).startsWith(GAZETTEER_HEADER)) {
      throw new Error("not an OpenEOC gazetteer (format 1)");
    }
    this.bytes = bytes;
    const starts: number[] = [];
    const kinds: number[] = [];
    const importance: number[] = [];
    const lons: number[] = [];
    const lats: number[] = [];
    const keys: string[] = [];
    const contexts: string[] = [];
    const contextKeys = new Map<string, string>();
    const byWord = new Map<string, number[]>();
    for (let pos = headerEnd + 1; pos < bytes.length;) {
      const newline = bytes.indexOf(10, pos);
      const end = newline < 0 ? bytes.length : newline;
      if (end > pos) {
        const tabs: number[] = [];
        for (let at = pos; tabs.length < 7; at += 1) {
          at = bytes.indexOf(9, at);
          if (at < 0 || at > end) throw new Error(`malformed gazetteer line at byte ${pos}`);
          tabs.push(at);
        }
        const kind = KINDS[bytes.toString("latin1", pos, tabs[0])];
        const lon = Number(bytes.toString("latin1", tabs[3]! + 1, tabs[4]));
        const lat = Number(bytes.toString("latin1", tabs[4]! + 1, tabs[5]));
        const key = bytes.toString("utf8", tabs[5]! + 1, tabs[6]);
        if (kind === undefined || !Number.isFinite(lon) || !Number.isFinite(lat) || !key) {
          throw new Error(`malformed gazetteer line at byte ${pos}`);
        }
        const id = starts.length;
        starts.push(pos);
        kinds.push(kind);
        importance.push(kind === PLACE ? PLACE_RANK[bytes.toString("utf8", tabs[1]! + 1, tabs[2])] ?? 5 : 0);
        lons.push(lon);
        lats.push(lat);
        keys.push(` ${key}`);
        const context = bytes.toString("utf8", tabs[2]! + 1, tabs[3]);
        let contextKey = contextKeys.get(context);
        if (contextKey === undefined) contextKeys.set(context, (contextKey = ` ${searchKey(context)}`));
        contexts.push(contextKey);
        for (const word of new Set(`${key}${contextKey}`.split(" ").filter(Boolean))) {
          const list = byWord.get(word);
          if (list) list.push(id);
          else byWord.set(word, [id]);
        }
      }
      pos = end + 1;
    }
    this.size = starts.length;
    this.starts = Uint32Array.from(starts);
    this.kinds = Uint8Array.from(kinds);
    this.importance = Uint8Array.from(importance);
    this.lons = Float64Array.from(lons);
    this.lats = Float64Array.from(lats);
    this.keys = keys;
    this.contexts = contexts;
    this.words = [...byWord.keys()].sort();
    this.wordOffsets = new Uint32Array(this.words.length + 1);
    this.postings = new Uint32Array(this.words.reduce((sum, word) => sum + byWord.get(word)!.length, 0));
    let at = 0;
    this.words.forEach((word, i) => {
      this.wordOffsets[i] = at;
      for (const id of byWord.get(word)!) this.postings[at++] = id;
    });
    this.wordOffsets[this.words.length] = at;
    this.seen = new Uint32Array(this.size);
  }

  static load(path: string): Gazetteer {
    return new Gazetteer(readFileSync(path));
  }

  /**
   * Forward search. A leading number is read as a house number on the
   * streets the rest of the query names. Ranked: an exact house number on a
   * matching street first; then by how closely the name matches, with
   * places before streets before points of interest among equal matches;
   * then larger places, then nearness; last, the streets a house number was
   * looked for on.
   */
  search(query: string, options: GeocodeOptions): GeocodeResult[] {
    const words = foldTokens(query).slice(0, 8);
    if (words.length === 0) return [];
    const scored = new Map<string, Scored>();
    const add = (key: string, result: GeocodeResult, rank: readonly number[]) => {
      if (!scored.has(key)) scored.set(key, { result, rank });
    };
    const number = words.length > 1 && /^\d+[a-z]?$/.test(words[0]!) ? words[0]! : null;
    const rest = words.slice(1);
    const streets = number ? this.match(rest).filter((id) => this.kinds[id] === STREET) : [];
    for (const id of streets) {
      const address = this.address(id, number!);
      if (address) {
        add(`a${id}`, address, [0, this.quality(id, rest), 0, 0, this.distance(id, options.near)]);
      }
    }
    for (const id of this.match(words)) {
      add(`e${id}`, this.result(id), [
        1, this.quality(id, words), KIND_ORDER[this.kinds[id]!]!, this.importance[id]!, this.distance(id, options.near),
      ]);
    }
    // The street itself follows, so a house number the data lacks still finds its street.
    for (const id of streets) add(`e${id}`, this.result(id), [2, this.quality(id, rest), 0, 0, this.distance(id, options.near)]);
    return [...scored.values()]
      .sort((a, b) => {
        for (let i = 0; i < a.rank.length; i += 1) {
          const d = a.rank[i]! - b.rank[i]!;
          if (d !== 0) return d;
        }
        return a.result.label.length - b.result.label.length;
      })
      .slice(0, options.limit)
      .map((s) => s.result);
  }

  /**
   * Entries with a word starting with each query word, or with its
   * expansion, in their key or their settlement; at least one in the key.
   */
  private match(words: readonly string[]): number[] {
    if (words.length === 0) return [];
    const alternatives = words.map((word) => [...new Set([word, expandToken(word)])]);
    // Walk the postings of the query word with the fewest, checking the rest by key and settlement.
    let lead = 0;
    let leadRanges: Array<[number, number]> = [];
    let leadCount = Infinity;
    alternatives.forEach((alts, i) => {
      const ranges = alts.map((alt) => this.prefixRange(alt));
      const count = ranges.reduce((sum, [from, to]) => sum + this.wordOffsets[to]! - this.wordOffsets[from]!, 0);
      if (count < leadCount) [lead, leadRanges, leadCount] = [i, ranges, count];
    });
    if (this.stamp === 0xffffffff) {
      this.seen.fill(0);
      this.stamp = 0;
    }
    const stamp = ++this.stamp;
    const found: number[] = [];
    for (const [from, to] of leadRanges) {
      for (let p = this.wordOffsets[from]!; p < this.wordOffsets[to]!; p += 1) {
        const id = this.postings[p]!;
        if (this.seen[id] === stamp) continue;
        this.seen[id] = stamp;
        const key = this.keys[id]!;
        const context = this.contexts[id]!;
        let named = false;
        const all = alternatives.every((alts, i) => {
          const inKey = alts.some((alt) => key.includes(` ${alt}`));
          named ||= inKey;
          return inKey || i === lead || alts.some((alt) => context.includes(` ${alt}`));
        });
        if (all && named && found.push(id) >= MAX_CANDIDATES) return found;
      }
    }
    return found;
  }

  /** [from, to) indexes of the sorted words that start with prefix. */
  private prefixRange(prefix: string): [number, number] {
    const lowerBound = (target: string) => {
      let lo = 0;
      let hi = this.words.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (this.words[mid]! < target) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    return [lowerBound(prefix), lowerBound(`${prefix}￿`)];
  }

  /**
   * How closely the name matches the query words it holds (words naming the
   * settlement are left out): 0 when the key is those words, 1 when it
   * starts with them, 2 otherwise.
   */
  private quality(id: number, words: readonly string[]): number {
    const key = this.keys[id]!;
    const named = words.filter((word) => key.includes(` ${word}`) || key.includes(` ${expandToken(word)}`));
    const exact = ` ${named.map(expandToken).join(" ")}`;
    return key === exact ? 0 : key.startsWith(exact) ? 1 : 2;
  }

  private distance(id: number, near: GeocodeOptions["near"]): number {
    if (!near) return 0;
    const dx = (this.lons[id]! - near[0]) * Math.cos((near[1] * Math.PI) / 180);
    return dx * dx + (this.lats[id]! - near[1]) ** 2;
  }

  /** kind, name, class, context, lon, lat, key, addresses */
  private columns(id: number): string[] {
    const start = this.starts[id]!;
    const newline = this.bytes.indexOf(10, start);
    return this.bytes.toString("utf8", start, newline < 0 ? this.bytes.length : newline).split("\t");
  }

  private result(id: number): GeocodeResult {
    const [, name = "", cls = "", context = ""] = this.columns(id);
    const kind = this.kinds[id]!;
    const what = cls.replaceAll("_", " ");
    return {
      kind: kind === STREET ? "street" : kind === PLACE ? "place" : "poi",
      label: name,
      detail: kind === PLACE ? what : kind === POI ? [what, context].filter(Boolean).join(", ") : context,
      lon: this.lons[id]!,
      lat: this.lats[id]!,
      zoom: kind === STREET ? 16 : kind === PLACE ? PLACE_ZOOM[cls] ?? 14 : 17,
    };
  }

  private address(id: number, number: string): GeocodeResult | null {
    const [, name = "", , context = "", , , , addresses = ""] = this.columns(id);
    for (const address of addresses.split(";")) {
      const [value = "", lon, lat] = address.split(",");
      if (!foldTokens(value).includes(number)) continue;
      return { kind: "address", label: `${value} ${name}`, detail: context, lon: Number(lon), lat: Number(lat), zoom: 18 };
    }
    return null;
  }
}
