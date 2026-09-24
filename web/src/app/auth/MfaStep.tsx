import { useEffect, useState } from "react";
import { Button, Panel, TextField } from "../../design/components.js";
import type { MfaChallenge } from "../api/client.js";
import { useSession } from "./session.js";
import "./sign-in.css";

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
      <div className="sign-in-box is-wide">
        <Panel title="Save your recovery codes">
          <p className="sign-in-lead">
            Each code signs you in once if you lose your authenticator. Print or copy them
            and store them offline now. They will not be shown again.
          </p>
          <ol aria-label="Recovery codes" className="sign-in-code sign-in-codes">
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
      className="sign-in-box is-wide"
    >
      <Panel title={enrolling ? "Set up two-step sign-in" : "Two-step sign-in"}>
        <div className="eoc-stack">
          {enrolling ? (
            <>
              <p className="eoc-flush">
                Administrator accounts need an authenticator app. Add this account to your app
                with the setup key, then enter the six-digit code it shows.
              </p>
              {setup ? (
                <>
                  <div>
                    <div className="eoc-muted">Setup key</div>
                    <code aria-label="Setup key" className="sign-in-code">
                      {setup.secret.match(/.{1,4}/g)?.join(" ")}
                    </code>
                  </div>
                  <div>
                    <div className="eoc-muted">Setup link</div>
                    <a href={setup.otpauthUri} className="sign-in-code">{setup.otpauthUri}</a>
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <p className="eoc-flush">
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
            <p role="alert" className="eoc-flush eoc-text-critical">{error}</p>
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
