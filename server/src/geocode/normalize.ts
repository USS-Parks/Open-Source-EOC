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
 * half-typed word still prefix-matches ("mou" finds "Mt Shasta").
 * ponytail: "st" always reads as street, so "St Helena" keys as "street
 * helena"; a query for it normalizes the same way. Add saint handling if
 * operators search saints by the full word.
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
  return foldTokens(text).map(expandToken).join(" ");
}
