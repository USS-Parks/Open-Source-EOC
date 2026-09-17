# ADR-0004: Plugin sandbox is QuickJS compiled to WebAssembly

Status: accepted, 2026-09-17 (VEOC-04)

## Decision

The board/plugin escape hatch (INV-6) executes untrusted extension code in
QuickJS compiled to WebAssembly (quickjs-emscripten class), with:

- no ambient authority: plugins receive only the capability objects the
  host passes in (read this board, emit this event);
- hard CPU and memory quotas per invocation, kill on breach;
- the same sandbox on server and browser, so one plugin runs both places.

## Alternatives considered

- **isolated-vm:** true V8 isolates, strong isolation, but a native module
  that must compile against each Node version: an install-time failure
  source on county hardware, and server-only (no browser story).
- **Node `vm` module:** not a security boundary at all; disqualified.
- **Raw WASM-only plugins:** strongest isolation but forces plugin authors
  into compiled languages; the audience writes JavaScript.

## Grounds

Plugin authors are jurisdiction IT staff writing small board behaviors.
JS-in-WASM keeps authoring accessible while making escape a WASM-boundary
problem rather than a JS-semantics problem.

## Reversal cost

Low before VEOC-10 ships the designer, moderate after: the capability API
is the contract, the engine behind it is replaceable.
