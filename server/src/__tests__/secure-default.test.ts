import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { httpTransport as collabTransport } from "../collab/adapters.js";
import { httpTransport as ipawsTransport } from "../ipaws/connector.js";
import { bootstrapCommand, checkRuntimeRole } from "../main.js";
import { decryptSecret, encryptSecret } from "../secrets/envelope.js";
import { ENVELOPE_COLUMNS, rotateSecretKey } from "../secrets/rotate.js";
import { freshDb, tokenFor, type Sql } from "./helpers.js";

let admin: Sql;
let runtime: Sql;

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
});

afterAll(async () => {
  await runtime.end();
  await admin.end();
});

/** Run the startup check as `role`, set inside a superuser transaction. */
async function checkAs(role: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  return (await admin.begin(async (tx) => {
    await tx.unsafe(`set local role ${role}`);
    return checkRuntimeRole(tx as unknown as Sql, env);
  })) as string | null;
}

describe("refusing to serve without row-level security", () => {
  const set = { OPENEOC_RUNTIME_URL: "postgres://app_runtime@db/openeoc" };
  const suffix = Math.random().toString(36).slice(2, 10);
  const bypassRole = `t_bypass_${suffix}`;
  const ownerRole = `t_owner_${suffix}`;

  beforeAll(async () => {
    await admin.unsafe(`create role ${bypassRole} nologin bypassrls`);
    await admin.unsafe(`create role ${ownerRole} nologin`);
    await admin.unsafe("create table owned_by_runtime (id int)");
    await admin.unsafe("alter table owned_by_runtime enable row level security");
    await admin.unsafe(`alter table owned_by_runtime owner to ${ownerRole}`);
  });

  afterAll(async () => {
    await admin.unsafe("drop table owned_by_runtime");
    await admin.unsafe(`drop role ${bypassRole}`);
    await admin.unsafe(`drop role ${ownerRole}`);
  });

  it("refuses when OPENEOC_RUNTIME_URL is unset, unless the override is set", async () => {
    await expect(checkRuntimeRole(runtime, {})).rejects.toThrow(
      /^Refusing to serve: OPENEOC_RUNTIME_URL is unset/,
    );
    await expect(checkRuntimeRole(runtime, { OPENEOC_RUNTIME_URL: "" })).rejects.toThrow(/is unset/);
    const warning = await checkRuntimeRole(admin, { OPENEOC_ALLOW_OWNER_RUNTIME: "1" });
    expect(warning).toMatch(/serving anyway because OPENEOC_ALLOW_OWNER_RUNTIME=1/);
    await expect(checkRuntimeRole(runtime, { OPENEOC_ALLOW_OWNER_RUNTIME: "true" })).rejects.toThrow();
  });

  it("accepts app_runtime, the role row-level security binds", async () => {
    expect(await checkRuntimeRole(runtime, set)).toBeNull();
  });

  it("refuses a superuser, a BYPASSRLS role and a table owner even when the URL is set", async () => {
    await expect(checkRuntimeRole(admin, set)).rejects.toThrow(/bypasses row-level security/);
    await expect(checkAs(bypassRole, set)).rejects.toThrow(new RegExp(`runtime role ${bypassRole} bypasses`));
    await expect(checkAs(ownerRole, set)).rejects.toThrow(new RegExp(`runtime role ${ownerRole} bypasses`));
    expect(await checkAs("app_runtime", set)).toBeNull();
    expect(await checkAs(bypassRole, { ...set, OPENEOC_ALLOW_OWNER_RUNTIME: "1" })).toMatch(/serving anyway/);
  });
});

describe("bootstrap command", () => {
  const password = "first-admin-passphrase-2026";
  const args = [
    "--admin-email=Chief@County.example",
    "--admin-name=County Chief",
    "--jurisdiction-slug=county-oes",
    "--jurisdiction-name=County OES",
  ];

  it("creates the instance admin and first jurisdiction once, and never prints the password", async () => {
    const log: string[] = [];
    await expect(bootstrapCommand(admin, args, "short", (line) => log.push(line))).rejects.toThrow(
      /at least 12 characters/,
    );
    const first = await bootstrapCommand(admin, args, password, (line) => log.push(line));
    if (!first.created) throw new Error("the first bootstrap must create the instance admin");
    const [person] = await admin`
      select id, is_instance_admin from persons where email = 'chief@county.example'`;
    expect(person!.is_instance_admin).toBe(true);
    const [membership] = await admin`
      select m.role, j.slug, j.name from jurisdiction_memberships m
      join jurisdictions j on j.id = m.jurisdiction_id where m.person_id = ${person!.id as string}`;
    expect(membership).toEqual({ role: "admin", slug: "county-oes", name: "County OES" });
    const [positions] = await admin`
      select count(*)::int as n from positions where jurisdiction_id = ${first.jurisdictionId}`;
    expect(positions!.n).toBe(first.positions);
    expect(first.positions).toBeGreaterThan(0);

    const app = buildApp(runtime, { oidc: null, requireAdminMfa: false });
    try {
      expect(await tokenFor(app, "chief@county.example", password)).toEqual(expect.any(String));
    } finally {
      await app.close();
    }

    const counts = async () =>
      (await admin`
        select (select count(*) from persons)::int as persons,
               (select count(*) from jurisdictions)::int as jurisdictions,
               (select count(*) from positions)::int as positions`)[0];
    const before = await counts();
    const again = await bootstrapCommand(
      admin,
      ["--admin-email=other@county.example", "--admin-name=Other", "--jurisdiction-slug=other", "--jurisdiction-name=Other"],
      password,
      (line) => log.push(line),
    );
    expect(again.created).toBe(false);
    expect(await counts()).toEqual(before);

    expect(log).toEqual([
      expect.stringMatching(/^Bootstrapped: instance admin chief@county\.example administers jurisdiction county-oes/),
      "An instance admin already exists; nothing was changed.",
    ]);
    expect(log.join("\n")).not.toContain(password);
  });
});

describe("envelope key rotation", () => {
  const OLD = "old-envelope-key-material";
  const NEW = "new-envelope-key-material";
  const plaintext = (table: string) => `secret held in ${table}`;

  it("re-encrypts every envelope column in one transaction", async () => {
    const [person] = await admin`
      insert into persons (email, display_name, password_hash)
      values ('rotate@county.example', 'Rotate', 'unused') returning id`;
    const personId = person!.id as string;
    const [jurisdiction] = await admin`
      insert into jurisdictions (slug, name) values ('rotate-county', 'Rotate County') returning id`;
    const jurisdictionId = jurisdiction!.id as string;
    await admin`
      insert into person_mfa (person_id, secret_envelope)
      values (${personId}, ${encryptSecret(plaintext("person_mfa"), OLD)})`;
    await admin`
      insert into ipaws_config (jurisdiction_id, cog_id, endpoint_url, credential_envelope)
      values (${jurisdictionId}, '999', 'https://ipaws.invalid/', ${encryptSecret(plaintext("ipaws_config"), OLD)})`;
    await admin`
      insert into collab_backends (jurisdiction_id, kind, base_url, token_envelope)
      values (${jurisdictionId}, 'mattermost', 'https://chat.invalid', ${encryptSecret(plaintext("collab_backends"), OLD)})`;
    await admin`
      insert into meeting_config (jurisdiction_id, base_url, secret_envelope)
      values (${jurisdictionId}, 'https://meet.invalid', ${encryptSecret(plaintext("meeting_config"), OLD)})`;
    await admin`
      insert into peers (jurisdiction_id, name, token_hash, created_by, endpoint_url, outbound_token)
      values (${jurisdictionId}, 'state', 'hash-a', ${personId}, 'https://state.invalid',
              ${encryptSecret(plaintext("peers"), OLD)})`;
    await admin`
      insert into federation_identity (public_key, private_key_envelope)
      values ('public', ${encryptSecret(plaintext("federation_identity"), OLD)})`;
    const envelopes = async () => {
      const found: Record<string, string> = {};
      for (const { table, column } of ENVELOPE_COLUMNS) {
        const rows = await admin.unsafe(`select ${column} as envelope from ${table} where ${column} is not null`);
        expect(rows, table).toHaveLength(1);
        found[table] = rows[0]!.envelope as string;
      }
      return found;
    };

    // One value the current key cannot open rolls the whole rotation back.
    const [stray] = await admin`
      insert into peers (jurisdiction_id, name, token_hash, created_by, outbound_token)
      values (${jurisdictionId}, 'stray', 'hash-b', ${personId}, ${encryptSecret("x", "some-other-key")})
      returning id`;
    const [before] = await admin`select secret_envelope from person_mfa`;
    await expect(rotateSecretKey(admin, OLD, NEW)).rejects.toThrow(
      new RegExp(`peers ${stray!.id as string} does not decrypt with the current key`),
    );
    const [after] = await admin`select secret_envelope from person_mfa`;
    expect(after!.secret_envelope).toBe(before!.secret_envelope);
    await admin`delete from peers where id = ${stray!.id as string}`;

    await expect(rotateSecretKey(admin, OLD, OLD)).rejects.toThrow(/must differ/);
    const counts = await rotateSecretKey(admin, OLD, NEW);
    expect(counts).toEqual({ person_mfa: 1, ipaws_config: 1, collab_backends: 1, meeting_config: 1, peers: 1, federation_identity: 1 });
    for (const [table, envelope] of Object.entries(await envelopes())) {
      expect(decryptSecret(envelope, NEW), table).toBe(plaintext(table));
      expect(() => decryptSecret(envelope, OLD), table).toThrow();
    }
  });
});

describe("connector timeouts", () => {
  let silent: Server;
  let url: string;

  beforeAll(async () => {
    // Accepts the connection and never answers.
    silent = createServer(() => undefined);
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(silent.address() as AddressInfo).port}/`;
  });

  afterAll(async () => {
    silent.closeAllConnections();
    await new Promise((resolve) => silent.close(resolve));
  });

  it("abandons a collaboration backend that never answers", async () => {
    const started = Date.now();
    await expect(collabTransport({ method: "GET", url, headers: {} }, 200)).rejects.toThrow(/timeout/i);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("abandons an IPAWS endpoint that never answers", async () => {
    const started = Date.now();
    await expect(
      ipawsTransport(
        { method: "POST", url, headers: { "content-type": "text/xml" }, body: "<alert/>", signedAlert: "<alert/>" },
        200,
      ),
    ).rejects.toThrow(/timeout/i);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
