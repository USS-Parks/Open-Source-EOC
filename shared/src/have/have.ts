import { XMLBuilder } from "fast-xml-parser";

/**
 * EDXL-HAVE 2.0 export (F10/F20). Hospital AVailability Exchange:
 * the standing facility-status picture serialized to the OASIS HAVE shape
 * so a jurisdiction's status board leaves the platform as a standard
 * others can consume. Export only; the always-on board is the source.
 */

export const HAVE_NS = "urn:oasis:names:tc:emergency:EDXL:HAVE:2.0";

export interface BedReport {
  readonly bedType: string;
  readonly available: number;
  readonly baseline: number;
}

export interface FacilitySnapshot {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly facilityKind: string;
  readonly operatingStatus: string;
  readonly emsTraffic?: string | undefined;
  readonly beds: readonly BedReport[];
  readonly capabilities?: readonly string[] | undefined;
  readonly lastUpdate: string;
  readonly stale: boolean;
}

function drop<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

function facilityNode(f: FacilitySnapshot): Record<string, unknown> {
  return drop({
    OrganizationInformation: {
      OrganizationID: f.organizationId,
      OrganizationName: f.organizationName,
      OrganizationKind: f.facilityKind,
    },
    EMSTraffic: f.emsTraffic ? { EMSTrafficStatus: f.emsTraffic } : undefined,
    HospitalBedCapacityStatus:
      f.beds.length > 0
        ? {
            BedCapacity: f.beds.map((b) => ({
              BedType: b.bedType,
              AvailableCount: String(b.available),
              BaselineCount: String(b.baseline),
            })),
          }
        : undefined,
    HospitalFacilityStatus: { FacilityStatus: f.operatingStatus },
    HospitalServiceCoverageStatus:
      f.capabilities && f.capabilities.length
        ? { ServiceCovered: f.capabilities.map((c) => ({ Service: c })) }
        : undefined,
    LastUpdateTime: f.lastUpdate,
    Stale: f.stale ? "true" : "false",
  });
}

export function haveToXml(snapshots: readonly FacilitySnapshot[]): string {
  const tree = {
    "EDXL-HAVE": {
      "@_xmlns": HAVE_NS,
      Hospital: snapshots.map(facilityNode),
    },
  };
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    format: true,
    suppressEmptyNode: true,
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(tree)}`;
}
