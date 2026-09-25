import { useEffect, useRef, useState } from "react";
import SignaturePad from "signature_pad";
import type { SignatureValue } from "@openeoc/shared";
import { ActionButton } from "./controls.js";

/**
 * A signature field (VA9): a pad to draw on, or the signer's name typed and
 * set in script on the same pad for anyone who signs without a pointer, and
 * who signs. **Sign** stores the image as a file, as an attachment is, and the
 * field keeps the file, the signer and the time.
 */
export function SignatureInput(props: {
  readonly id: string;
  readonly label: string;
  readonly value: unknown;
  readonly disabled: boolean;
  readonly describedBy?: string | undefined;
  readonly defaultSigner?: string | undefined;
  readonly onUpload: (file: File) => Promise<string>;
  readonly onChange: (value: SignatureValue | undefined) => void;
  readonly onPendingChange: (pending: boolean) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pad = useRef<SignaturePad | null>(null);
  const [drawn, setDrawn] = useState(false);
  const [signer, setSigner] = useState(props.defaultSigner ?? "");
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signed = signatureOf(props.value);
  const [resigning, setResigning] = useState(false);
  const drawing = !signed || resigning;

  useEffect(() => {
    const element = canvas.current;
    if (!drawing || !element) return;
    // The pad draws in device pixels, so it is sized to the canvas as shown.
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    element.width = Math.max(element.offsetWidth, 1) * ratio;
    element.height = Math.max(element.offsetHeight, 1) * ratio;
    const context = element.getContext("2d");
    if (!context) { setAvailable(false); return; }
    context.scale(ratio, ratio);
    const instance = new SignaturePad(element, { backgroundColor: "rgb(255, 255, 255)", penColor: "rgb(17, 24, 39)" });
    const stroke = () => { setDrawn(!instance.isEmpty()); setError(null); };
    instance.addEventListener("endStroke", stroke);
    pad.current = instance;
    return () => {
      instance.removeEventListener("endStroke", stroke);
      instance.off();
      pad.current = null;
    };
  }, [drawing]);

  const clear = () => { pad.current?.clear(); setDrawn(false); setError(null); };

  /** The signer's name set in script on the pad, in place of a drawing. */
  const typeName = () => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context || !pad.current || !signer.trim()) return;
    pad.current.clear();
    context.fillStyle = "rgb(17, 24, 39)";
    context.font = `italic 32px "Brush Script MT", "Segoe Script", cursive`;
    context.textBaseline = "middle";
    context.fillText(signer.trim(), 16, element.offsetHeight / 2, element.offsetWidth - 32);
    setDrawn(true);
  };

  const sign = async () => {
    const element = canvas.current;
    if (!element || !drawn) { setError("Draw a signature, or type your name and set it on the pad."); return; }
    if (!signer.trim()) { setError("Enter who is signing."); return; }
    setBusy(true); setError(null); props.onPendingChange(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) => element.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("The signature could not be captured.");
      const fileId = await props.onUpload(new File([blob], "signature.png", { type: "image/png" }));
      props.onChange({ fileId, signer: signer.trim(), signedAt: new Date().toISOString() });
      setResigning(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The signature could not be stored.");
    } finally {
      setBusy(false); props.onPendingChange(false);
    }
  };

  return (
    <fieldset className="eoc-signature" aria-describedby={props.describedBy} disabled={props.disabled || busy}>
      <legend>{props.label}</legend>
      {!drawing && signed ? (
        <p className="eoc-signature-signed">
          <span role="status">Signed by {signed.signer}, {new Date(signed.signedAt).toLocaleString()}</span>
          <ActionButton onClick={() => { setResigning(true); setDrawn(false); }}>Sign again</ActionButton>
        </p>
      ) : (
        <>
          <label htmlFor={`${props.id}-signer`}>Signed by
            <input id={`${props.id}-signer`} value={signer} onChange={(event) => setSigner(event.target.value)} />
          </label>
          {available ? (
            <canvas ref={canvas} id={props.id} className="eoc-signature-pad" role="img"
              aria-label={`${props.label}: draw with a mouse, pen or finger`} />
          ) : <p>Drawing is unavailable here. Type your name to sign.</p>}
          <div className="eoc-signature-actions">
            <ActionButton kind="primary" onClick={() => void sign()}>Sign</ActionButton>
            <ActionButton onClick={typeName} disabled={!signer.trim() || !available}>Use my typed name</ActionButton>
            <ActionButton kind="quiet" onClick={clear} disabled={!available}>Clear</ActionButton>
            {signed ? <ActionButton kind="quiet" onClick={() => setResigning(false)}>Keep the signature</ActionButton> : null}
          </div>
          {busy ? <span role="status">Storing the signature…</span> : null}
        </>
      )}
      {error ? <p role="alert" className="eoc-form-inline-error">{error}</p> : null}
    </fieldset>
  );
}

/** A stored signature: its image, read with the viewer's own access, and who signed when. */
export function SignatureView(props: { readonly value: unknown; readonly load?: ((fileId: string) => Promise<Blob>) | undefined }) {
  const signed = signatureOf(props.value);
  const [url, setUrl] = useState<string | null>(null);
  const fileId = signed?.fileId ?? null;
  const { load } = props;
  useEffect(() => {
    if (!fileId || !load) return;
    let live = true;
    let made: string | null = null;
    load(fileId).then((blob) => {
      if (!live) return;
      made = URL.createObjectURL(blob);
      setUrl(made);
    }).catch(() => undefined);
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [fileId, load]);
  if (!signed) return <>Unavailable</>;
  return (
    <span className="eoc-signature-view">
      {url ? <img src={url} alt={`Signature of ${signed.signer}`} /> : null}
      <span>Signed by {signed.signer}, {new Date(signed.signedAt).toLocaleString()}</span>
    </span>
  );
}

function signatureOf(value: unknown): SignatureValue | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<SignatureValue>;
  return typeof v.fileId === "string" && typeof v.signer === "string" && typeof v.signedAt === "string"
    ? { fileId: v.fileId, signer: v.signer, signedAt: v.signedAt } : null;
}
