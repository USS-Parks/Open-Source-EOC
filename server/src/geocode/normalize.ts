/**
 * The gazetteer format header and the one search-key normalization, shared
 * by the gazetteer builder (tools/basemap/build-gazetteer.mjs imports this
 * file) and the search route, so a built key and a typed query compare
 * alike. Erasable TypeScript only: Node runs this file directly when the
 * builder imports it.
 */

/** First line of a gazetteer file; the build time follows it after a tab. */
export const GAZETTEER_HEADER = "#openeoc-gazetteer\t1";

/**
 * Street and place abbreviations, expanded rather than contracted so a
 * half-typed word still prefix-matches ("mou" finds "Mt Shasta"). "St" is
 * street, except as the first of several words, where it is saint: "St
 * Helena" keys as "saint helena" and "3rd St" as "3rd street".
 */
const EXPANSIONS: Readonly<Record<string, string>> = {
  av: "avenue", ave: "avenue", blvd: "boulevard", cir: "circle", ct: "court", dr: "drive",
  e: "east", expy: "expressway", ft: "fort", fwy: "freeway", hwy: "highway", ln: "lane",
  mt: "mount", n: "north", ne: "northeast", nw: "northwest", pkwy: "parkway", pl: "place",
  rd: "road", rte: "route", s: "south", se: "southeast", sq: "square", st: "street",
  sw: "southwest", ter: "terrace", trl: "trail", w: "west",
};

/** Lowercase words with accents and punctuation removed; apostrophes join. */
export function foldTokens(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function expandToken(word: string): string {
  return EXPANSIONS[word] ?? word;
}

/** The stored search key: folded words with abbreviations expanded. */
export function searchKey(text: string): string {
  const words = foldTokens(text);
  return words.map((word, i) => (word === "st" && i === 0 && words.length > 1 ? "saint" : expandToken(word))).join(" ");
}

/** The words a typed word may stand for in a key, the expansion first. */
export function wordAlternatives(word: string): string[] {
  return [...new Set([expandToken(word), ...(word === "st" ? ["saint"] : []), word])];
}
