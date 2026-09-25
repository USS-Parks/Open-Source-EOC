import { useState } from "react";
import { Button, Panel, TextField } from "../../design/components.js";
import type { MfaChallenge } from "../api/client.js";
import { MfaStep } from "../auth/MfaStep.js";
import { useSession } from "../auth/session.js";
import { trustCertificateUrl } from "../config.js";
import "../auth/sign-in.css";

/** How to trust a host's own certificate authority, once per computer. */
function TrustThisServer({ url }: { readonly url: string }) {
  return (
    <details className="sign-in-trust">
      <summary>Trust this server</summary>
      <p className="eoc-muted">
        This server's certificate comes from its own certificate authority. Install the authority once on each
        computer and the browser trusts the connection without a warning.
      </p>
      <p>
        <a href={url} download="open-source-eoc-root.crt">Download the certificate</a>
      </p>
      <p>
        <strong>Windows:</strong> open the file, choose Install Certificate, then Local Machine, then "Place all
        certificates in the following store", and choose Trusted Root Certification Authorities. Restart the browser.
      </p>
      <p>
        <strong>macOS:</strong> open the file to add it to the System keychain, then open it in Keychain Access, expand
        Trust and set "When using this certificate" to Always Trust. Restart the browser.
      </p>
    </details>
  );
}

/** The sign-in surface shown while the session is anonymous. */
export function Login() {
  const { login, error } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const trustUrl = trustCertificateUrl();

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
            {trustUrl ? <TrustThisServer url={trustUrl} /> : null}
          </div>
        </Panel>
      </form>
    </main>
  );
}
