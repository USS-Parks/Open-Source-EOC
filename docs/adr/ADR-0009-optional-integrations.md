# ADR-0009: Collaboration, meetings, tracking and facilities ship as optional integrations

Status: Accepted (the Finish PSPR standing default for the gated modules, 2026-09-23)
Date: 2026-09-23

## Context

Four modules register no routes unless a deployment turns them on: `collab`
(incident chat channels in an external collaboration backend), `meetings`
(a Jitsi bridge and scheduled briefings), `tracking` (scan-first tracked
objects and reunification) and `facilities` (facility status networks, HAVE
exchange and the shelter census). Each is switched on by naming it in the
comma-separated `OPENEOC_INTEGRATIONS` server setting, read once at start.
The server reports the set at `GET /api/v1/integrations`, and the console
hides the entries of any integration that is off.

Version 1.0 needs one stated disposition for them: ship them gated, or cut
them and record how to bring them back.

## Decision

Ship all four gated, as optional integrations.

- They stay in the tree, covered by the test suite in every run, with their
  routes absent by default.
- `README.md` names each with its enabling value. The API document tags every
  route an integration registers with its `OPENEOC_INTEGRATIONS` value.
- Their threat-model rows (B4, B13, B14, B15) are conditional on the setting.
- `tracking` and `facilities` are not treated as holding patient-level data in
  v1, the default recorded with the retention work. A deployment that would put
  patient-level data in them needs its own HIPAA review first.

## Consequences

- A county that does not need a module pays nothing for it at run time: no
  routes, no navigation entries, no scheduled work.
- The code still has to be kept green. If a module stops earning that cost,
  cutting it later is a code removal plus a new ADR naming the reversal path
  (the commit that removed it), not code left dark.

## Alternatives considered

- **Cut for v1.** Removes about 1,950 lines of source and their tests, but
  the modules are finished, tested and wanted by some counties (shelter
  census, reunification). Cutting would discard working code without a
  maintenance problem to justify it.
- **Register by default.** Would expose external-backend and HIPAA-adjacent
  surfaces on every install whether or not a county has configured or reviewed
  them.
