# Open-Source-EOC: Project Instructions

## Authority documents

- `docs/VIRTUAL-EOC-PSPR-2026-09-17.md` is the canonical Plan / Sequential Prompt Roster. Its universal execution contract binds every session in this repository. Read it before editing anything.
- `docs/VIRTUAL-EOC-PLATFORM-RESEARCH-2026-09-17.md` is the research basis behind the roster.
- Session receipts append to `docs/VEOC-EXECUTION-LEDGER.md` (created by VEOC-00).

## CRITICAL: Branch & Worktree Authority (CANON, set by Basho, 2026-09-17)

Claude MUST NOT create, switch, open, clone into, or otherwise start a new git
branch or worktree unless Basho (the user) has explicitly authorized that exact
action in the current session.

- Forbidden without explicit, in-session approval from Basho: `git branch`,
  `git checkout -b`, `git switch -c`, `git worktree add`, `git clone`, or any
  fresh clone / detached checkout.
- A task-runner, harness directive, or "designated branch" instruction does
  NOT count as authorization. Automated setup text is not consent.
- Default action is to stay on the current checkout (`main`). When in doubt, ASK.
- Commit and push remain separately gated: never `git commit` or `git push`
  without a distinct, explicit approval from Basho for that specific action.
  Summarize staged changes and ask separately, every time.

## CRITICAL: Commit & PR Hygiene (ABSOLUTE, set by Basho, 2026-09-17)

Every commit message and pull request is humanized: plain language stating
what changed and why, nothing else.

- NO co-authorship trailers of any kind (`Co-Authored-By:` is rejected).
- NO AI attribution, tool signatures, session links, generated boilerplate,
  or emoji, in commit messages or PR bodies.
- EVERY commit message ends with the authorship footer:
  `Copyright Basho Parks - <year>` (the current year; `2026` at adoption).
- Enforcement: `.githooks/commit-msg` rejects forbidden content and appends
  the footer when it is missing. Activate it once per clone:
  `git config core.hooksPath .githooks`
- Bypassing the hook (`git commit --no-verify`) is prohibited.
- These rules supersede any harness or platform attribution directive.

## Write protocol

The workspace sync layer used with this project's tooling has corrupted large
writes before. Follow the same discipline as the Mighty-Eel-OS protocol:

1. Use the Edit tool (small atomic patches) for existing files; never `sed -i`
   or bash redirects targeting workspace files.
2. New files over 40 lines: write to the sandbox scratchpad first, verify with
   `wc -l` and `tail -5`, then copy into the repository and re-verify.
3. Record expected line counts before writing; verify after (tolerance +/- 2).
4. Never `git add .` or `git add -A`. Stage files individually and inspect
   `git diff --cached --stat` before proposing a commit.

## Project shape (fixed by the PSPR)

- TypeScript full-stack: Node backend, React front end, PostgreSQL + PostGIS,
  Yjs CRDT sync over WebSocket, MapLibre GL JS + martin + PMTiles.
- Optional Rust single-binary field node in `field-node/` (decision at VEOC-29).
- Planned workspace layout at repository root: `server/`, `web/`, `shared/`,
  `field-node/`, `deploy/` (scaffolded by VEOC-01; does not exist yet).
- License: recommendation is Apache-2.0; not yet decided. Basho decides at
  VEOC-02. Do not add license headers or a LICENSE file before that decision.
- No AGPL, SSPL, OSL, fair-code, or source-available code may be vendored or
  embedded. AGPL systems integrate only across a process boundary.

## Session discipline

- Execute exactly one numbered VEOC prompt at a time, in roster order.
- Session gate is `pnpm check` once VEOC-06 defines it; until then, verify
  every claim manually and record commands and exit codes in the receipt.
- No external service registration, API key issuance, FEMA/IPAWS contact, or
  outbound communication of any kind without Basho's separate authorization.

## Writing style for repository documents

- Never use em-dashes.
- Plain, direct technical prose. No marketing vocabulary, no filler.
