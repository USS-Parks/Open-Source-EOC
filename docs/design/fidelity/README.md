# Design fidelity side-by-side images

Each image puts a canonical frame from
[`../canonical-references/`](../canonical-references/) on the left and the
build's capture of the same screen on the right, both at the frame's 1280 by
800 size. The capture is taken at the frames' 1586 by 992 viewport and scaled
down.

| Image | Frame | Screen |
|---|---|---|
| `overview-dark-side-by-side.jpg` | `02-overview-dark.jpg` | Incident overview, dark |
| `overview-light-side-by-side.jpg` | `01-overview-light.jpg` | Incident overview, light |
| `lifelines-light-side-by-side.jpg` | `03-lifelines-light.jpg` | ESFs & Lifelines with Energy selected, light |

## How they are made

```
pnpm fidelity
```

This runs `server/src/__tests__/fidelity-browser.test.ts` with the same
database and Chromium settings as the other browser suites (see
[`deploy/test-runtime/README.md`](../../../deploy/test-runtime/README.md)) and
writes the images here. The run:

1. seeds the North Coast Storm reference scenario
   (`server/src/demo/north-coast.ts`) through the HTTP API into a throwaway
   database, each write made by the person who would make it;
2. places the server-stamped times of that database on the scenario clock,
   09:42 in America/Los_Angeles on the most recent day that time has passed;
3. signs in as Jordan Lee, Planning Section Chief of Humboldt County OES, in
   a browser whose clock is fixed at 09:42 and whose time zone is
   America/Los_Angeles;
4. captures the incident overview in both themes and the ESFs & Lifelines
   workspace with Energy selected in both themes, and writes each light and
   dark capture that has a frame beside it.

The scenario is a synthetic exercise. Its organizations, people, requests,
reports and assessments are invented for the exercise; its places, roads and
the incident area are real geography around Humboldt Bay.
