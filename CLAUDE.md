# Open-Source-EOC: Project Instructions

## Authority documents

- `docs/MASTER-PSPR-2026-09-21.md` is the approved execution plan for the remaining parity roster and the design roster: order, ownership, delegation and landing. The continuation roster table and the Design PSPR keep the binding acceptance wording.
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

### Standing grant: fan-out lanes and the zipper (set by Basho, 2026-09-21)

Basho grants Astra and this project the standing ability to fan out work across
git worktrees and lane branches and to zipper that work into `main`, throughout
the project, for as long as the zipper below is kept. Lane worktrees and lane
branches need no per-session or per-wave re-approval. Everything outside this
grant still falls under the rule above.

- Fan-out runs only under a plan Basho has approved for execution. The current
  plan is `docs/MASTER-PSPR-2026-09-21.md`; its section 7.5 defines the zipper
  in full.
- Scope: branches named `lane/*` and their worktrees, created by the
  integrating session outside the canonical checkout, and their removal once
  their work is on `main`. Lane branches are local and are never pushed.
- The zipper is the condition of the grant. `main` moves only by fast-forward
  to exact commits Basho has approved, one landing at a time, by the
  integrating session alone. No merge commits anywhere; `main` is never merged
  into a lane (lanes rebase). No two units in flight own the same file. Every
  unit starts from current `main`. Sub-agents use git read-only.
- A broken zipper suspends this grant until Basho restores it: stop launching
  lanes and report.
- Unchanged: commit and push stay separately gated exactly as above. For lane
  work only, this grant supersedes "no new branch or worktree" and "one prompt
  at a time" in the older roster documents.

## CRITICAL: Commit & PR Hygiene (ABSOLUTE, set by Basho, 2026-09-17)

Standing execution grant, 2026-09-21: in the Master PSPR execution session,
Basho approved W0.0 and subsequent commits and fast-forward landings that pass
their prescribed gates. This overrides per-commit asks for this approved
roster. Push, external-action and G-A design-review gates remain separate.

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

- Execute one numbered prompt at a time, in roster order, unless work is fanned
  out under the standing grant above. Under fan-out, each lane executes one
  unit at a time and work lands on `main` only through the integrating
  session, in dependency order.
- Session gate is `pnpm check` once VEOC-06 defines it; until then, verify
  every claim manually and record commands and exit codes in the receipt.
- No external service registration, API key issuance, FEMA/IPAWS contact, or
  outbound communication of any kind without Basho's separate authorization.

## Writing style for repository documents

- Never use em-dashes.
- Plain, direct technical prose. No marketing vocabulary, no filler.
