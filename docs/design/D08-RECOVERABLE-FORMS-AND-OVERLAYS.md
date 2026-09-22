# D08 recoverable forms, drafts, drawers, and dialogs

**Prompt:** D08

**Status:** Implemented in the additive design seam; verification evidence is recorded below.

**Binding visual reference:** [Lifelines workspace](canonical-references/03-lifelines-light.jpg) governs the compact right-side drawer, teal primary action, grouped detail density, and responsive stacking. D08 does not replace the reference composition.

## 1. Reuse and authority

D08 adds presentation primitives only. It imports the authoritative shared `FieldDef`, `FormLayout`, `buildRecordSchema`, `conditionMatches`, `deriveRecordValues`, and `dictionaryValues` exports. It does not duplicate validation, conditional logic, calculated-field logic, permissions, or submission engines.

The existing `RecordForm` and its exports remain unchanged. P-BOARDS-1 owns adoption in operational board surfaces under expand-then-contract HZ14.

| New module | Contract |
|---|---|
| `form-drafts.ts` | Exact-scope draft key and thin serialized adapter over injected `getMeta`/`setMeta` methods |
| `forms.tsx` | `SchemaForm`, grouped sections, shared conditional/calculated values, field controls, linked validation, draft and async submission states |
| `overlays.tsx` | `Drawer` and `ModalDialog` with shared focus trap, restoration, Escape/backdrop handling, and explicit unsaved confirmation |
| `forms.css` | Scoped form/overlay presentation driven by D04 tokens |
| `web/design-review/form-gallery.tsx` | Synthetic review surface; no operational route, API or application TypeScript ownership |

## 2. Field contract

| Shared field type | Built-in behavior |
|---|---|
| text | Labeled multiline input with max length |
| number | Numeric input that stores finite values for shared validation |
| boolean | Labeled checkbox |
| datetime | Local date/time input converted to an ISO instant |
| enum | Select using inline or shared dictionary values |
| person reference | Select from caller-injected scoped choices; otherwise explicit unavailable state |
| record reference | Select from caller-injected scoped choices; otherwise explicit unavailable state |
| geometry | Caller-injected accessible editor; otherwise explicit unavailable state |
| attachment | Caller-injected upload promise with busy/error/attached state; otherwise explicit unavailable state |
| calculation | Read-only shared-derived output; never stored |

`FormLayout` sections define grouping. Fields omitted from a supplied layout appear in “Additional details” so a layout cannot silently make a declared field inaccessible. Conditional controls use `conditionMatches` against `deriveRecordValues` and inactive values are omitted at validation/submission.

## 3. Validation and correction

The form validates with `buildRecordSchema`, the same shared validator used by current record engines. Errors appear both inline and in a focusable summary whose links target the invalid controls. The first invalid submission moves focus to the summary. Correcting one field removes only that field’s inline error and retains every other completed value.

Calculated-field failures are shown as errors and prevent submission. Required conditional fields are validated only when their shared condition matches.

## 4. Scoped draft behavior

`DraftScope` includes person, incident, form, record-or-new, and schema. Every segment is required and encoded in the metadata key. Changing any segment resets the form before hydrating the new scope; values from different people, incidents, records, or schemas never mix.

`createMetadataDraftStore` accepts only the existing metadata method shape. It creates no database or storage provider. Writes are serialized per exact scope so a slower older save cannot overwrite a newer value. Initial defaults are not written during hydration. Load, saving, saved, and storage-error states are explicit; a storage failure does not erase current in-memory values.

## 5. Submission truth

Submission follows this order:

1. Remove inactive and blank stored values.
2. Validate with the shared schema.
3. Await the injected `onSubmit` promise.
4. Only after it resolves, clear the scoped draft and show success.

A rejected submission displays “Record was not saved,” keeps every current value, keeps the form dirty, and saves the current draft again. A failed submission never shows a success state and never clears the draft.

## 6. Drawer and dialog behavior

Both overlays use native dialog semantics, a labeled heading, initial focus, Tab/Shift+Tab containment, Escape handling, backdrop handling, and focus restoration to the opener. The drawer follows the approved 340px right-side width on wide screens and becomes full-width on narrow screens.

When `unsaved` is true, close attempts open an alert dialog. “Keep editing” receives focus. “Discard changes” is explicit, calls the injected `onDiscard`, and closes only after that work resolves. A failed discard leaves the guard open and reports the failure. Consumers may also provide a clearly labeled “Close and keep draft” action.

## 7. Review entry

Open [D08-gallery.html](D08-gallery.html) through the root-controlled preview:

```text
http://127.0.0.1:5175/docs/design/D08-gallery.html
```

The archived [browser fixture](D08-gallery.fixture.mjs.txt) is outside default test discovery. It captures light/dark wide/narrow states and checks validation correction, conditional controls, draft close/reopen without re-entry, rejected-submit preservation, successful-submit truth, focus trap/restoration, Escape unsaved guard, responsive drawer containment, page errors, and external requests.

## 8. Verification evidence

| Gate | Result |
|---|---|
| All-workspace TypeScript | PASS — `pnpm -r exec tsc --noEmit`, exit 0 after correcting the two review-only geometry literals to the shared lowercase enum |
| All-tree ESLint | PASS — `pnpm exec eslint .`, exit 0 after removing one unused test binding |
| Focused behavior and light/dark axe tests | PASS — 21 tests total: the unchanged draft and axe suites passed 6/6 in the initial run; after production review, the overlay suite passed 4/4 and the final form suite passed 11/11, including hash-route preservation, stale submit/upload isolation, Strict Mode upload merging, and guard focus restoration |
| Browser review | PASS: root ran four light/dark wide/narrow views, validation correction without hash navigation, resumed drafts, rejected and successful submission, unsaved guard focus and containment; zero page errors or external requests. Evidence: deploy/test-runtime/out/d08-review/result.json and browser-width-repair.log in the canonical checkout. Root viewed wide light and narrow dark. The fixture measures the drawer border box at 340px; the earlier client-width assertion excluded its border. |
| Final validation wording | PASS: required fields use plain field-specific correction text, preserving the shared validator. Root web TypeScript, affected ESLint and forms 11/11 passed after this presentation-only correction. |

## 9. Boundaries

No existing component, gallery, offline store, API client, board surface, route, validation engine, or workflow was edited. The review uses synthetic data and an injected in-memory metadata backend. Operational adoption, permission checks, record persistence, and API error wording remain with existing engines and named presentation prompts.
