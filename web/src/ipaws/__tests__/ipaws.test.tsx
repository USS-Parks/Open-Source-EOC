// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../app/api/client.js";
import { Theme } from "../../design/components.js";
import { IpawsConfigPanel, IpawsSendAction, IpawsSendsPanel, type IpawsClient } from "../IpawsPanel.js";
import {
  actorName,
  channelSummary,
  ipawsMode,
  sendAvailability,
  sendOutcome,
  timeLeft,
  type IpawsSendRequest,
  type IpawsStatus,
  type IpawsTrailEntry,
} from "../model.js";

afterEach(cleanup);

const REQUESTED = "2026-09-23T18:00:00.000Z";
const EXPIRES = "2026-09-23T18:15:00.000Z";

const status = (overrides: Partial<IpawsStatus> = {}): IpawsStatus => ({
  enabled: false,
  environment: "test",
  configured: true,
  cogId: "123456",
  endpointUrl: "https://tdl.integration.aws.fema.gov/IPAWS_CAPService/IPAWS",
  credentialFingerprint: "fingerprint",
  certificateExpiresAt: "2029-09-25T00:00:00.000Z",
  moaAcknowledged: true,
  moaReference: "MOA-1",
  moaAcknowledgedAt: REQUESTED,
  secretStorageAvailable: true,
  ...overrides,
});

const send = (overrides: Partial<IpawsSendRequest> = {}): IpawsSendRequest => ({
  id: "send-1",
  capAlertId: "alert-1",
  kind: "live",
  status: "pending",
  requestedBy: "person-a",
  requestedAt: REQUESTED,
  expiresAt: EXPIRES,
  decidedBy: null,
  decidedAt: null,
  submissionId: null,
  ...overrides,
});

const entry = (overrides: Partial<IpawsTrailEntry>): IpawsTrailEntry => ({
  at: REQUESTED,
  personId: "person-a",
  person: "Admin A",
  category: "ipaws.send.requested",
  subjectId: "send-1",
  payload: {},
  ...overrides,
});

describe("IPAWS mode", () => {
  it("names a stand-in endpoint as a fixture whatever environment it claims", () => {
    for (const url of [
      "http://127.0.0.1:4100/IPAWS",
      "https://ipaws.example.org/IPAWS",
      "https://evil.fema.gov.example.org/",
      // Not a host the IDG names.
      "https://tdl.integratedpublicalertsystem.gov/IPAWS_CAPService/IPAWS",
    ]) {
      expect(ipawsMode(status({ endpointUrl: url, environment: "production", enabled: true })).key).toBe("fixture");
    }
  });

  it("separates unconfigured, test, disabled production and live", () => {
    expect(ipawsMode(status({ configured: false })).key).toBe("unconfigured");
    expect(ipawsMode(status({ enabled: true })).key).toBe("test");
    const production = { environment: "production" as const, endpointUrl: "https://apps.fema.gov/IPAWSOPEN_EAS_SERVICE/IPAWS" };
    expect(ipawsMode(status(production)).key).toBe("standby");
    expect(ipawsMode(status({ ...production, enabled: true })).label).toBe("LIVE production IPAWS");
  });
});

describe("send eligibility", () => {
  const base = { isAdmin: true, ipawsEligible: true, reviewState: "approved", status: status({ enabled: true }) };

  it("offers a live send only to an admin, on an approved profile-complete alert, with IPAWS enabled", () => {
    expect(sendAvailability(base)).toEqual({ live: true, handshake: false, reason: null });
    expect(sendAvailability({ ...base, isAdmin: false }).reason).toMatch(/admin/);
    expect(sendAvailability({ ...base, ipawsEligible: false }).reason).toMatch(/IPAWS profile/);
    expect(sendAvailability({ ...base, reviewState: "in_review" }).reason).toMatch(/Approve/);
    expect(sendAvailability({ ...base, status: status({ configured: false }) }).reason).toMatch(/not configured/);
  });

  it("allows only a handshake while a test configuration is disabled, and nothing for disabled production", () => {
    expect(sendAvailability({ ...base, status: status() })).toEqual({ live: false, handshake: true, reason: null });
    const off = sendAvailability({ ...base, status: status({ environment: "production" }) });
    expect(off.live || off.handshake).toBe(false);
    expect(off.reason).toMatch(/disabled/);
  });
});

describe("countdown and outcome", () => {
  const start = Date.parse(REQUESTED);

  it("counts down in minutes and seconds and lapses at expiry", () => {
    expect(timeLeft(EXPIRES, start)).toBe("15:00");
    expect(timeLeft(EXPIRES, start + 14 * 60_000 + 59_500)).toBe("0:01");
    expect(timeLeft(EXPIRES, Date.parse(EXPIRES))).toBeNull();
  });

  it("reads each state, including the IPAWS-OPEN answer from the audit trail", () => {
    expect(sendOutcome(send(), [], start).key).toBe("pending");
    expect(sendOutcome(send(), [], Date.parse(EXPIRES) + 1).key).toBe("expired");
    expect(sendOutcome(send({ status: "cancelled" }), [], start).label).toBe("Cancelled");
    const confirmed = send({ status: "confirmed", decidedBy: "person-b" });
    expect(sendOutcome(confirmed, [], start).key).toBe("submitted");
    const accepted = entry({ category: "ipaws.submitted", personId: "person-b", payload: { requestId: "send-1", accepted: true } });
    expect(sendOutcome(confirmed, [accepted], start).label).toBe("Accepted by IPAWS-OPEN");
    const rejected = entry({ category: "ipaws.submitted", payload: { requestId: "send-1", accepted: false, detail: "not authorized" } });
    expect(sendOutcome(confirmed, [rejected], start)).toEqual({
      key: "rejected", label: "Rejected by IPAWS-OPEN", answer: "not authorized",
    });
  });

  it("names the channels IPAWS-OPEN acknowledged and the ones it refused", () => {
    const channels = [
      { channel: "CAPEXCH", code: "200", error: false, status: "Ack" },
      { channel: "EAS", code: "500", error: false, status: "Ack" },
      { channel: "CMAS", code: "615", error: true, status: "signer-not-authorized-for-event-code-CMAS" },
      { channel: "NWEM", code: "401", error: false, status: "message-not-disseminated-as-NWEM" },
      { channel: "PUBLIC", code: "800", error: false, status: "Ack" },
    ];
    expect(channelSummary(channels)).toBe(
      "Acknowledged on EAS, PUBLIC. Refused on CMAS (615 signer-not-authorized-for-event-code-CMAS).",
    );
    expect(channelSummary(channels.filter((c) => !c.error))).toBe("Acknowledged on EAS, PUBLIC.");
    expect(channelSummary([])).toBe("");

    const confirmed = send({ status: "confirmed", decidedBy: "person-b" });
    const partial = entry({
      category: "ipaws.submitted",
      payload: { requestId: "send-1", accepted: false, detail: "rejected on CMAS", channels },
    });
    expect(sendOutcome(confirmed, [partial], Date.parse(REQUESTED))).toEqual({
      key: "rejected",
      label: "Rejected by IPAWS-OPEN",
      answer: "Acknowledged on EAS, PUBLIC. Refused on CMAS (615 signer-not-authorized-for-event-code-CMAS).",
    });
    const accepted = entry({
      category: "ipaws.submitted",
      payload: { requestId: "send-1", accepted: true, channels: channels.filter((c) => !c.error) },
    });
    expect(sendOutcome(confirmed, [accepted], Date.parse(REQUESTED))).toEqual({
      key: "accepted", label: "Accepted by IPAWS-OPEN", answer: "Acknowledged on EAS, PUBLIC.",
    });
  });

  it("names the viewer as You and others from the trail", () => {
    const trail = [entry({})];
    expect(actorName("person-a", "person-a", trail)).toBe("You");
    expect(actorName("person-a", "person-b", trail)).toBe("Admin A");
    expect(actorName("person-c", "person-b", trail)).toBe("Another admin");
  });
});

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, statusText: `HTTP ${status}`, json: async () => body };
}

describe("API client", () => {
  it("uses the IPAWS routes and returns the pending request a send creates", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      const path = String(url);
      if (path.endsWith("/ipaws/sends")) return res(200, { sends: [send()] });
      if (path.includes("/chronology")) return res(200, { entries: [entry({}), entry({ category: "cap.review.changed" })], nextCursor: null });
      return res(path.endsWith("/confirm") || path.endsWith("/cancel") ? 200 : 202, send());
    }) as unknown as typeof fetch;
    const client = new ApiClient({ fetchImpl });
    await client.configureIpaws("j", { environment: "test", cogId: "1", endpointUrl: "http://127.0.0.1/IPAWS", credential: "pin" });
    await client.acknowledgeIpawsMoa("j", "MOA-1");
    await client.setIpawsEnabled("j", true);
    expect((await client.requestIpawsSend("j", "alert-1", "live")).status).toBe("pending");
    await client.requestIpawsSend("j", "alert-1", "handshake");
    expect(await client.listIpawsSends("j")).toHaveLength(1);
    await client.confirmIpawsSend("j", "send-1");
    await client.cancelIpawsSend("j", "send-1");
    expect((await client.ipawsAuditTrail("j", REQUESTED)).map((e) => e.category)).toEqual(["ipaws.send.requested"]);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "PUT /api/v1/jurisdictions/j/ipaws/config",
      "POST /api/v1/jurisdictions/j/ipaws/moa",
      "POST /api/v1/jurisdictions/j/ipaws/enable",
      "POST /api/v1/jurisdictions/j/cap/alerts/alert-1/ipaws",
      "POST /api/v1/jurisdictions/j/ipaws/test",
      "GET /api/v1/jurisdictions/j/ipaws/sends",
      "POST /api/v1/jurisdictions/j/ipaws/sends/send-1/confirm",
      "POST /api/v1/jurisdictions/j/ipaws/sends/send-1/cancel",
      `GET /api/v1/jurisdictions/j/chronology?from=${encodeURIComponent(REQUESTED)}&limit=500`,
    ]);
    expect(calls[0]!.body).toMatchObject({ environment: "test", cogId: "1", credential: "pin" });
    expect(calls[4]!.body).toEqual({ alertId: "alert-1" });
  });
});

// A request made just now, so the real clock leaves it pending for the whole test.
const fresh = (): IpawsSendRequest => send({
  requestedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
});

function mockClient(overrides: Partial<IpawsClient> = {}): IpawsClient {
  return {
    getIpawsStatus: vi.fn(async () => status()),
    configureIpaws: vi.fn(async () => status()),
    acknowledgeIpawsMoa: vi.fn(async () => status()),
    setIpawsEnabled: vi.fn(async () => status({ enabled: true })),
    requestIpawsSend: vi.fn(async () => send()),
    listIpawsSends: vi.fn(async () => [fresh()]),
    confirmIpawsSend: vi.fn(async () => ({
      accepted: true, detail: "accepted: EAS 500 Ack", httpStatus: 200, submissionId: "sub-1",
      channels: [{ channel: "EAS", code: "500", error: false, status: "Ack" }],
      request: send({ status: "confirmed", decidedBy: "person-b" }),
    })),
    cancelIpawsSend: vi.fn(async () => send({ status: "cancelled" })),
    ipawsAuditTrail: vi.fn(async () => [entry({})]),
    ...overrides,
  };
}

describe("IPAWS screens", () => {
  const headlines = new Map([["alert-1", "Flood Warning for the Lower Klamath"]]);

  it("never lets the requester confirm their own send", async () => {
    const client = mockClient();
    const view = render(<Theme name="light"><IpawsSendsPanel client={client} jurisdictionId="j" personId="person-a" headlines={headlines} onChanged={() => undefined} /></Theme>);
    await view.findByText("Flood Warning for the Lower Klamath");
    expect((view.getByRole("button", { name: "Confirm send" }) as HTMLButtonElement).disabled).toBe(true);
    expect(view.getByText(/a different admin must confirm it/)).not.toBeNull();
    expect(view.getByText(/^You ·/)).not.toBeNull();
  });

  it("lets a second admin confirm and shows the IPAWS-OPEN answer", async () => {
    const client = mockClient();
    const onChanged = vi.fn();
    const view = render(<Theme name="light"><IpawsSendsPanel client={client} jurisdictionId="j" personId="person-b" headlines={headlines} onChanged={onChanged} /></Theme>);
    await view.findByText(/^Admin A ·/);
    const confirm = view.getByRole("button", { name: "Confirm send" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(client.confirmIpawsSend).toHaveBeenCalledWith("j", "send-1"));
    expect(await view.findByText("IPAWS-OPEN accepted the alert. Acknowledged on EAS.")).not.toBeNull();
    expect(onChanged).toHaveBeenCalled();
  });

  it("requests a send from an approved alert and says nothing is sent yet", async () => {
    const client = mockClient();
    const view = render(<IpawsSendAction client={client} jurisdictionId="j" alertId="alert-1" ipawsEligible reviewState="approved" isAdmin status={status({ enabled: true })} />);
    fireEvent.click(view.getByRole("button", { name: "Request IPAWS send" }));
    await waitFor(() => expect(client.requestIpawsSend).toHaveBeenCalledWith("j", "alert-1", "live"));
    expect(await view.findByText(/Nothing is sent until a\s+different admin confirms it/)).not.toBeNull();
  });

  it("clears the certificate after saving and shows only its fingerprint and expiry", async () => {
    const client = mockClient();
    const bundle = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n-----BEGIN PRIVATE KEY-----\nBBBB\n-----END PRIVATE KEY-----\n";
    const view = render(<IpawsConfigPanel client={client} jurisdictionId="j" status={status({ configured: false, credentialFingerprint: null, certificateExpiresAt: null })} onChanged={() => undefined} />);
    expect(view.getByText("No certificate stored.")).not.toBeNull();
    const credential = view.getByLabelText("COG certificate and private key (PEM)") as HTMLTextAreaElement;
    expect(credential.tagName).toBe("TEXTAREA");
    // Nothing typed here goes to a spelling service.
    expect(credential.getAttribute("spellcheck")).toBe("false");
    fireEvent.change(credential, { target: { value: bundle } });
    fireEvent.submit(view.getByRole("button", { name: "Save configuration" }).closest("form")!);
    await waitFor(() => expect(client.configureIpaws).toHaveBeenCalledWith("j", expect.objectContaining({ credential: bundle })));
    await waitFor(() => expect(credential.value).toBe(""));

    view.rerender(<IpawsConfigPanel client={client} jurisdictionId="j" status={status()} onChanged={() => undefined} />);
    expect(view.getByText(/^Stored certificate fingerprint fingerprint, expires .+\.$/)).not.toBeNull();
    view.rerender(<IpawsConfigPanel client={client} jurisdictionId="j" status={status({ certificateExpiresAt: null })} onChanged={() => undefined} />);
    expect(view.getByText("Stored certificate fingerprint fingerprint, not a valid certificate: enter it again.")).not.toBeNull();
  });
});
