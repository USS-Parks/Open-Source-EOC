import { useEffect, useState } from "react";
import { Button, Panel, TextField } from "../../design/components.js";
import type { MfaChallenge } from "../api/client.js";
import { useSession } from "./session.js";

const mono = { fontFamily: "var(--eoc-font-mono, monospace)", overflowWrap: "anywhere" } as const;

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Verification failed.";
}

/**
 * The second sign-in step. An enrolled person enters an authenticator code
 * or a recovery code. A person who must enroll first is shown the setup key,
 * confirms it with a first code, and then sees the recovery codes once
 * before entering the console.
 */
export function MfaStep(props: { challenge: MfaChallenge; onCancel: () => void }) {
  const { client, completeSignIn } = useSession();
  const { mfaToken } = props.challenge;
  const enrolling = Boolean(props.challenge.mfaEnrollmentRequired);
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enrolling) return;
    let cancelled = false;
    client.mfaEnroll(mfaToken).then(
      (next) => { if (!cancelled) setSetup(next); },
      (cause: unknown) => { if (!cancelled) setError(message(cause)); },
    );
    return () => { cancelled = true; };
  }, [client, enrolling, mfaToken]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (enrolling) setRecoveryCodes(await client.mfaActivate(mfaToken, code.trim()));
      else {
        await client.mfaVerify(mfaToken, code.trim());
        await completeSignIn();
      }
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  if (recoveryCodes) {
    return (
      <div style={{ width: "min(420px, 100%)" }}>
        <Panel title="Save your recovery codes">
          <p style={{ marginTop: 0 }}>
            Each code signs you in once if you lose your authenticator. Print or copy them
            and store them offline now. They will not be shown again.
          </p>
          <ol aria-label="Recovery codes" style={{ ...mono, columns: 2, margin: "0 0 16px" }}>
            {recoveryCodes.map((recovery) => <li key={recovery}>{recovery}</li>)}
          </ol>
          <Button kind="primary" onClick={() => void completeSignIn()}>
            I have stored these codes
          </Button>
        </Panel>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      style={{ width: "min(420px, 100%)" }}
    >
      <Panel title={enrolling ? "Set up two-step sign-in" : "Two-step sign-in"}>
        <div style={{ display: "grid", gap: 12 }}>
          {enrolling ? (
            <>
              <p style={{ margin: 0 }}>
                Administrator accounts need an authenticator app. Add this account to your app
                with the setup key, then enter the six-digit code it shows.
              </p>
              {setup ? (
                <>
                  <div>
                    <div style={{ color: "var(--eoc-text-muted)" }}>Setup key</div>
                    <code aria-label="Setup key" style={mono}>
                      {setup.secret.match(/.{1,4}/g)?.join(" ")}
                    </code>
                  </div>
                  <div>
                    <div style={{ color: "var(--eoc-text-muted)" }}>Setup link</div>
                    <a href={setup.otpauthUri} style={mono}>{setup.otpauthUri}</a>
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <p style={{ margin: 0 }}>
              Enter the six-digit code from your authenticator app, or one of your recovery codes.
            </p>
          )}
          <TextField
            label={enrolling ? "Authenticator code" : "Authenticator or recovery code"}
            value={code}
            onChange={setCode}
            required
          />
          {error ? (
            <p role="alert" style={{ margin: 0, color: "var(--eoc-status-critical)" }}>{error}</p>
          ) : null}
          <Button kind="primary" type="submit" disabled={busy || (enrolling && !setup)}>
            {busy ? "Verifying…" : "Verify"}
          </Button>
          <Button onClick={props.onCancel}>Back to sign in</Button>
        </div>
      </Panel>
    </form>
  );
}
