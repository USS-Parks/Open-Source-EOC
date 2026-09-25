# Open-Source-EOC: Project Instructions

## Authority documents

- `docs/process/OPERATOR-TRUST-PSPR-2026-09-24.md` is the only live roster and the approved execution authority, approved by Basho 2026-09-24 for STS with full permissions. It supersedes `docs/process/READINESS-PSPR-2026-09-24.md` for every unit not landed; RD receipts keep their numbers.
- `docs/process/FINISH-PSPR-2026-09-22.md` remains the execution contract (commit, ledger and landing discipline) where the live roster does not supersede it. Approved by Basho 2026-09-23.
- `docs/process/archive/` holds the rosters it supersedes. They are read for history, never executed. Each carries a supersession header. The universal execution contract and product invariants of the original roster remain binding where the Finish PSPR does not supersede them.
- `docs/process/VIRTUAL-EOC-PLATFORM-RESEARCH-2026-09-17.md` is the research basis behind the roster and is not superseded.
- Unit receipts append to `docs/process/V1-LEDGER.md`. `docs/process/VEOC-EXECUTION-LEDGER.md` is frozen and historical; nothing is appended to it. Cite a receipt in either by its heading, never by line number.

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
- Commit and push require an explicit grant from Basho scoped to the action,
  roster or session. A plan-wide or session-wide grant recorded in the
  approved PSPR satisfies that requirement for its stated duration. Do not
  repeat an approval request that the active grant already covers.

### Standing grant: fan-out lanes and the zipper (set by Basho, 2026-09-21)

Basho grants Astra and this project the standing ability to fan out work across
git worktrees and lane branches and to zipper that work into `main`, throughout
the project, for as long as the zipper below is kept. Lane worktrees and lane
branches need no per-session or per-wave re-approval. Everything outside this
grant still falls under the rule above.

- Fan-out runs only under a plan Basho has approved for execution. The current
  plan is `docs/process/FINISH-PSPR-2026-09-22.md`; it carries the zipper
  forward where its execution model permits parallel lanes.
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

The earlier execution grants are historical and complete. The Finish PSPR
records the active session's full STS, commit and fast-forward landing
authority, granted by Basho on 2026-09-23. Pushing is Basho's separate
instruction to give; do not publish unfinished lane work. External actions and
user-owned release decisions remain separately gated.

Basho's standing instruction, 2026-09-22: under an active plan-wide grant, do
not ask before a commit, a landing or a push, and do not ask per unit about
decisions the plan already answers with a default. Use the default, record it
in the receipt, keep going. Ask only for external actions and release tagging.

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
  Yjs CRDT sync over WebSocket, MapLibre GL JS and PMTiles. No martin sidecar
  was built.
- `field-node/` is a placeholder Rust field gateway pending V1 unit W1.0.
- The workspace exists at repository root: `server/`, `web/`, `shared/`,
  `field-node/`, `deploy/` and `docs/`.
- License: Apache-2.0, recorded by VEOC-02 and present in `LICENSE`.
- No AGPL, SSPL, OSL, fair-code, or source-available code may be vendored or
  embedded. AGPL systems integrate only across a process boundary.

## Session discipline

### User review gate, 2026-09-21

Basho is the sole final approver of visual quality and functional suitability.
The earlier rosters are technically complete; the Finish PSPR is now the
execution authority. Automated tests and technical reviews are evidence, not
final user acceptance. Canonical design references remain authoritative.

- Execute one numbered prompt at a time, in roster order, unless work is fanned
  out under the standing grant above. Under fan-out, each lane executes one
  unit at a time and work lands on `main` only through the integrating
  session, in dependency order.
- Normal CI runs `pnpm check`. Milestone gates use `pnpm check:gate`, which
  includes the serial Vitest path and the advisory gate. Record the prescribed
  command and result in the receipt; do not add reassurance runs.
- No external service registration, API key issuance, FEMA/IPAWS contact, or
  outbound communication of any kind without Basho's separate authorization.

## Writing style for repository documents

- Never use em-dashes.
- Plain, direct technical prose. No marketing vocabulary, no filler.
