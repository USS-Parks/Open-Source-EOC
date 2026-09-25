import { generateKeyPairSync, sign } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { createSecureContext, createServer as createTlsServer, TLSSocket } from "node:tls";

/**
 * Test doubles for the email channel: a fake SMTP relay that records each
 * conversation, and a self-signed certificate for it. Nothing here reaches
 * the network beyond 127.0.0.1.
 */

/**
 * A self-signed certificate for 127.0.0.1, built with node:crypto alone. By
 * default an EC key with CN localhost; the IPAWS tests ask for an RSA key, a
 * COG's CN and, for the expiry checks, a lapsed notAfter (UTCTime).
 */
export function selfSigned(
  options: { rsa?: boolean; commonName?: string; notAfter?: string } = {},
): { key: string; cert: string } {
  const { privateKey, publicKey } = options.rsa
    ? generateKeyPairSync("rsa", { modulusLength: 2048 })
    : generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const length = (n: number) =>
    n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]);
  const tlv = (tag: number, ...parts: Buffer[]) => {
    const body = Buffer.concat(parts);
    return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
  };
  const seq = (...parts: Buffer[]) => tlv(0x30, ...parts);
  const oid = (hex: string) => tlv(0x06, Buffer.from(hex, "hex"));
  const algorithm = options.rsa
    ? seq(oid("2a864886f70d01010b"), tlv(0x05)) // sha256WithRSAEncryption
    : seq(oid("2a8648ce3d040302")); // ecdsa-with-SHA256
  const name = seq(tlv(0x31, seq(oid("550403"), tlv(0x0c, Buffer.from(options.commonName ?? "localhost")))));
  const tbs = seq(
    tlv(0xa0, tlv(0x02, Buffer.from([2]))),
    tlv(0x02, Buffer.from([1])),
    algorithm,
    name,
    seq(tlv(0x17, Buffer.from("250101000000Z")), tlv(0x17, Buffer.from(options.notAfter ?? "491231235959Z"))),
    name,
    publicKey.export({ type: "spki", format: "der" }),
    tlv(
      0xa3,
      seq(
        seq(oid("551d13"), tlv(0x04, seq(tlv(0x01, Buffer.from([0xff]))))), // basicConstraints CA
        seq(oid("551d11"), tlv(0x04, seq(tlv(0x87, Buffer.from([127, 0, 0, 1]))))), // IP 127.0.0.1
      ),
    ),
  );
  const der = seq(tbs, algorithm, tlv(0x03, Buffer.from([0]), sign("sha256", tbs, privateKey)));
  const pem = der.toString("base64").match(/.{1,64}/g)!.join("\n");
  return {
    key: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    cert: `-----BEGIN CERTIFICATE-----\n${pem}\n-----END CERTIFICATE-----\n`,
  };
}

export interface SmtpSession {
  commands: string[];
  auth: string | null;
  secure: boolean;
  data: string;
}

/**
 * A fake SMTP relay that records each conversation. It offers STARTTLS when
 * given a certificate, speaks implicit TLS when asked, and can refuse MAIL.
 */
export async function fakeRelay(options: {
  cert?: { key: string; cert: string };
  implicit?: boolean;
  authMethods?: string;
  refuseMail?: string;
}): Promise<{ port: number; sessions: SmtpSession[]; server: Server }> {
  const sessions: SmtpSession[] = [];
  const context = options.cert ? createSecureContext(options.cert) : null;
  const handle = (raw: Socket) => {
    const session: SmtpSession = { commands: [], auth: null, secure: Boolean(options.implicit), data: "" };
    sessions.push(session);
    let socket = raw;
    let buffer = "";
    let inData = false;
    let login: string[] | null = null;
    const say = (line: string) => socket.write(`${line}\r\n`);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("latin1");
      for (let end = buffer.indexOf("\r\n"); end >= 0; end = buffer.indexOf("\r\n")) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            say(`250 2.0.0 Ok: queued as Q${sessions.length}`);
          } else session.data += `${line}\r\n`;
          continue;
        }
        if (login) {
          login.push(Buffer.from(line, "base64").toString());
          if (login.length === 1) say("334 UGFzc3dvcmQ6");
          else {
            session.auth = `LOGIN ${login.join(":")}`;
            login = null;
            say("235 2.7.0 Authentication successful");
          }
          continue;
        }
        session.commands.push(line);
        const verb = line.split(" ")[0]!.toUpperCase();
        if (verb === "EHLO") {
          say("250-fake.relay.test");
          if (context && !session.secure) say("250-STARTTLS");
          say(`250-AUTH ${options.authMethods ?? "PLAIN LOGIN"}`);
          say("250 8BITMIME");
        } else if (verb === "STARTTLS") {
          say("220 2.0.0 Ready to start TLS");
          socket.removeListener("data", onData);
          socket = new TLSSocket(socket, { isServer: true, secureContext: context! });
          socket.on("data", onData);
          session.secure = true;
        } else if (verb === "AUTH" && line.split(" ")[1] === "PLAIN") {
          session.auth = `PLAIN ${Buffer.from(line.split(" ")[2]!, "base64").toString().split("\0").slice(1).join(":")}`;
          say("235 2.7.0 Authentication successful");
        } else if (verb === "AUTH") {
          login = [];
          say("334 VXNlcm5hbWU6");
        } else if (verb === "MAIL") say(options.refuseMail ?? "250 2.1.0 Ok");
        else if (verb === "RCPT") say("250 2.1.5 Ok");
        else if (verb === "DATA") {
          inData = true;
          say("354 End data with <CR><LF>.<CR><LF>");
        } else if (verb === "QUIT") {
          say("221 2.0.0 Bye");
          socket.end();
        } else say("502 5.5.2 Error: command not recognized");
      }
    };
    socket.on("data", onData);
    socket.on("error", () => {});
    say("220 fake.relay.test ESMTP");
  };
  const server =
    options.implicit && options.cert ? createTlsServer(options.cert, handle) : createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  return { port: typeof addr === "object" && addr ? addr.port : 0, sessions, server };
}

/** The decoded text body of a recorded DATA section. */
export function bodyOf(data: string): string {
  const [, encoded] = data.split("\r\n\r\n");
  return Buffer.from(encoded!.replace(/\r\n/g, ""), "base64").toString("utf8");
}
