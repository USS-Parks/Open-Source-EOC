import { DEERHORN_PASSWORD, seedDeerhorn } from "../demo/deerhorn.js";
import { walkScenario } from "./scenario-walk.js";

/** The Deerhorn Lightning Complex exercise, walked as Hoopa Valley Tribe OES's lead. */
walkScenario({
  name: "deerhorn",
  seed: seedDeerhorn,
  email: "casey.morgan@hoopa.example",
  password: DEERHORN_PASSWORD,
  incident: "Deerhorn Lightning Complex",
  position: "Incident Commander",
  expect: {
    overview: ["Shelters"],
    map: ["SYNTHETIC fire perimeters"],
    lifelines: ["Five sites hold 229 people"],
    resources: ["Satellite terminals for Weitchpec and Pecwan"],
    fieldReports: ["Smoke column building over Bluff Creek"],
  },
});
