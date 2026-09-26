import { z } from "zod";

/**
 * The contacts directory's request shapes: a contact as an administrator
 * writes it, and the area a sender draws to find the contacts inside it.
 * A contact may carry a street address, which the offline gazetteer places
 * on the map, and a stored point, used before the address.
 */

export const E164PhoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/, "phone numbers use E.164 form, for example +17075551234");

/** A position in WGS84 as GeoJSON: longitude, then latitude. */
export const GeoPointSchema = z.object({
  type: z.literal("Point"),
  coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
});
export type GeoPoint = z.infer<typeof GeoPointSchema>;

export const CONTACT_ADDRESS_MAX = 300;

/** The most contacts one mass notification reaches. */
export const MASS_SEND_MAX_RECIPIENTS = 500;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

const optionalText = (max: number) =>
  z.string().trim().max(max).nullish().transform((v) => v || null);

export const ContactInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  organization: optionalText(200),
  title: optionalText(200),
  emails: z.array(z.email()).max(5).default([]),
  phones: z.array(E164PhoneSchema).max(5).default([]),
  personId: z.string().uuid().nullable().default(null),
  positionId: z.string().uuid().nullable().default(null),
  notes: optionalText(2000),
  active: z.boolean().default(true),
  /** A street address: house number, street, town. Null or blank clears it; leaving it out keeps what is stored. */
  address: z.string().trim().max(CONTACT_ADDRESS_MAX)
    .refine((v) => !CONTROL.test(v), "an address may not hold control characters").nullable().optional()
    .transform((v) => (v === undefined ? undefined : v || null)),
  /** A point on the map; null clears it, and leaving it out keeps what is stored. */
  location: GeoPointSchema.nullable().optional(),
});
export type ContactInputBody = z.infer<typeof ContactInputSchema>;

/** Corners an area search may have in all; an area drawn by hand has tens. */
export const CONTACT_AREA_MAX_VERTICES = 2000;

const Position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const Ring = z.array(Position).min(4).refine(
  (ring) => ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1],
  "each ring of the area must end where it starts",
);
const Polygon = z.array(Ring).min(1).max(20);

export const ContactAreaSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Polygon"), coordinates: Polygon }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(Polygon).min(1).max(20) }),
]).refine(
  (area) => (area.type === "Polygon" ? [area.coordinates] : area.coordinates).flat(2).length <= CONTACT_AREA_MAX_VERTICES,
  `the area may have at most ${CONTACT_AREA_MAX_VERTICES} corners`,
);
export type ContactArea = z.infer<typeof ContactAreaSchema>;

export const ContactAreaQuerySchema = z.object({ area: ContactAreaSchema });
