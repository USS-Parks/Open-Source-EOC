import { useState } from "react";
import { Button, Panel, TextField } from "../../design/components.js";
import type { MfaChallenge } from "../api/client.js";
import { MfaStep } from "../auth/MfaStep.js";
import { useSession } from "../auth/session.js";
import "../auth/sign-in.css";

/** The sign-in surface shown while the session is anonymous. */
export function Login() {
  const { login, error } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);

  async function submit() {
    setBusy(true);
    try {
      setChallenge(await login(email, password));
    } catch {
      // The failure message is surfaced from session state below.
    } finally {
      setBusy(false);
    }
  }

  if (challenge) {
    return (
      <main className="sign-in-frame">
        <MfaStep challenge={challenge} onCancel={() => { setChallenge(null); setPassword(""); }} />
      </main>
    );
  }

  return (
    <main className="sign-in-frame">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="sign-in-box"
      >
        <Panel title="Open Source EOC" level={1}>
          <p className="sign-in-lead eoc-muted">
            Sign in to the operations console.
          </p>
          <div className="eoc-stack">
            <TextField label="Email" value={email} onChange={setEmail} required />
            <TextField label="Password" type="password" value={password} onChange={setPassword} required />
            {error ? (
              <p role="alert" className="eoc-flush eoc-text-critical">
                {error}
              </p>
            ) : null}
            <Button kind="primary" type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </div>
        </Panel>
      </form>
    </main>
  );
}
