import { TRUST_PATH } from "./host.mjs";

/**
 * Connecting the installed app to a network host instead of its own server.
 * The address is the host's origin: HTTPS, or plain HTTP to this computer
 * alone, since a password must never cross the network in the clear.
 */
export function hostAddress(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw new Error(`Not a web address: ${raw}. Give the host's address, for example https://eoc.county.example`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
    throw new Error("A network host is reached over HTTPS; its address starts with https://");
  if (url.username || url.password) throw new Error("The host's address carries no user name or password");
  return url.origin;
}

const UNTRUSTED = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_UNTRUSTED",
]);

/**
 * What to tell a person whose connection check failed, as launcher lines: the
 * first names the outcome for scripts, the rest are the steps. Null when the
 * error is not one this check explains.
 */
export function connectionAdvice(error, origin) {
  const code = error?.cause?.code ?? error?.code;
  if (UNTRUSTED.has(code)) {
    return [
      `CONNECT_UNTRUSTED url=${origin}`,
      "This computer does not yet trust the host's certificate, so the window will show a warning.",
      `Download the host's root certificate from ${origin}${TRUST_PATH} (past the warning) or get it`,
      "from the host's administrator. Open the file and compare the Thumbprint on its Details tab with",
      "the one Test-OpenEOCHost.ps1 shows on the host; only if they match, choose Install Certificate,",
      "Local Machine (or Current User without administrator rights), and place it in Trusted Root",
      "Certification Authorities. Then open Open Source EOC on the network host again.",
    ];
  }
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID") {
    return [
      `CONNECT_WRONG_NAME url=${origin}`,
      "The host's certificate does not name this address. Use the name the host's administrator gave,",
      "the one Test-OpenEOCHost.ps1 lists on the host.",
    ];
  }
  if (["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH"].includes(code)
    || error?.name === "TimeoutError") {
    return [
      `CONNECT_UNREACHABLE url=${origin}`,
      "The host did not answer. Check this computer is on the host's network, and ask its administrator",
      "whether the host is running.",
    ];
  }
  return null;
}
