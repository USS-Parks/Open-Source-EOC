import { readFileSync } from "node:fs";
import { createServer, get as httpGet } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { request, sleep, stopChild, until } from "./loopback-host.mjs";

/**
 * Stand-ins on this computer for the network host's optional integrations,
 * for `prove-airgap.mjs --stand-ins`. Each listens on the loopback address
 * and goes down and comes back on the same port, as a relay, provider or
 * partner does when its link drops and returns.
 */

/** Take a server down and bring it back on the port it first listened on. */
export function switchable(server) {
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  let port = server.listening ? server.address().port : 0;
  return {
    get port() { return port; },
    get url() { return `http://127.0.0.1:${port}`; },
    up: () => new Promise((resolvePromise, reject) => {
      if (server.listening) return resolvePromise();
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        port = server.address().port;
        resolvePromise();
      });
    }),
    down: () => new Promise((resolvePromise) => {
      if (!server.listening) return resolvePromise();
      server.close(() => resolvePromise());
      // Open connections go too: a stand-in that is down answers nothing.
      for (const socket of sockets) socket.destroy();
    }),
  };
}

/** An HTTP stand-in: answers every request 200 with `body` and keeps what it was sent. */
export async function httpStandIn({ body = "", contentType = "text/plain" } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({ at: new Date(), method: req.method, path: req.url, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(200, { "content-type": contentType }).end(body);
    });
  });
  const stand = switchable(server);
  await stand.up();
  return Object.assign(stand, { requests });
}

/**
 * What each integration's deliveries did around its outage, from rows of the
 * delivery queue. `routes` gives each integration's outage: when its route
 * went down and when it came back. A delivery queued before the outage counts
 * as before; one queued during it counts as queued, with whether its
 * notification read "Waiting for a route", and whether it went out once the
 * route returned (and how many seconds after), expired, or still waits. A
 * resend counts on its own, with the seconds from the resend to delivery.
 */
export function deliveryOutcomes(rows, routes) {
  const seconds = (from, to) => Math.round((new Date(to) - new Date(from)) / 1000);
  const outcomes = {};
  for (const row of rows) {
    const route = routes[row.integration] ?? {};
    const entry = outcomes[row.integration] ??= {
      before: 0, beforeDelivered: 0, queued: 0, waited: 0, delivered: 0, afterReturn: [],
      expired: 0, dead: 0, pending: 0, resent: 0, resentDelivered: 0, afterResend: [],
    };
    const delivered = row.status === "delivered";
    if (row.resentFrom) {
      entry.resent += 1;
      if (delivered) {
        entry.resentDelivered += 1;
        entry.afterResend.push(seconds(row.createdAt, row.deliveredAt));
      }
    } else if (!route.downAt || new Date(row.createdAt) < new Date(route.downAt)) {
      entry.before += 1;
      if (delivered) entry.beforeDelivered += 1;
    } else {
      entry.queued += 1;
      if (row.waited) entry.waited += 1;
      if (delivered) {
        entry.delivered += 1;
        if (route.upAt) entry.afterReturn.push(seconds(route.upAt, row.deliveredAt));
      } else if (row.status === "expired") entry.expired += 1;
      else if (row.status === "dead") entry.dead += 1;
      else entry.pending += 1;
    }
  }
  return outcomes;
}

const ADMIN = { email: "jordan.lee@humboldt.example", password: "north-coast-exercise" };
const DUTY = { email: "duty.officer@humboldt.example", phone: "+15555550103" };
const PLAYERS = [
  { name: "Stand-in drill player one", email: "player.one@humboldt.example", phone: "+15555550101" },
  { name: "Stand-in drill player two", email: "player.two@humboldt.example", phone: "+15555550102" },
];
const FEED = JSON.stringify({
  type: "FeatureCollection",
  features: [{ type: "Feature", id: "stand-in-1", geometry: { type: "Point", coordinates: [-124.16, 40.8] }, properties: { title: "Stand-in feed item" } }],
});
const MINUTE = 60_000;

/** A host's API as its administrator, over the server's loopback port; signs in again when the session lapses. */
async function adminApi(host) {
  const base = `http://127.0.0.1:${host.httpPort}/api/v1`;
  let token = null;
  const call = async (method, path, body, retry = true) => {
    if (!token) {
      const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ADMIN) });
      if (!login.ok) throw new Error(`sign-in: ${login.status} ${await login.text()}`);
      token = (await login.json()).accessToken;
    }
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status === 401 && retry) {
      token = null;
      return call(method, path, body, false);
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
    return text ? JSON.parse(text) : null;
  };
  const me = await call("GET", "/me");
  return { call, personId: me.person.id, jurisdictionId: me.memberships.find((m) => m.role === "admin").jurisdictionId };
}

/** Wait for `check`, trying every `every` milliseconds, or fail with `failure`. */
async function waitFor(check, ms, failure, every = 1000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(failure);
    await sleep(every);
  }
}

/**
 * The network host's optional integrations, configured through its own API
 * against stand-ins on this computer and taken through an outage and back:
 * email to an SMTP relay, SMS to an HTTP provider and then to a gateway phone
 * on the site network, webhook and ntfy push rules, a GeoJSON feed, and
 * federation with a second host (`partner`). IPAWS stays off: it is FEMA's
 * system. Every outcome is read from the host's own records.
 */
export async function startStandIns({ root, host, partner }) {
  // The SMTP relay and the gateway phone are the server tests' own stand-ins.
  await import("../ts-loader.mjs");
  const { fakeRelay } = await import("../../../server/src/__tests__/smtp-relay.ts");
  const { fixtureGateway } = await import("../../../server/src/__tests__/sms-gateway-fixture.ts");
  const postgres = createRequire(resolve(root, "server/package.json"))("postgres");
  const database = (side) => postgres({
    host: "127.0.0.1", port: side.pgPort, username: "postgres", database: "openeoc_host_demo", max: 2, onnotice: () => undefined,
    password: readFileSync(resolve(side.profileRoot, "secrets/postgres.password"), "utf8").trim(),
  });
  const sql = database(host);
  const partnerSql = database(partner);
  const relay = await fakeRelay({});
  const smtp = switchable(relay.server);
  const smsProvider = await httpStandIn({ body: JSON.stringify({ status: "queued" }), contentType: "application/json" });
  const webhook = await httpStandIn();
  const ntfy = await httpStandIn();
  const feedServer = await httpStandIn({ body: FEED, contentType: "application/geo+json" });
  const phone = await fixtureGateway();
  const a = await adminApi(host);
  const b = await adminApi(partner);
  const jid = a.jurisdictionId;

  const events = [];
  const note = (text) => events.push({ at: new Date(), text });
  const at = {};
  const ids = {};
  const tests = {};
  const waited = new Set();
  const found = {};

  const queue = (since) => sql`
    select d.id, d.kind, d.status, d.attempts, d.created_at, d.delivered_at, d.hold_until, d.resent_from, d.last_error,
           d.notification_id, coalesce(n.detail ? 'waiting', false) as waiting
    from delivery_outbox d left join notifications n on n.id = d.notification_id
    where d.created_at >= ${since} order by d.created_at, d.id`;
  const federation = () => sql`
    select created_at, delivered_at, attempts, last_error from federation_outbox where peer_id = ${ids.peer} order by created_at`;
  const partnerRecords = () => partnerSql`
    select data ->> 'entry' as entry from board_records where board_id = ${ids.partnerBoard} and deleted_at is null order by created_at`;
  const feedNotices = () => sql`
    select title, body, status, detail from notifications where channel = 'feed' and detail ->> 'feedId' = ${ids.feed} order by created_at`;
  /** Remember which deliveries read "Waiting for a route" before their route returned. */
  const snapshot = async (since) => {
    const rows = await queue(since);
    for (const row of rows) if (row.waiting) waited.add(row.id);
    return rows;
  };

  return {
    /** Point every integration at its stand-in, and send once with every route up. */
    async configure() {
      at.configured = new Date();
      await a.call("PUT", `/jurisdictions/${jid}/notification-allowlist`, { entries: [smsProvider.url, webhook.url, ntfy.url] });
      await a.call("PUT", `/jurisdictions/${jid}/notification-channels/email`, {
        settings: { host: "127.0.0.1", port: smtp.port, security: "none", from: "eoc@humboldt.example" },
      });
      await a.call("PUT", `/jurisdictions/${jid}/notification-channels/sms`, {
        settings: { provider: "http", url: `${smsProvider.url}/sms`, username: "stand-in", from: "+15555550100" }, secret: "stand-in-token",
      });
      tests.email = (await a.call("POST", `/jurisdictions/${jid}/notification-channels/email/test`, { to: DUTY.email })).receipt;
      tests.sms = (await a.call("POST", `/jurisdictions/${jid}/notification-channels/sms/test`, { to: DUTY.phone })).receipt;
      // The shortest window the product allows, so one expiry falls inside the run.
      await a.call("PUT", `/jurisdictions/${jid}/delivery-holds/webhook`, { hours: 1 });
      const contacts = [];
      for (const [index, player] of PLAYERS.entries()) {
        contacts.push((await a.call("POST", `/jurisdictions/${jid}/contacts`, {
          name: player.name, emails: [player.email], phones: [player.phone], personId: index === 0 ? a.personId : null,
        })).id);
      }
      ids.group = (await a.call("POST", `/jurisdictions/${jid}/contact-groups`, { name: "Stand-in drill players", contactIds: contacts })).id;
      ids.board = (await a.call("POST", `/jurisdictions/${jid}/boards`, { templateKey: "activity_log", title: "Stand-in drill log" })).id;
      await a.call("POST", `/jurisdictions/${jid}/notification-rules`, {
        boardId: ids.board, event: "record.created",
        channels: [
          { kind: "webhook", url: `${webhook.url}/drill` },
          { kind: "ntfy", url: ntfy.url, topic: "eoc-drill" },
          { kind: "email", to: [DUTY.email] },
          { kind: "sms", to: [DUTY.phone] },
        ],
      });
      ids.feed = (await a.call("POST", `/jurisdictions/${jid}/feeds`, {
        name: "Stand-in GeoJSON feed", kind: "geojson", url: `${feedServer.url}/drill.geojson`, pollIntervalSeconds: 30,
      })).id;
      tests.feed = await a.call("POST", `/feeds/${ids.feed}/poll`);
      // Federation: this host shares the log; the partner's receiving board takes writes from it.
      ids.partnerBoard = (await b.call("POST", `/jurisdictions/${b.jurisdictionId}/boards`, {
        templateKey: "activity_log", title: "Stand-in drill log from the primary host",
      })).id;
      const toPartner = await a.call("POST", `/jurisdictions/${jid}/peers`, { name: "Partner host" });
      const fromPrimary = await b.call("POST", `/jurisdictions/${b.jurisdictionId}/peers`, { name: "Primary host" });
      const keyOf = async (side) => (await side.call("GET", `/jurisdictions/${side.jurisdictionId}/federation`)).identity.publicKey;
      await a.call("PUT", `/peers/${toPartner.id}/key`, { publicKey: await keyOf(b) });
      await b.call("PUT", `/peers/${fromPrimary.id}/key`, { publicKey: await keyOf(a) });
      await a.call("PUT", `/peers/${toPartner.id}/link`, { endpointUrl: `http://127.0.0.1:${partner.httpPort}`, token: fromPrimary.token });
      await b.call("POST", `/peers/${fromPrimary.id}/agreements`, { boardId: ids.partnerBoard, canRead: false, canWrite: true });
      await a.call("POST", `/peers/${toPartner.id}/agreements`, { boardId: ids.board, canRead: true, remoteBoardId: ids.partnerBoard });
      ids.peer = toPartner.id;
      await a.call("POST", `/boards/${ids.board}/records`, { entry: "Stand-in check with every route up" });
      await waitFor(async () => {
        const rows = await queue(at.configured);
        return rows.length > 0 && rows.every((row) => row.status === "delivered")
          && (await federation()).every((row) => row.delivered_at) && (await partnerRecords()).length === 1;
      }, 2 * MINUTE, "With every route up, the first record's deliveries or its copy to the partner did not arrive");
      note("Stand-ins started and configured; the test email and test SMS were accepted, the feed's first poll landed its item, and a record on the drill log went out by webhook, ntfy, email and SMS and reached the partner host");
    },

    /** Take every route down, then queue work for each. */
    async cut() {
      at.cut = new Date();
      await Promise.all([smtp.down(), smsProvider.down(), webhook.down(), ntfy.down(), feedServer.down()]);
      await stopChild(partner.server);
      note("The cut: the SMTP relay, the SMS provider, the webhook and ntfy receivers and the feed server stopped, and the partner host's server stopped");
      ids.massDuring = (await a.call("POST", `/jurisdictions/${jid}/mass-notifications`, {
        groupIds: [ids.group], subject: "Stand-in activation", message: "The EOC is activated for the stand-in drill.",
        channels: ["inapp", "email", "sms"], mode: "broadcast",
      })).id;
      await a.call("POST", `/boards/${ids.board}/records`, { entry: "Stand-in check during the cut" });
      await waitFor(async () => {
        const rows = await snapshot(at.cut);
        return rows.length > 0 && rows.every((row) => row.waiting);
      }, 2 * MINUTE, "Deliveries queued during the cut did not read Waiting for a route");
      note("A mass notification to the drill players by in-app notice, email and SMS, and a record on the drill log; every email, SMS, webhook and push read \"Waiting for a route\"");
    },

    /** Bring every route back but the webhook's, and wait for what waited to go out. */
    async restore() {
      await waitFor(async () => (await sql`select consecutive_failures from feeds where id = ${ids.feed}`)[0].consecutive_failures >= 2,
        5 * MINUTE, "The feed did not fail twice while its server was down", 5000);
      found.waiting = (await snapshot(at.cut)).filter((row) => row.status === "pending").map((row) => ({ kind: row.kind, attempts: row.attempts, error: row.last_error }));
      found.federationWaiting = (await federation()).filter((row) => !row.delivered_at).map((row) => ({ attempts: row.attempts, error: row.last_error }));
      at.returned = new Date();
      await Promise.all([smtp.up(), smsProvider.up(), ntfy.up(), feedServer.up()]);
      partner.startServer("server-returned");
      await until(async () => (await request(httpGet, `http://127.0.0.1:${partner.httpPort}/api/v1/ready`).catch(() => ({}))).status === 200,
        3 * MINUTE, "The partner host's server did not come back");
      at.partnerReturned = new Date();
      note("Routes returned: the SMTP relay, the SMS provider, the ntfy receiver and the feed server started again on their ports, and the partner host's server restarted; the webhook receiver stayed down");
      await waitFor(async () => (await queue(at.cut)).every((row) => row.kind === "webhook" || row.status === "delivered"),
        30 * MINUTE, "Email, SMS or push that waited did not go out when their routes returned", 2000);
      note("Every email, SMS and push that waited was delivered");
      await waitFor(async () => (await federation()).every((row) => row.delivered_at) && (await partnerRecords()).length === 2,
        30 * MINUTE, "The partner host did not receive what waited for it", 2000);
      note("The partner host received the record made during the cut");
      await waitFor(async () => (await feedNotices()).every((row) => row.detail.resolvedAt),
        10 * MINUTE, "The feed did not recover", 2000);
      note("The feed answered again and its notice turned to \"Feed recovered\"");
    },

    /** Switch SMS to a gateway phone on the site network that is off, send, turn it on, and read the replies. */
    async gateway() {
      phone.down = true;
      at.gateway = new Date();
      await a.call("PUT", `/jurisdictions/${jid}/notification-channels/sms`, {
        settings: { provider: "gateway", url: phone.url, username: phone.username }, secret: phone.password,
      });
      ids.massGateway = (await a.call("POST", `/jurisdictions/${jid}/mass-notifications`, {
        groupIds: [ids.group], subject: "Stand-in check-in", message: "Confirm you have this message.", channels: ["sms"], mode: "broadcast",
      })).id;
      await waitFor(async () => {
        const rows = await snapshot(at.gateway);
        return rows.length > 0 && rows.every((row) => row.waiting);
      }, 2 * MINUTE, "Texts to the gateway phone while it was off did not read Waiting for a route");
      note("SMS switched to a gateway phone on the site network, which is off; a mass notification by SMS read \"Waiting for a route\"");
      phone.down = false;
      at.phoneReturned = new Date();
      await waitFor(async () => (await queue(at.gateway)).every((row) => row.status === "delivered"),
        30 * MINUTE, "Texts that waited for the gateway phone did not go out when it came back", 2000);
      note("The phone came back and took every text that waited");
      for (const player of PLAYERS) phone.reply(player.phone, "OK");
      found.repliesRead = await a.call("POST", `/jurisdictions/${jid}/sms-replies/read`);
      const recipients = () => sql`
        select acknowledged_via from mass_notification_recipients where mass_notification_id = ${ids.massGateway}`;
      await waitFor(async () => (await recipients()).every((row) => row.acknowledged_via === "sms"),
        2 * MINUTE, "The replies read from the phone did not acknowledge the send");
      found.acknowledgedByText = (await recipients()).length;
      note("Both players replied by text; the replies read from the phone acknowledged the send");
    },

    /** Wait out the webhook's window with its receiver down, then bring it back and resend. */
    async expire() {
      const [hook] = await sql`
        select id, notification_id, hold_until from delivery_outbox
        where kind = 'webhook' and created_at >= ${at.cut} and resent_from is null`;
      await waitFor(async () => (await sql`select status from delivery_outbox where id = ${hook.id}`)[0].status === "expired",
        Math.max(0, new Date(hook.hold_until) - Date.now()) + 10 * MINUTE, "The webhook did not expire at the end of its window", 5000);
      at.expired = new Date();
      found.heldUntil = new Date(hook.hold_until);
      found.expiredNote = (await sql`select detail ->> 'error' as error from notifications where id = ${hook.notification_id}`)[0].error;
      note(`The webhook queued during the cut read "Expired, not sent" at the end of its window (held until ${found.heldUntil.toISOString()})`);
      await webhook.up();
      at.webhookReturned = new Date();
      await a.call("POST", `/notifications/${hook.notification_id}/resend`);
      note("The webhook receiver started again and the administrator resent the expired webhook");
      await waitFor(async () => (await sql`select status from delivery_outbox where resent_from = ${hook.id}`)[0]?.status === "delivered",
        5 * MINUTE, "The resent webhook was not delivered");
      note("The resent webhook was delivered");
    },

    /** Everything recorded, for result.json and the report. */
    async summary() {
      const label = (row) => row.kind === "email" ? "Email, SMTP relay"
        : row.kind === "ntfy" ? "Push, ntfy"
          : row.kind === "webhook" ? "Webhook"
            : at.gateway && row.created_at >= at.gateway ? "SMS, gateway phone" : "SMS, HTTP provider";
      const rows = (await queue(at.configured)).map((row) => ({
        integration: label(row), status: row.status, createdAt: row.created_at, deliveredAt: row.delivered_at,
        resentFrom: row.resent_from, waited: waited.has(row.id),
      }));
      const back = { downAt: at.cut, upAt: at.returned };
      const outcomes = deliveryOutcomes(rows, {
        "Email, SMTP relay": back, "SMS, HTTP provider": back, "Push, ntfy": back,
        Webhook: { downAt: at.cut, upAt: at.webhookReturned },
        "SMS, gateway phone": { downAt: at.gateway, upAt: at.phoneReturned },
      });
      const entries = await federation();
      const during = entries.filter((row) => row.created_at >= at.cut);
      const notices = await feedNotices();
      const [inapp] = await sql`
        select count(*) filter (where n.status = 'delivered')::int as delivered, count(*)::int as sent
        from notifications n join mass_notification_recipients r on r.id = n.mass_recipient_id
        where r.mass_notification_id = ${ids.massDuring} and n.channel = 'inapp'`;
      return {
        events, tests, outcomes, waiting: found.waiting, inapp,
        stands: {
          smtp: { url: `127.0.0.1:${smtp.port}`, messages: relay.sessions.filter((session) => session.data).length },
          smsProvider: { url: `${smsProvider.url}/sms`, requests: smsProvider.requests.length },
          webhook: { url: `${webhook.url}/drill`, requests: webhook.requests.length },
          ntfy: { url: `${ntfy.url}/eoc-drill`, requests: ntfy.requests.length },
          feed: { url: `${feedServer.url}/drill.geojson`, requests: feedServer.requests.length },
          phone: { url: phone.url, texts: phone.sent.length },
          partner: { url: `http://127.0.0.1:${partner.httpPort}` },
        },
        feed: {
          notices: notices.map((row) => ({
            title: row.title, body: row.body, failures: row.detail.failures, since: row.detail.since, resolvedAt: row.detail.resolvedAt,
          })),
        },
        federation: {
          entries: entries.length, during: during.length, waiting: found.federationWaiting,
          afterReturn: during.map((row) => Math.round((row.delivered_at - at.partnerReturned) / 1000)),
          partnerRecords: (await partnerRecords()).map((row) => row.entry),
        },
        gateway: { repliesRead: found.repliesRead, acknowledgedByText: found.acknowledgedByText },
        webhook: { heldUntil: found.heldUntil, expiredSeenAt: at.expired, note: found.expiredNote },
      };
    },

    /** Stop the stand-ins and close the database sessions. */
    async close() {
      await Promise.all([smtp.down(), smsProvider.down(), webhook.down(), ntfy.down(), feedServer.down(), phone.close()]);
      await Promise.all([sql.end(), partnerSql.end()]);
    },
  };
}

/** The report's section on the stand-ins, from `summary()`. */
export function standInsReport(summary) {
  const { stands, outcomes, feed, federation, gateway, webhook, tests, inapp } = summary;
  const time = (at) => new Date(at).toISOString().slice(11, 19);
  const span = (list, unit = " s") => {
    const [low, high] = [Math.min(...list), Math.max(...list)];
    return low === high ? `${low}${unit}` : `${low} to ${high}${unit}`;
  };
  const order = ["Email, SMTP relay", "SMS, HTTP provider", "SMS, gateway phone", "Webhook", "Push, ntfy"];
  const quoted = (list) => [...new Set(list)].map((text) => `\`${text}\``).join(", ");
  const recovered = feed.notices.at(-1);
  return [
    "## Integrations on local stand-ins",
    "",
    "Run with `--stand-ins`: each optional integration the host can reach, and a stand-in on this computer can play, was configured through the host's own API as its administrator, Jordan Lee, then taken through an outage and back. The stand-ins listen on 127.0.0.1 in the proof's own process; the federation partner is a second network host profile set up and started beside the first, as the first is. Every count below is read from the host's own records (the delivery queue and its notifications, the federation outbox, the feed and its notice, the mass notification recipients); the stand-ins' own logs confirm what reached them.",
    "",
    "### Settings made",
    "",
    `- **Notification allowlist:** ${quoted([stands.smsProvider.url, stands.webhook.url, stands.ntfy.url].map((url) => new URL(url).origin))} (the SMS provider, the webhook receiver and the ntfy server).`,
    `- **Email:** an SMTP relay at \`${stands.smtp.url}\` with no sign-in and connection security "none", the relay the server tests use (\`server/src/__tests__/smtp-relay.ts\`). **Send test email** answered \`${tests.email.response}\`.`,
    `- **SMS:** the HTTP provider at \`${stands.smsProvider.url}\` with an account and token; **Send test SMS** was accepted. From the SMS gateway step on, a gateway phone at \`${stands.phone.url}\` instead: the SMS Gateway for Android stand-in the server tests use (\`server/src/__tests__/sms-gateway-fixture.ts\`).`,
    "- **When a message cannot go out:** webhooks 1 hour, the shortest window the product allows, so one expiry falls inside the run; email, SMS and push at the 72-hour default.",
    `- **Rule:** on a new board, "Stand-in drill log", a record created sends a webhook to \`${stands.webhook.url}\`, an ntfy push to \`${stands.ntfy.url}\`, an email and an SMS.`,
    "- **Contacts:** a group, \"Stand-in drill players\", of two contacts with an email address and a phone number each, the first linked to Jordan Lee.",
    `- **Feed:** GeoJSON, polled every 30 seconds from \`${stands.feed.url}\`; its first poll landed ${tests.feed.items} item.`,
    `- **Federation:** each host registered the other and recorded its public key; this host shares "Stand-in drill log" with the partner at \`${stands.partner.url}\`, into a receiving board that takes the partner's writes.`,
    "",
    "### What happened",
    "",
    "| Time (UTC) | Step |",
    "|---|---|",
    ...summary.events.map((event) => `| ${time(event.at)} | ${event.text} |`),
    "",
    "### Deliveries, by integration",
    "",
    "| Integration | Before the cut | Queued while its route was down | Read \"Waiting for a route\" | Delivered when the route returned | Expired | Resent | Still waiting or failed |",
    "|---|---|---|---|---|---|---|---|",
    ...Object.entries(outcomes).sort(([x], [y]) => order.indexOf(x) - order.indexOf(y)).map(([name, o]) => `| ${[
      name,
      o.before ? `${o.beforeDelivered} of ${o.before} delivered` : "none",
      o.queued,
      o.waited,
      o.delivered ? `${o.delivered}, ${span(o.afterReturn)} after it returned` : 0,
      o.expired,
      o.resent ? `${o.resent}, ${o.resentDelivered} delivered ${span(o.afterResend)} after the resend` : 0,
      o.pending + o.dead,
    ].join(" | ")} |`),
    "",
    `- **Waiting.** When the routes came back, ${summary.waiting.length} deliveries were waiting, after ${span(summary.waiting.map((row) => row.attempts), "")} tries each, with the last error ${quoted(summary.waiting.map((row) => row.error))}. The mass notification's in-app notice needed no route: ${inapp.delivered} of ${inapp.sent} delivered at once.`,
    `- **Expired and resent.** The webhook queued during the cut was held until ${time(webhook.heldUntil)} and read expired at ${time(webhook.expiredSeenAt)} (checked every 5 seconds): "${webhook.note}". The administrator resent it once its receiver was back.`,
    `- **What the stand-ins took.** The SMTP relay ${stands.smtp.messages} messages, the SMS provider ${stands.smsProvider.requests} requests, the webhook receiver ${stands.webhook.requests}, the ntfy server ${stands.ntfy.requests}, the gateway phone ${stands.phone.texts} texts, and the feed server ${stands.feed.requests} polls; the test email and test SMS are among them.`,
    `- **Feed.** ${feed.notices.length} notice for the whole outage, raised at ${time(recovered.since)}, its count reaching ${recovered.failures} failed polls; when the feed answered again at ${time(recovered.resolvedAt)} it became "${recovered.title}": "${recovered.body}"`,
    `- **Federation.** ${federation.entries} updates queued for the partner, ${federation.during} of them during the cut, which waited after up to ${Math.max(0, ...federation.waiting.map((row) => row.attempts))} tries with the last error ${quoted(federation.waiting.map((row) => row.error)) || "none"} and went out ${span(federation.afterReturn)} after the partner's server was ready again. The partner's receiving board holds ${federation.partnerRecords.map((entry) => `"${entry}"`).join(" and ")}.`,
    `- **Gateway replies.** Both players answered by text; **Read replies now** read ${gateway.repliesRead.read} (the scheduler's replies job may read first), and ${gateway.acknowledgedByText} of 2 recipients of the send read acknowledged by text reply.`,
    "- **Not configured.** IPAWS-OPEN, FEMA's system, which no stand-in can play honestly; collaboration (Matrix, Mattermost) and meetings, which need `OPENEOC_INTEGRATIONS` in the server's environment, which the Windows setup does not set; OIDC sign-in, which the web app offers no button for.",
    "",
  ];
}
