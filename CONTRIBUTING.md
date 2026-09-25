# Contributing

Thanks for considering a contribution. This project is governed by the build
roster in `docs/process/FINISH-PSPR-2026-09-22.md`; work that lands must fit a
roster unit or be agreed with the lead maintainer first.

Report security vulnerabilities privately, as [SECURITY.md](SECURITY.md) says.

## Setup

Requires Node 22+ and pnpm 10+. Then:

    pnpm install
    git config core.hooksPath .githooks
    pnpm check

`pnpm check` must be green before any commit is proposed.

## Rules that are not negotiable

1. **Certify your right to contribute.** External contributions must carry a
   Developer Certificate of Origin sign-off (`git commit -s`, DCO 1.1, see
   developercertificate.org). You retain copyright in your contribution; you
   license it to the project under Apache-2.0 (see LICENSE, section 5).
2. **Commit messages are plain language.** What changed and why, nothing
   else. No AI attribution, tool signatures, session links, boilerplate, or
   emoji. The commit-msg hook enforces this and appends the project
   stewardship footer; do not bypass it with --no-verify.
3. **License hygiene.** No AGPL, SSPL, OSL, fair-code, or source-available
   code may be vendored or embedded. The license scan in `pnpm check` blocks
   known-bad dependency licenses (among them the Functional Source, Fair Use,
   Fair Core, Business Source, PolyForm, Elastic, Camunda, Carbone community
   and Open WebUI licenses) and must stay green. A dependency under GPL, LGPL
   or MPL with no permissive alternative fails the scan until it is reviewed:
   record the package, its license and how the project uses it in
   `scripts/license-review.json`. A reviewed package whose license changes
   fails again.
4. **Tests prove behavior.** Every behavioral change carries a test that
   fails on the old behavior. Audit-log surfaces are append-only; no change
   may add an update or delete path to them.
5. **Per-file license headers are not used.** LICENSE and NOTICE at the
   repository root govern the whole tree; do not add header blocks.

## Style

- No em-dashes in repository documents. Plain, direct technical prose.
- Code comments state constraints the code cannot show, nothing else.
