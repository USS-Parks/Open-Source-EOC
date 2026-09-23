# Governance

## Roles

- **Lead maintainer:** Basho Parks. Final decision authority on scope,
  releases, licensing, and this document.
- **Maintainers:** contributors granted merge rights by the lead maintainer
  after sustained, quality contribution. None yet beyond the lead.

## Decision making

- Product scope and sequence are governed by the build roster
  (`docs/process/VIRTUAL-EOC-PSPR-2026-09-17.md`). Changes to the roster are
  decisions of the lead maintainer, recorded by amendment in the roster
  itself and in the execution ledger.
- Technical decisions inside a roster session are made by whoever executes
  the session, within the roster's universal execution contract and the
  invariants. Anything that would break an invariant stops and escalates.

## Succession (the anti-abandonment rule)

The platform must outlive any single maintainer (invariant INV-10).

- Before the 1.0 release the project must have at least two maintainers
  with full release capability, and two independent deploy proofs.
- If the lead maintainer is unreachable for 12 consecutive months, the
  longest-serving active maintainer assumes the lead role and must appoint
  a second maintainer within 90 days.
- If no maintainer remains active, the repository is to be marked archived
  with a notice inviting a community fork. The Apache-2.0 license makes a
  fork lawful without anyone's permission; this rule makes it expected.

## Cadence

- Governance review each quarter once development is active: maintainer
  roster, bus factor, dependency and license posture, open corrective
  actions from after-action reviews.
