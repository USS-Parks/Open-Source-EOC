import Fastify from "fastify";

/**
 * A stand-in for SMS Gateway for Android's Local Server, the phone on the
 * site network: its send and inbox endpoints behind basic auth, in the shapes
 * the app's API documents (POST /messages answers 202 with the message's id
 * and state; GET /inbox lists received texts newest first, from a time, with
 * the phone's own offset on each). A test makes a phone text back with
 * `reply`, and turns the phone off with `down`. Nothing leaves the machine.
 */

export interface FixtureGateway {
  readonly url: string;
  readonly username: string;
  readonly password: string;
  /** Each text the phone was asked to send, oldest first. */
  readonly sent: Array<{ id: string; to: string; text: string }>;
  /** A text arriving at the phone; returns its inbox id. */
  reply(sender: string, text: string, at?: Date): string;
  /** While true the phone answers 503, as one that is off or out of reach. */
  down: boolean;
  close(): Promise<void>;
}

/** An ISO time with the phone's offset, as the app writes it: 2026-09-25T10:04:00.000-07:00. */
function phoneTime(at: Date): string {
  return new Date(at.getTime() - 7 * 3_600_000).toISOString().replace("Z", "-07:00");
}

export async function fixtureGateway(username = "sms", password = "gateway-password"): Promise<FixtureGateway> {
  const app = Fastify({ logger: false });
  const expected = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const sent: FixtureGateway["sent"] = [];
  const inbox: Array<{ id: string; type: "SMS"; sender: string; recipient: string; simNumber: number; contentPreview: string; createdAt: string }> = [];
  let seq = 0;
  const gateway = { down: false };
  app.addHook("onRequest", async (req, reply) => {
    if (gateway.down) return reply.code(503).send({ message: "the phone is not reachable" });
    if (req.headers.authorization !== expected) return reply.code(401).send({ message: "Unauthorized" });
  });
  app.post("/messages", async (req, reply) => {
    const body = req.body as { textMessage?: { text?: string }; phoneNumbers?: string[] };
    if (!body.textMessage?.text || !body.phoneNumbers?.length) return reply.code(400).send({ message: "Invalid request" });
    seq += 1;
    const id = `msg-${seq}`;
    for (const to of body.phoneNumbers) sent.push({ id, to, text: body.textMessage.text });
    return reply.code(202).send({
      id, deviceId: "fixture-device", state: "Pending", isEncrypted: false, isHashed: false,
      recipients: body.phoneNumbers.map((phoneNumber) => ({ phoneNumber, state: "Pending" })),
    });
  });
  app.get("/inbox", async (req) => {
    const query = req.query as { from?: string; limit?: string };
    const from = query.from ? Date.parse(query.from) : 0;
    return inbox
      .filter((m) => Date.parse(m.createdAt) >= from)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, Number(query.limit ?? 50));
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return Object.assign(gateway, {
    url: `http://127.0.0.1:${port}`,
    username,
    password,
    sent,
    reply(sender: string, text: string, at = new Date()) {
      seq += 1;
      const id = `in-${seq}`;
      inbox.push({ id, type: "SMS", sender, recipient: "+17075550199", simNumber: 1, contentPreview: text, createdAt: phoneTime(at) });
      return id;
    },
    close: () => app.close(),
  });
}
