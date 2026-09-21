# D01 operator journeys and workflow baseline

**Date:** 2026-09-21
**Measured execution baseline:** `af8a0dc471926a2de660f982372caa9d6a34acc2`
**Evidence target:** Real database plus headless Chromium against the built current application

## 1. Purpose and claim boundary

This document fixes six comparison tasks for D01 and later D34 measurement. Each task has one synthetic data set, one permission profile, one ready state, and one visible stopping condition. Later comparisons must use those same conditions or disclose the difference.

The D01 run is a scripted browser baseline. It records wall-clock time and direct UI interactions from a declared ready state to the stopping condition. It is not a human operator timing and does not establish usability, training burden, production latency, or a vendor comparison.

No licensed Esri, WebEOC/Juvare, COBRA, or Microsoft Teams EOC comparison environment was supplied. Every vendor baseline is therefore **unavailable**. No vendor time, interaction count, error rate, or relative-speed claim is inferred from screenshots or research.

The fixture data is synthetic and local. External network requests are blocked. The fixture is stored as `docs/design/D01-baseline.fixture.ts.txt` so it does not enter default test discovery or become a permanent regression test for the old interface. The compact durable receipt is `docs/design/D01-baseline.metrics.json`; the full raw result and corrected run log remain in the ignored canonical runtime evidence directory.

## 2. Fixed measurement contract

| Variable | D01 value | Later comparison rule |
|---|---|---|
| Operator | `admin@example.org`, jurisdiction administrator, no acting position selected | Use the same account authority and do not select an acting position |
| Incident | `D01 North Coast Exercise` | Use the same incident label and equivalent clean incident state |
| Operational period | `OP-D01` | Preserve the same period identifier and seeded briefing state |
| Viewport | 1440 by 900 CSS pixels | Use the same viewport unless a separately reported field-device comparison is run |
| Theme | Light, the application default | Use the same theme |
| Network | Application/API local; all non-local requests blocked | Use the same local path and block external requests |
| Data | Exact per-task values in section 4 | Do not substitute simpler or precompleted records |
| Assistance | No hints, documentation, coaching, or retries during the measured interval | Count any intervention if a human run needs it |
| Start | Required screen/data loaded as stated for the task | Start the timer immediately before the first counted operator action |
| Stop | Required visible state stated for the task | Stop only after the UI shows the condition, not after an API response alone |
| Reset | Fresh throwaway database and no task-created record from an earlier run | Recreate the fixture before a comparison run |

### 2.1 Metric definitions

| Metric | Definition |
|---|---|
| Elapsed time | Script wall time in milliseconds from the first counted UI action through the visible stopping condition, including application/server waits |
| Interaction | One direct click, select, text fill, file selection, map click, or key action; passive waits and assertions do not count |
| Duplicate entry | A value the operator must enter again after already entering it for the same task; repeated display or server reuse does not count |
| Assistance | A hint, documentation lookup, coach intervention, or recovery instruction needed to continue |
| Error | A browser page error or an operator action that creates an incorrect state and must be corrected; unavailable paths are not counted as zero-error completions |
| Unavailable | The task cannot enter its required workflow because the current interface lacks the destination or control; elapsed and comparable interaction metrics remain `null` |

Login and fixture setup occur before measurement. Direct database/API calls are permitted only to establish controlled initial data. Every measured task action is performed through the browser.

## 3. Reproduction fixture

The checked-in artifact is descriptive source with a `.ts.txt` suffix. For a bounded run, copy it unchanged to the ignored runtime location:

`deploy/test-runtime/out/d01-baseline/D01-baseline.test.ts`

Required environment:

- `OPENEOC_TEST_DB_TAG=main` to isolate the throwaway database run.
- `OPENEOC_D01_OUTPUT=<runtime path>/D01-baseline.metrics.json` for the structured receipt.
- `OPENEOC_CHROMIUM` when Chromium is not at one of the existing app-e2e candidate paths.
- `OPENEOC_TEST_BUILD_ROOT` may select an ignored build location.

Run only this fixture with one worker. It reuses `server/src/__tests__/app-e2e.test.ts` patterns for the built SPA, local Fastify server, fresh migrated database, deterministic identity, and blocked external traffic. It writes no screenshots and runs no broad suite.

The JSON receipt records the baseline SHA, environment, operator, task status, exact data, ready/stop conditions, elapsed time, interactions, duplicate entry, assistance, errors, limitations, and vendor unavailability.

## 4. Fixed task scripts

### BR-01: Submit and confirm a geotagged field report

**Purpose:** Measure the current field-to-COP path.

**Data:** Summary `Culvert washout on Bald Hills Rd`; category `damage`; attachment `washout.jpg`; location selected on the seeded COP.

**Permission:** Jurisdiction administrator; no acting position selected.

**Ready state:** Authenticated on Map; the Field Reports board exists; the COP canvas is ready; no matching report exists.

**Counted steps:**

1. Choose Add point.
2. Select Field Reports.
3. Place the report on the map.
4. Enter the summary.
5. Select Damage.
6. Attach `washout.jpg`.
7. Save the record.
8. Open Field Reports from the board launcher.

**Stop:** `Culvert washout on Bald Hills Rd` is visible in the Field Reports board.

**Current path:** Implemented through `web/src/app/surfaces/MapSurface.tsx` and `web/src/boards/RecordForm.tsx`.

### BR-02: Assess a disrupted Community Lifeline

**Purpose:** Measure the required assessment workflow without treating a summary card as an editor.

**Data:** Energy; condition `Disrupted`; impact `Two substations offline`; responsible source Utility Liaison; stabilization objective Restore power to critical facilities; linked generator action.

**Permission:** Jurisdiction administrator; no acting position selected.

**Ready state:** Authenticated shell; Energy data is seeded; no current-period assessment for this task has been entered through the target workspace.

**Comparable steps when implemented:** Open ESFs & Lifelines, select Energy, create/update the assessment, enter the fixed evidence and objective, link the action, save, then open the briefing result.

**Stop:** The Lifelines overview and current briefing both show Energy as Disrupted with the fixed impact, attribution, period, and linked action.

**Current result rule:** Unavailable. The current rail has no ESFs & Lifelines destination or assessment control. Existing Dashboard and SITREP lifeline content is read-only summary output. D13 and `P-LIFE-1` through `P-LIFE-4` own the missing engine and surfaces.

### BR-03: Submit and triage a resource request

**Purpose:** Measure the current request-to-first-disposition path.

**Data:** Item `Sandbags`; quantity `500`; priority `immediate`; target state `triaged`.

**Permission:** Jurisdiction administrator; no acting position selected.

**Ready state:** Authenticated shell; no matching request exists.

**Counted steps:**

1. Open Resources.
2. Enter Sandbags.
3. Enter 500.
4. Select Immediate.
5. Submit the request.
6. Advance the new request to its first allowed transition.

**Stop:** The Sandbags request visibly shows `triaged`.

**Current path:** Implemented through `web/src/app/surfaces/ResourcesSurface.tsx` and the resource lifecycle service.

### BR-04: Customize and publish a board revision

**Purpose:** Measure the no-code board-authoring path rather than record entry.

**Data:** Board `Shelter Status`; add Boolean field `Has generator`; add it to the main list view; preview; publish a versioned revision while preserving existing records.

**Permission:** Jurisdiction administrator; no acting position selected.

**Ready state:** Authenticated on Boards; the representative board and records exist at the prior template version.

**Comparable steps when implemented:** Open board administration, edit the schema, add the field, update the view, preview, publish, and reopen the board.

**Stop:** The published board displays the Has generator column, retains its seeded records, and identifies the new template version.

**Current result rule:** Unavailable. `web/src/boards/Designer.tsx` exists as an unmounted component, but the current Boards surface exposes no create, customize, designer, preview, or publish control. `81A-E`, `81B-E1/E2`, and `P-BOARDS-2` own this path.

### BR-05: Prepare and submit an IAP for approval

**Purpose:** Measure current planning work across Forms and IAP.

**Data:** Selected incident `D01 North Coast Exercise`; preview ICS-201; assemble the default seven-form IAP; submit the resulting plan.

**Permission:** Jurisdiction administrator; no acting position selected.

**Ready state:** The incident is selected and active; no IAP has been assembled for it.

**Counted steps:**

1. Open Forms.
2. Preview the default form and confirm ICS-201.
3. Assemble the IAP.
4. Open IAP.
5. Submit the assembled plan for approval.

**Stop:** The working list visibly shows `In Approval` and 7/7 forms.

**Current path:** Implemented across `web/src/app/surfaces/FormsSurface.tsx` and `IapSurface.tsx`.

### BR-06: Open a shift briefing and confirm Lifeline condition

**Purpose:** Measure retrieval of a frozen operational briefing.

**Data:** SITREP period `OP-D01`; Energy expected `unstable`.

**Permission:** Jurisdiction administrator; no acting position selected.

**Ready state:** A frozen OP-D01 SITREP exists for the selected incident.

**Counted steps:**

1. Open SITREP.
2. Open Operational period OP-D01.

**Stop:** The OP-D01 article is visible and its Energy row visibly shows `unstable`.

**Current path:** Implemented through `web/src/app/surfaces/lists.tsx`, `SitrepSurface.tsx`, and `web/src/sitreps/BriefingView.tsx`. This measures retrieval, not the D26 composition workflow.

## 5. Measured current-interface results

The corrected fixture run completed at `2026-09-21T19:58:17.255Z` against `af8a0dc471926a2de660f982372caa9d6a34acc2`. Playwright reported 1/1 test passed, process exit 0, and 7.50 seconds total fixture duration. The structured receipt reported no run errors and no external requests.

| Task | Status | Elapsed ms | Interactions | Duplicate entry | Assistance | Errors | Stopping evidence |
|---|---|---:|---:|---:|---:|---:|---|
| BR-01 Field reporting | Completed, scripted | 681.5 | 8 | 0 | 0 | 0 | Saved report visible on the selected incident Field Reports board |
| BR-02 Lifeline assessment | Unavailable | N/A | N/A | N/A | N/A | 0 | No current destination or assessment control; workflow cannot start |
| BR-03 Resource coordination | Completed, scripted | 212.0 | 6 | 0 | 0 | 0 | Sandbags request visibly shows `triaged` |
| BR-04 Board customization | Unavailable | N/A | N/A | N/A | N/A | 0 | One discovery interaction confirmed the Designer is not mounted; workflow cannot start |
| BR-05 IAP preparation | Completed, scripted | 303.4 | 5 | 0 | 0 | 0 | Working list visibly shows `In Approval` and 7/7 forms |
| BR-06 Shift briefing | Completed, scripted | 127.3 | 2 | 0 | 0 | 0 | OP-D01 article and Energy `unstable` are visible |

`N/A` means not measurable because the workflow cannot start. It does not mean zero time, zero interactions, or successful completion. BR-04 records one discovery interaction separately from its null comparable interaction metric.

These are single-run, headless browser wall times on the local fixture environment. They are environment-specific script timings, not human task timings, usability evidence, latency distributions, or evidence for a relative-speed claim. A prior setup attempt stopped on a fixture-only exact-text selector mismatch in the resource row and is excluded; the corrected named-control selector passed without a product change.

Source review after execution corrected the report-only operator position from `Planning Section` to `null` (`not signed into a position`). The raw runtime result is preserved unchanged for provenance. This metadata correction does not alter the administrator account, browser actions, measured intervals, or stopping assertions, and no position-based performance claim is made.

## 6. Vendor comparison status

| Comparison environment | Availability | Reason |
|---|---|---|
| Esri Emergency Management Operations | Unavailable | No licensed environment, equivalent configured data, or authorized operator session supplied |
| WebEOC/Juvare | Unavailable | Screenshots are reference inputs only; no licensed environment or equivalent task configuration supplied |
| COBRA | Unavailable | No licensed environment or authorized access supplied |
| Microsoft Teams EOC pattern | Unavailable | No equivalent configured environment supplied |

The later phrase “2x faster” is permitted only for a task whose measured completion time is at most half the comparable baseline without a worse error outcome. D01 provides no basis for that claim.

## 7. Limitations and D34 handoff

- Headless scripted time includes local application and database waits but excludes human perception, reading, deliberation, motor variation, training, and recovery behavior.
- One run establishes a reproducible current-interface observation, not a latency distribution. D34 must use equivalent conditions and report run count and variability.
- BR-02 and BR-04 are blocked workflows. Their later comparison starts only when the prescribed engine and presentation units exist; D01 does not assign a fabricated zero baseline.
- The shift-briefing task measures opening and reading a frozen SITREP. D26 separately owns briefing composition and controlled preparation.
- No live deployment, representative practitioner, assistive technology, tablet, phone, offline, or vendor environment was exercised by this fixture.
- Any later change to task data, permission, starting state, stopping condition, viewport, theme, network posture, or assistance must be disclosed beside the comparison result.
