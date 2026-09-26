import assert from "node:assert/strict";
import test from "node:test";
import { deliveryOutcomes, httpStandIn } from "./stand-ins.mjs";

test("a stand-in goes down and comes back on the same port, keeping what it was sent", async () => {
  const stand = await httpStandIn({ body: "{}", contentType: "application/json" });
  const post = () => fetch(`${stand.url}/hook`, { method: "POST", body: "one" });
  try {
    assert.equal((await post()).status, 200);
    const port = stand.port;
    await stand.down();
    await assert.rejects(post());
    await stand.up();
    assert.equal(stand.port, port);
    assert.equal(await (await post()).text(), "{}");
    assert.deepEqual(stand.requests.map((request) => [request.method, request.path, request.body]), [["POST", "/hook", "one"], ["POST", "/hook", "one"]]);
  } finally {
    await stand.down();
  }
});

test("deliveries are counted around each integration's outage", () => {
  const t = (seconds) => new Date(Date.UTC(2026, 8, 25, 12, 0, seconds));
  const routes = {
    Email: { downAt: t(10), upAt: t(40) },
    Webhook: { downAt: t(10), upAt: t(50) },
  };
  const rows = [
    { integration: "Email", status: "delivered", createdAt: t(0), deliveredAt: t(1) },
    { integration: "Email", status: "delivered", createdAt: t(12), deliveredAt: t(45), waited: true },
    { integration: "Email", status: "delivered", createdAt: t(13), deliveredAt: t(52), waited: true },
    { integration: "Email", status: "pending", createdAt: t(14), deliveredAt: null, waited: false },
    { integration: "Webhook", status: "expired", createdAt: t(12), deliveredAt: null, waited: true },
    { integration: "Webhook", status: "delivered", createdAt: t(51), deliveredAt: t(53), resentFrom: "first" },
  ];
  const outcomes = deliveryOutcomes(rows, routes);
  assert.deepEqual(outcomes.Email, {
    before: 1, beforeDelivered: 1, queued: 3, waited: 2, delivered: 2, afterReturn: [5, 12],
    expired: 0, dead: 0, pending: 1, resent: 0, resentDelivered: 0, afterResend: [],
  });
  assert.deepEqual(outcomes.Webhook, {
    before: 0, beforeDelivered: 0, queued: 1, waited: 1, delivered: 0, afterReturn: [],
    expired: 1, dead: 0, pending: 0, resent: 1, resentDelivered: 1, afterResend: [2],
  });
});
