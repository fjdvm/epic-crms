import type postgres from "postgres";

import { DEFAULT_SCHEMA } from "@/features/notifications/notifications";

import { validateWalkIn, type WalkInAddress, type WalkInData, type WalkInField, type WalkInInput } from "./walk-in-rules";

/** Walk-in Customer ids carry this prefix, so a profile URL says which kind of person it is. */
export const WALK_IN_ID_PREFIX = "w-";

export function isWalkInId(id: string): boolean {
  return id.startsWith(WALK_IN_ID_PREFIX);
}

/** The schema name goes into SQL text, so it must be a plain identifier. */
function schemaIdent(sql: postgres.Sql, schema: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`Invalid schema name: ${schema}`);

  return sql(schema);
}

/** What the unified list needs of a Walk-in Customer. */
export interface WalkInSummary {
  id: string;
  name: string;
  email: string;
  contactNumber: string;
  createdAt: Date;
}

export interface WalkInProfileData extends WalkInData {
  id: string;
  name: string;
  createdAt: Date;
}

export interface ExistingProfile {
  id: string;
  name: string;
  /** The Customer or Walk-in Customer already holds this. */
  field: "email" | "mobile";
}

export type AddWalkInResult =
  | { ok: true; id: string }
  | { ok: false; errors: Partial<Record<WalkInField, string>> }
  | { ok: false; duplicate: ExistingProfile };

/** A verified Customer, or a Walk-in Customer, that already holds this email or mobile number. */
async function findExisting(
  reader: postgres.Sql,
  writer: postgres.Sql,
  s: ReturnType<typeof schemaIdent>,
  email: string | null,
  mobile: string,
): Promise<ExistingProfile | null> {
  const [customer] = await reader<{ id: string; name: string; by_email: boolean }[]>`
    select c.id, c.full_name as name, (${email}::text is not null and lower(c.email) = ${email}::text) as by_email
    from public.customers c
    join neon_auth."user" u on u.id::text = c.id and u."emailVerified"
    where (${email}::text is not null and lower(c.email) = ${email}::text)
       or regexp_replace(regexp_replace(regexp_replace(c.contact_number, '[^0-9]', '', 'g'), '^63', '0'), '^9', '09') = ${mobile}
    order by by_email desc
    limit 1`;

  if (customer) return { id: customer.id, name: customer.name, field: customer.by_email ? "email" : "mobile" };

  const [walkIn] = await writer<{ id: string; name: string; by_email: boolean }[]>`
    select ${WALK_IN_ID_PREFIX} || id::text as id, first_name || ' ' || last_name as name,
           (${email}::text is not null and email = ${email}::text) as by_email
    from ${s}.walk_in_customers
    where (${email}::text is not null and email = ${email}::text) or mobile = ${mobile}
    order by by_email desc
    limit 1`;

  return walkIn ? { id: walkIn.id, name: walkIn.name, field: walkIn.by_email ? "email" : "mobile" } : null;
}

/**
 * Saves a Walk-in Customer in CREOMS's own schema. The storefront is only read, to refuse an email
 * or mobile number that already belongs to a Customer. `reader` is the read-only storefront role;
 * `writer` is the creoms_writer role and the only connection that is ever written through.
 */
export async function addWalkIn(
  reader: postgres.Sql,
  writer: postgres.Sql,
  input: WalkInInput,
  schema: string = DEFAULT_SCHEMA,
): Promise<AddWalkInResult> {
  const validation = validateWalkIn(input);
  if (!validation.ok) return validation;

  const s = schemaIdent(writer, schema);
  const w = validation.value;

  const existing = await findExisting(reader, writer, s, w.email, w.mobile);
  if (existing) return { ok: false, duplicate: existing };

  try {
    const [row] = await writer<{ id: string }[]>`
      insert into ${s}.walk_in_customers (
        first_name, last_name, mobile, email, birthday, preferred_contact, source, tags,
        email_consent, sms_consent, notes,
        address_street, address_province, address_city, address_barangay, address_zip, address_landmark
      ) values (
        ${w.firstName}, ${w.lastName}, ${w.mobile}, ${w.email}, ${w.birthday}, ${w.preferredContact},
        ${w.source}, ${w.tags}::text[], ${w.emailConsent}, ${w.smsConsent}, ${w.notes},
        ${w.address?.street ?? null}, ${w.address?.province ?? null}, ${w.address?.city ?? null},
        ${w.address?.barangay ?? null}, ${w.address?.zip ?? null}, ${w.address?.landmark ?? null}
      )
      returning id::text`;

    return { ok: true, id: WALK_IN_ID_PREFIX + row.id };
  } catch (error) {
    // A concurrent save of the same person: the unique indexes refused it, so name who won.
    if ((error as { code?: string }).code === "23505") {
      const winner = await findExisting(reader, writer, s, w.email, w.mobile);
      if (winner) return { ok: false, duplicate: winner };
    }

    throw error;
  }
}

/** Every Walk-in Customer, for the unified Customer list. */
export async function listWalkIns(writer: postgres.Sql, schema: string = DEFAULT_SCHEMA): Promise<WalkInSummary[]> {
  const s = schemaIdent(writer, schema);

  const rows = await writer<
    { id: string; name: string; email: string | null; mobile: string; created_at: Date }[]
  >`
    select ${WALK_IN_ID_PREFIX} || id::text as id, first_name || ' ' || last_name as name, email, mobile, created_at
    from ${s}.walk_in_customers`;

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email ?? "",
    contactNumber: r.mobile,
    createdAt: r.created_at,
  }));
}

/** One Walk-in Customer, or null for an id that is not one. */
export async function getWalkIn(
  writer: postgres.Sql,
  id: string,
  schema: string = DEFAULT_SCHEMA,
): Promise<WalkInProfileData | null> {
  const uuid = id.slice(WALK_IN_ID_PREFIX.length);
  if (!isWalkInId(id) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) return null;

  const s = schemaIdent(writer, schema);

  const [r] = await writer<Record<string, unknown>[]>`
    select *, birthday::text as birthday_text from ${s}.walk_in_customers where id = ${uuid}::uuid`;

  if (!r) return null;

  const address: WalkInAddress = {
    street: (r.address_street as string | null) ?? "",
    province: (r.address_province as string | null) ?? "",
    city: (r.address_city as string | null) ?? "",
    barangay: (r.address_barangay as string | null) ?? "",
    zip: (r.address_zip as string | null) ?? "",
    landmark: (r.address_landmark as string | null) ?? "",
  };

  return {
    id,
    name: `${r.first_name} ${r.last_name}`,
    firstName: r.first_name as string,
    lastName: r.last_name as string,
    mobile: r.mobile as string,
    email: (r.email as string | null) ?? null,
    birthday: (r.birthday_text as string | null) ?? null,
    preferredContact: (r.preferred_contact as string | null) ?? null,
    source: (r.source as string | null) ?? null,
    tags: r.tags as string[],
    emailConsent: r.email_consent as boolean,
    smsConsent: r.sms_consent as boolean,
    notes: (r.notes as string | null) ?? null,
    address: Object.values(address).some(Boolean) ? address : null,
    createdAt: r.created_at as Date,
  };
}
