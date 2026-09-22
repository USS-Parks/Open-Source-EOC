import {
  CapAlertSchema,
  CAP_CATEGORY,
  CAP_CERTAINTY,
  CAP_MSGTYPE,
  CAP_SCOPE,
  CAP_SEVERITY,
  CAP_STATUS,
  CAP_URGENCY,
  type CapAlert,
} from "./model.js";

/**
 * CAP validation. Two layers: the base CAP 1.2 schema, and the
 * FEMA IPAWS Profile v1.0 on top of it. Authoring runs both, because an
 * alert bound for IPAWS must satisfy the profile, while an internal or
 * partner alert need only be valid CAP.
 */

export interface CapIssue {
  readonly path: string;
  readonly message: string;
}

const inSet = (v: string, set: readonly string[]): boolean => set.includes(v);

/** Base CAP 1.2 structural validation. */
export function validateCap12(raw: unknown): CapIssue[] {
  const parsed = CapAlertSchema.safeParse(raw);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  }
  const alert = parsed.data;
  const issues: CapIssue[] = [];
  if (!inSet(alert.status, CAP_STATUS)) issues.push({ path: "status", message: "invalid status" });
  if (!inSet(alert.msgType, CAP_MSGTYPE))
    issues.push({ path: "msgType", message: "invalid msgType" });
  if (!inSet(alert.scope, CAP_SCOPE)) issues.push({ path: "scope", message: "invalid scope" });
  // A non-cancel/ack alert carries at least one info block.
  if ((alert.msgType === "Alert" || alert.msgType === "Update") && alert.info.length === 0)
    issues.push({ path: "info", message: "an Alert/Update requires at least one info block" });
  alert.info.forEach((info, i) => {
    const p = `info[${i}]`;
    if (info.category.length === 0) issues.push({ path: `${p}.category`, message: "required" });
    for (const c of info.category)
      if (!inSet(c, CAP_CATEGORY)) issues.push({ path: `${p}.category`, message: `invalid: ${c}` });
    if (!inSet(info.urgency, CAP_URGENCY))
      issues.push({ path: `${p}.urgency`, message: "invalid urgency" });
    if (!inSet(info.severity, CAP_SEVERITY))
      issues.push({ path: `${p}.severity`, message: "invalid severity" });
    if (!inSet(info.certainty, CAP_CERTAINTY))
      issues.push({ path: `${p}.certainty`, message: "invalid certainty" });
  });
  return issues;
}

/**
 * FEMA IPAWS Profile v1.0 on top of base CAP. Enforces the profile's
 * load-bearing constraints: the IPAWS code, and per-info an expiry,
 * sender name, description, a SAME event code, and a targeted area.
 */
export function validateIpawsProfile(raw: unknown): CapIssue[] {
  const base = validateCap12(raw);
  if (base.length > 0) return base;
  const alert = raw as CapAlert;
  const issues: CapIssue[] = [];
  if (!(alert.code ?? []).includes("IPAWSv1.0"))
    issues.push({ path: "code", message: "IPAWS profile requires code IPAWSv1.0" });
  if (alert.info.length === 0)
    issues.push({ path: "info", message: "IPAWS alert requires an info block" });
  alert.info.forEach((info, i) => {
    const p = `info[${i}]`;
    if (!info.expires) issues.push({ path: `${p}.expires`, message: "IPAWS requires expires" });
    if (!info.effective)
      issues.push({ path: `${p}.effective`, message: "IPAWS requires effective" });
    if (!info.senderName)
      issues.push({ path: `${p}.senderName`, message: "IPAWS requires senderName" });
    if (!info.description)
      issues.push({ path: `${p}.description`, message: "IPAWS requires description" });
    const hasSame = (info.eventCode ?? []).some((c) => c.valueName === "SAME" && c.value);
    if (!hasSame)
      issues.push({ path: `${p}.eventCode`, message: "IPAWS requires a SAME eventCode" });
    const areas = info.area ?? [];
    const targeted = areas.some(
      (a) => (a.geocode ?? []).length > 0 || (a.polygon ?? []).length > 0 || (a.circle ?? []).length > 0,
    );
    if (!targeted)
      issues.push({
        path: `${p}.area`,
        message: "IPAWS requires an area with a geocode, polygon, or circle",
      });
  });
  return issues;
}

export function isValidCap12(raw: unknown): boolean {
  return validateCap12(raw).length === 0;
}

export function isIpawsEligible(raw: unknown): boolean {
  return validateIpawsProfile(raw).length === 0;
}
