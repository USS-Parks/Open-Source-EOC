/**
 * XLSForm / ODK-XForms expression engine (F7). A focused,
 * conformant subset of the XPath-flavored expression language used in
 * `relevant`, `constraint`, and `calculation` columns: variable
 * references `${name}`, the XForms operators (`=` `!=` `<` `<=` `>` `>=`
 * `+` `-` `*` `div` `mod` `and` `or`), and the functions the FEMA PDA
 * templates actually use. Pure and synchronous, so it runs offline and
 * is exhaustively unit-tested against conformance fixtures.
 */

export type Scalar = string | number | boolean | null;
export type Bindings = Readonly<Record<string, Scalar>>;

export class ExprError extends Error {}

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "var"; v: string }
  | { t: "name"; v: string }
  | { t: "op"; v: string }
  | { t: "lparen" }
  | { t: "rparen" }
  | { t: "comma" };

const WORD_OPS = new Set(["div", "mod", "and", "or"]);

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === "$" && src[i + 1] === "{") {
      const end = src.indexOf("}", i + 2);
      if (end < 0) throw new ExprError("unterminated ${ reference");
      toks.push({ t: "var", v: src.slice(i + 2, end).trim() });
      i = end + 1;
      continue;
    }
    if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new ExprError("unterminated string literal");
      toks.push({ t: "str", v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (c >= "0" && c <= "9") {
      let j = i + 1;
      while (j < n && ((src[j]! >= "0" && src[j]! <= "9") || src[j] === ".")) j++;
      toks.push({ t: "num", v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (c === "(") {
      toks.push({ t: "lparen" });
      i++;
      continue;
    }
    if (c === ")") {
      toks.push({ t: "rparen" });
      i++;
      continue;
    }
    if (c === ",") {
      toks.push({ t: "comma" });
      i++;
      continue;
    }
    // Two-char operators first.
    const two = src.slice(i, i + 2);
    if (two === "!=" || two === "<=" || two === ">=") {
      toks.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if (c === "=" || c === "<" || c === ">" || c === "+" || c === "-" || c === "*") {
      toks.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_-]/.test(src[j]!)) j++;
      const word = src.slice(i, j);
      if (WORD_OPS.has(word)) toks.push({ t: "op", v: word });
      else toks.push({ t: "name", v: word });
      i = j;
      continue;
    }
    throw new ExprError(`unexpected character '${c}' at ${i}`);
  }
  return toks;
}

type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "var"; v: string }
  | { k: "bin"; op: string; l: Node; r: Node }
  | { k: "neg"; e: Node }
  | { k: "call"; name: string; args: Node[] };

/** Precedence-climbing parser over the token stream. */
class Parser {
  private pos = 0;
  constructor(private readonly toks: Tok[]) {}

  parse(): Node {
    const node = this.parseOr();
    if (this.pos !== this.toks.length) throw new ExprError("trailing tokens in expression");
    return node;
  }

  private peek(): Tok | undefined {
    return this.toks[this.pos];
  }

  private eat(): Tok {
    const t = this.toks[this.pos];
    if (!t) throw new ExprError("unexpected end of expression");
    this.pos++;
    return t;
  }

  private isOp(v: string): boolean {
    const t = this.peek();
    return !!t && t.t === "op" && t.v === v;
  }

  private binaryLevel(ops: string[], next: () => Node): Node {
    let left = next();
    while (this.peek()?.t === "op" && ops.includes((this.peek() as { v: string }).v)) {
      const op = (this.eat() as { v: string }).v;
      left = { k: "bin", op, l: left, r: next() };
    }
    return left;
  }

  private parseOr(): Node {
    return this.binaryLevel(["or"], () => this.parseAnd());
  }
  private parseAnd(): Node {
    return this.binaryLevel(["and"], () => this.parseEquality());
  }
  private parseEquality(): Node {
    return this.binaryLevel(["=", "!="], () => this.parseRelational());
  }
  private parseRelational(): Node {
    return this.binaryLevel(["<", "<=", ">", ">="], () => this.parseAdditive());
  }
  private parseAdditive(): Node {
    return this.binaryLevel(["+", "-"], () => this.parseMultiplicative());
  }
  private parseMultiplicative(): Node {
    return this.binaryLevel(["*", "div", "mod"], () => this.parseUnary());
  }

  private parseUnary(): Node {
    if (this.isOp("-")) {
      this.eat();
      return { k: "neg", e: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const t = this.eat();
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "str") return { k: "str", v: t.v };
    if (t.t === "var") return { k: "var", v: t.v };
    if (t.t === "lparen") {
      const e = this.parseOr();
      if (this.eat().t !== "rparen") throw new ExprError("expected )");
      return e;
    }
    if (t.t === "name") {
      if (this.peek()?.t !== "lparen") throw new ExprError(`bare name '${t.v}' (expected a call)`);
      this.eat(); // (
      const args: Node[] = [];
      if (this.peek()?.t !== "rparen") {
        args.push(this.parseOr());
        while (this.peek()?.t === "comma") {
          this.eat();
          args.push(this.parseOr());
        }
      }
      if (this.eat().t !== "rparen") throw new ExprError("expected ) after arguments");
      return { k: "call", name: t.v, args };
    }
    throw new ExprError("unexpected token in expression");
  }
}

function toNum(v: Scalar): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null || v === "") return NaN;
  return Number(v);
}

function toBool(v: Scalar): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  if (v === null) return false;
  if (v === "true") return true;
  if (v === "false") return false;
  return v !== "";
}

function toStr(v: Scalar): string {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function equals(a: Scalar, b: Scalar): boolean {
  if (typeof a === "number" || typeof b === "number") {
    const na = toNum(a);
    const nb = toNum(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  }
  if (typeof a === "boolean" || typeof b === "boolean") return toBool(a) === toBool(b);
  return toStr(a) === toStr(b);
}

const FUNCS: Record<string, (args: Scalar[]) => Scalar> = {
  if: (a) => (toBool(a[0] ?? null) ? (a[1] ?? null) : (a[2] ?? null)),
  not: (a) => !toBool(a[0] ?? null),
  coalesce: (a) => {
    for (const v of a) if (v !== null && v !== "") return v;
    return "";
  },
  selected: (a) => {
    const haystack = toStr(a[0] ?? null).split(/\s+/).filter(Boolean);
    return haystack.includes(toStr(a[1] ?? null));
  },
  "count-selected": (a) => toStr(a[0] ?? null).split(/\s+/).filter(Boolean).length,
  "string-length": (a) => toStr(a[0] ?? null).length,
  number: (a) => toNum(a[0] ?? null),
  int: (a) => Math.trunc(toNum(a[0] ?? null)),
  round: (a) => {
    const places = a.length > 1 ? Math.trunc(toNum(a[1]!)) : 0;
    const f = 10 ** places;
    return Math.round(toNum(a[0] ?? null) * f) / f;
  },
  concat: (a) => a.map(toStr).join(""),
  "true": () => true,
  "false": () => false,
};

function evalNode(node: Node, bindings: Bindings): Scalar {
  switch (node.k) {
    case "num":
      return node.v;
    case "str":
      return node.v;
    case "var": {
      const v = bindings[node.v];
      return v === undefined ? null : v;
    }
    case "neg":
      return -toNum(evalNode(node.e, bindings));
    case "call": {
      const fn = FUNCS[node.name];
      if (!fn) throw new ExprError(`unsupported function '${node.name}()'`);
      return fn(node.args.map((a) => evalNode(a, bindings)));
    }
    case "bin": {
      const op = node.op;
      if (op === "and") return toBool(evalNode(node.l, bindings)) && toBool(evalNode(node.r, bindings));
      if (op === "or") return toBool(evalNode(node.l, bindings)) || toBool(evalNode(node.r, bindings));
      const l = evalNode(node.l, bindings);
      const r = evalNode(node.r, bindings);
      switch (op) {
        case "=":
          return equals(l, r);
        case "!=":
          return !equals(l, r);
        case "<":
          return toNum(l) < toNum(r);
        case "<=":
          return toNum(l) <= toNum(r);
        case ">":
          return toNum(l) > toNum(r);
        case ">=":
          return toNum(l) >= toNum(r);
        case "+":
          return toNum(l) + toNum(r);
        case "-":
          return toNum(l) - toNum(r);
        case "*":
          return toNum(l) * toNum(r);
        case "div": {
          const d = toNum(r);
          return d === 0 ? NaN : toNum(l) / d;
        }
        case "mod": {
          const d = toNum(r);
          return d === 0 ? NaN : toNum(l) % d;
        }
        default:
          throw new ExprError(`unknown operator '${op}'`);
      }
    }
  }
}

const cache = new Map<string, Node>();

function compile(src: string): Node {
  const cached = cache.get(src);
  if (cached) return cached;
  const node = new Parser(tokenize(src)).parse();
  cache.set(src, node);
  return node;
}

/** Evaluate an expression to its raw scalar. */
export function evaluate(src: string, bindings: Bindings): Scalar {
  return evalNode(compile(src), bindings);
}

/** Evaluate to a boolean (for `relevant` and `constraint`). Empty = true. */
export function evaluateBool(src: string | undefined | null, bindings: Bindings): boolean {
  if (!src || !src.trim()) return true;
  return toBool(evaluate(src, bindings));
}
