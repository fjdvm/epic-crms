import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { createdNotifications, type SyncBatch } from "./sync";

/** Atomic, expiring leases work across instances and with transaction-pooled database URLs. */
export async function signalNotifications(writer: postgres.Sql, sync: () => Promise<SyncBatch>, nudge: () => Promise<void>) {
  await writer`insert into crms.notification_signal_state default values on conflict do nothing`;
  await writer`update crms.notification_signal_state set requested = requested + 1`;
  const lease = randomUUID();
  const [claimed] = await writer`
    update crms.notification_signal_state set lease_id = ${lease}, lease_until = clock_timestamp() + interval '90 seconds'
    where next_run_at <= clock_timestamp() and (lease_until is null or lease_until < clock_timestamp())
    returning requested`;
  if (!claimed) return { coalesced: true, runs: 0 };
  let generation = claimed.requested;
  let runs = 0;
  let created = 0;
  try {
    // A burst causes at most one catch-up pass. Polling covers signals arriving after that pass.
    for (let pass = 0; pass < 2; pass++) {
      const batch = await sync();
      created += createdNotifications(batch);
      runs++;
      const [latest] = await writer`select requested from crms.notification_signal_state`;
      if (latest.requested === generation || pass === 1) {
        await writer`update crms.notification_signal_state set processed = ${generation}, next_run_at = clock_timestamp() + interval '1 second'
          where lease_id = ${lease}`;
        break;
      }
      const renewed = await writer`update crms.notification_signal_state set lease_until = clock_timestamp() + interval '90 seconds'
        where lease_id = ${lease} returning singleton`;
      if (!renewed.length) break; // An expired owner cannot interfere with its successor.
      generation = latest.requested;
    }
  } finally {
    await writer`update crms.notification_signal_state set lease_id = null, lease_until = null where lease_id = ${lease}`;
  }
  // Each sync's ledger and alert transaction committed before a nudge can leave this process.
  if (created > 0) {
    try { await nudge(); } catch (error) { console.error("Staff nudge failed; polling remains available", error); }
  }
  return { coalesced: false, runs };
}
