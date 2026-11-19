import type postgres from "postgres";

/** The ID photo is kept this long while it waits for review; then the storefront removes it. */
export const PHOTO_REVIEW_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

export type VerificationStatus = "pending" | "approved" | "declined" | "revoked" | "expired";
export type IdType = "senior" | "pwd";

/**
 * What Staff may see of one verification. The ID number and its hash are never selected: the
 * storefront keeps only the keyed hash, and CREOMS has no grant on that column.
 */
export interface Verification {
  id: number;
  customerId: string;
  customerName: string;
  /** The Customer's email with most of it hidden, such as `lito.r@...`. The full address never reaches the browser. */
  customerEmailHint: string;
  /** The Order this ID holds (it cannot be confirmed until the ID is reviewed); null when the Customer has none waiting. */
  orderId: number | null;
  idType: IdType;
  status: VerificationStatus;
  submittedAt: Date;
  /** Null once the photo has been deleted (after review, or after 7 days). */
  photoFileId: string | null;
  /** The back of the ID, when the number is there; null once deleted or never sent. */
  photoBackFileId: string | null;
  photoExpiresAt: Date;
  decidedByName: string | null;
  decidedAt: Date | null;
  declineReason: string | null;
  /** The ID's expiry date, `YYYY-MM-DD`. The discount stops on this date. */
  expiresOn: string | null;
}

export interface VerificationList { pending: Verification[]; decided: Verification[] }

type Row = Record<string, unknown>;

const SELECT = (sql: postgres.Sql) => sql<Row[]>`
  select v.id, v.customer_id, c.full_name, v.id_type, v.status, v.submitted_at, v.photo_file_id, v.photo_back_file_id,
    v.decided_by_name, v.decided_at, v.decline_reason, to_char(v.expires_on, 'YYYY-MM-DD') as expires_on,
    c.email, held.id as order_id
  from public.senior_pwd_verifications v join public.customers c on c.id = v.customer_id
  left join lateral (
    select o.id from public.orders o where o.senior_pwd_verification_id = v.id order by o.id desc limit 1
  ) held on true`;

/** `lito.ramos@example.com` becomes `lito.r@...`: enough for Staff to tell two Customers apart, never the address. */
export function emailHint(email: unknown): string {
  const local = typeof email === "string" ? email.split("@")[0] : "";
  return local ? `${local.slice(0, 6)}@...` : "";
}

function toVerification(row: Row): Verification {
  const submittedAt = row.submitted_at as Date;
  return {
    id: row.id as number, customerId: row.customer_id as string, customerName: row.full_name as string,
    customerEmailHint: emailHint(row.email), orderId: (row.order_id as number | null) ?? null,
    idType: row.id_type as IdType, status: row.status as VerificationStatus, submittedAt,
    photoFileId: (row.photo_file_id as string | null) ?? null,
    photoBackFileId: (row.photo_back_file_id as string | null) ?? null,
    photoExpiresAt: new Date(submittedAt.getTime() + PHOTO_REVIEW_DAYS * DAY),
    decidedByName: (row.decided_by_name as string | null) ?? null, decidedAt: (row.decided_at as Date | null) ?? null,
    declineReason: (row.decline_reason as string | null) ?? null, expiresOn: (row.expires_on as string | null) ?? null,
  };
}

/** Today in Philippine Time, as `YYYY-MM-DD`. */
export function philippineToday(now: Date): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * What the Customer is, as of now. A pending one whose photo is past 7 days has been removed and the
 * Customer must upload again; an approved one stops on its expiry date.
 */
export function currentStatus(v: Pick<Verification, "status" | "expiresOn" | "photoExpiresAt">, now: Date): VerificationStatus {
  if (v.status === "pending" && v.photoExpiresAt.getTime() <= now.getTime()) return "expired";
  if (v.status === "approved" && v.expiresOn !== null && v.expiresOn <= philippineToday(now)) return "expired";
  return v.status;
}

export async function loadVerification(sql: postgres.Sql, id: number): Promise<Verification | null> {
  const [row] = await sql<Row[]>`${SELECT(sql)} where v.id = ${id}`;
  return row ? toVerification(row) : null;
}

/** Waiting reviews, oldest first, then the latest decisions. A lapsed pending one is history, not work. */
export async function listVerifications(sql: postgres.Sql, now: Date, historyLimit = 50): Promise<VerificationList> {
  // Each row carries its status as of now, so a lapsed photo or ID reads "expired".
  const rows = (await sql<Row[]>`${SELECT(sql)} order by v.submitted_at, v.id`)
    .map(toVerification).map(v => ({ ...v, status: currentStatus(v, now) }));
  const pending = rows.filter(v => v.status === "pending");
  const decided = rows.filter(v => v.status !== "pending")
    .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime()).slice(0, historyLimit);
  return { pending, decided };
}
