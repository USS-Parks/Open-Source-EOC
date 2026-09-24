# Governance

## Roles

- **Lead maintainer:** Basho Parks. Final decision authority on scope,
  releases, licensing, and this document.
- **Maintainers:** contributors granted merge rights by the lead maintainer
  after sustained, quality contribution. None yet beyond the lead.

## Decision making

- Product scope and sequence are governed by the build roster
  (`docs/process/FINISH-PSPR-2026-09-22.md`). Changes to the roster are
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

### Second maintainer

The two-maintainer requirement is not met. Basho Parks is the only
maintainer, and no second maintainer is on record. A person is named here
only after they have agreed and been given access.

A second maintainer with full release capability needs:

- commit access to this repository and the right to update `main`;
- the right to create release tags and publish release assets, including the
  map archives and their `SHA256SUMS`, and any signing credentials a release
  uses;
- working familiarity with the release runbooks: the
  [changelog](CHANGELOG.md), the [upgrade guide](docs/guides/UPGRADE.md), the
  [server deployment guide](deploy/README.md) and the
  [Windows installer build](deploy/windows/installer/README.md);
- enough knowledge of the code to review a change and run the full gate,
  `pnpm check:gate`.

The 1.0 release proceeds only when a second maintainer is named in this
document, or when Basho Parks records a written waiver of this requirement for
that release in the [V1 ledger](docs/process/V1-LEDGER.md). A waiver covers
the release it names and does not retire the requirement.

## Cadence

- Governance review each quarter once development is active: maintainer
  roster, bus factor, dependency and license posture, open corrective
  actions from after-action reviews.

## Releases and support

- **Before 1.0.** Evaluation builds, numbered `0.9.x`, are made as needed on
  no fixed schedule and recorded in the [changelog](CHANGELOG.md). Only the
  latest is supported.
- **After 1.0.** Releases come when the work is ready, not on a calendar.
  Security fixes go to the latest minor release only. There is no long-term
  support branch.
- **Support.** Community support through GitHub issues, answered as the
  maintainers have time. There is no paid support and no service-level
  agreement.
- **Not certified.** OpenEOC is not a certified or accredited system. A
  jurisdiction that runs it is responsible for its own authority to operate,
  its own security assessment, and the fit of the software to its plans and
  legal obligations.
- **Security.** Vulnerabilities are reported privately under the
  [security policy](SECURITY.md).
