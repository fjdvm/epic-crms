import type postgres from "postgres";

import { DEFAULT_SCHEMA, schemaIdent, type SyncResult } from "./notifications";

/**
 * One shared alert per uploaded Senior/PWD ID, visible only to Staff with the Senior/PWD Module.
 * Verifications are read in every status, so an ID decided between two syncs still alerts once.
 * Later decisions create no events. The first sync baselines existing IDs; the lock and ledger
 * make repeated and concurrent syncs idempotent. Only CREOMS tables are written, and never the ID
 * number, hash or photo.
 */
export async function syncSeniorPwdEvents(
  writer: postgres.Sql,
  reader: postgres.Sql,
  schema: string = DEFAULT_SCHEMA,
): Promise<SyncResult> {
  const s = schemaIdent(writer, schema);
  const events = await reader<{ verification_id: number; customer_id: string; customer_name: string }[]>`
    select v.id as verification_id, v.customer_id, c.full_name as customer_name
    from public.senior_pwd_verifications v
    join public.customers c on c.id = v.customer_id`;

  return writer.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`${schema}.senior-pwd-sync`}))`;
    const [state] = await tx`select 1 from ${s}.senior_pwd_sync_state`;
    const fresh = await tx<{ verification_id: number }[]>`
      insert into ${s}.seen_senior_pwd (verification_id)
      select * from unnest(${events.map(e => e.verification_id)}::integer[])
      on conflict do nothing
      returning verification_id`;

    if (state === undefined) {
      await tx`insert into ${s}.senior_pwd_sync_state default values`;
      return { baselined: true, created: 0 };
    }
    if (fresh.length === 0) return { baselined: false, created: 0 };

    const freshIds = new Set(fresh.map(row => row.verification_id));
    const arrived = events.filter(event => freshIds.has(event.verification_id));
    const created = await tx`
      insert into ${s}.notifications (kind, customer_id, customer_name, verification_id)
      select 'senior-pwd-waiting', * from unnest(
        ${arrived.map(e => e.customer_id)}::text[],
        ${arrived.map(e => e.customer_name)}::text[],
        ${arrived.map(e => e.verification_id)}::integer[]
      ) returning id`;

    return { baselined: false, created: created.length };
  });
}
