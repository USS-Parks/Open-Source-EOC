import { describe, expect, it } from "vitest";
import { VolunteerDeploymentSchema, VolunteerSchema, deploymentWarnings } from "../contract.js";

describe("volunteer roster contract", () => {
  it("warns of a needed credential not held, or expired before the deployment's last day", () => {
    const credentials = [
      { name: "CPR", expiresOn: "2026-09-20" },
      { name: "CERT Basic Training", expiresOn: null },
      { name: "Chainsaw", expiresOn: "2025-01-01" },
      { name: "chainsaw ", expiresOn: "2024-06-30" },
    ];
    // Valid through its expiry day.
    expect(deploymentWarnings(credentials, ["CPR"], "2026-09-20")).toEqual([]);
    expect(deploymentWarnings(credentials, ["cpr"], "2026-09-21")).toEqual(["cpr expired 2026-09-20"]);
    expect(deploymentWarnings(credentials, ["CERT Basic Training", "Ham license"], "2030-01-01")).toEqual(["No Ham license on record"]);
    // The latest of two expired copies is named.
    expect(deploymentWarnings(credentials, ["Chainsaw"], "2026-09-25")).toEqual(["Chainsaw expired 2025-01-01"]);
  });

  it("refuses impossible dates, times with seconds, and a deployment that ends before it starts", () => {
    const volunteer = { name: "Ana", affiliation: "cert" };
    expect(VolunteerSchema.safeParse({ ...volunteer, credentials: [{ name: "CPR", expiresOn: "2026-02-29" }] }).success).toBe(false);
    expect(VolunteerSchema.safeParse({ ...volunteer, credentials: [{ name: "CPR", expiresOn: "2028-02-29" }] }).success).toBe(true);
    const deployment = { incidentId: "5f1f7a9e-3b1c-4d8e-9a55-1f0f2d6b7c11", role: "Runner", startsAt: "2026-09-20T08:00:00-07:00" };
    expect(VolunteerDeploymentSchema.safeParse(deployment).success).toBe(true);
    expect(VolunteerDeploymentSchema.safeParse({ ...deployment, startsAt: "2026-09-20T08:00:30-07:00" }).success).toBe(false);
    expect(VolunteerDeploymentSchema.safeParse({ ...deployment, endsAt: "2026-09-20T07:59:00-07:00" }).success).toBe(false);
  });
});
