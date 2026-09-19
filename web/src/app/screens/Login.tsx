import { useState } from "react";
import { Button, Panel, TextField } from "../../design/components.js";
import { useSession } from "../auth/session.js";

/** The sign-in surface shown while the session is anonymous. */
export function Login() {
  const { login, error } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await login(email, password);
    } catch {
      // The failure message is surfaced from session state below.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        style={{ width: "min(380px, 100%)" }}
      >
        <Panel title="Open Source EOC">
          <p style={{ marginTop: 0, color: "var(--eoc-text-muted)" }}>
            Sign in to the operations console.
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            <TextField label="Email" value={email} onChange={setEmail} required />
            <TextField label="Password" type="password" value={password} onChange={setPassword} required />
            {error ? (
              <p role="alert" style={{ margin: 0, color: "var(--eoc-status-critical)" }}>
                {error}
              </p>
            ) : null}
            <Button kind="primary" type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </div>
        </Panel>
      </form>
    </div>
  );
}
