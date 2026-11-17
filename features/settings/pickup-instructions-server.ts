import { randomUUID } from "node:crypto";
import type postgres from "postgres";

import { recordAudit, staffAuditActor, type AuditTrail } from "@/lib/audit-trail";
import { shopRole } from "@/lib/portal/roles";

import { loadPickupInstructions, validatePickupInstructions, type PickupInstructions, type PickupResult } from "./pickup-instructions";

type Staff = { id: string; name: string; role: string };

const FIELDS: (keyof PickupInstructions)[] = ["region", "province", "city", "barangay", "street", "hours", "note"];
const LABEL: Record<string, string> = { region: "Region", province: "Province", city: "City", barangay: "Barangay", street: "Street", hours: "Hours", note: "Note" };

/** Admin only. Saved at once, no deploy; the change is audited under the Admin's name. */
export async function savePickupInstructions(sql: postgres.Sql, audit: AuditTrail, staff: Staff, input: unknown): Promise<PickupResult> {
  if (shopRole(staff.role) !== "admin") return { ok: false, reason: "Only an Admin can change the Pickup instructions." };
  const valid = await validatePickupInstructions(input);
  if (!valid.ok) return valid;
  const next = valid.instructions;
  const previous = await loadPickupInstructions(sql);

  await sql`insert into crms.pickup_instructions (singleton, country, region_code, province_code, city_code, barangay_code,
      region, province, city, barangay, street, hours, note, changed_by_id, changed_by_name, changed_at)
    values (true, ${next.country}, ${next.regionCode}, ${next.provinceCode}, ${next.cityCode}, ${next.barangayCode},
      ${next.region}, ${next.province}, ${next.city}, ${next.barangay}, ${next.street}, ${next.hours}, ${next.note}, ${staff.id}, ${staff.name}, now())
    on conflict (singleton) do update set country = excluded.country, region_code = excluded.region_code, province_code = excluded.province_code,
      city_code = excluded.city_code, barangay_code = excluded.barangay_code, region = excluded.region, province = excluded.province,
      city = excluded.city, barangay = excluded.barangay, street = excluded.street, hours = excluded.hours, note = excluded.note,
      changed_by_id = excluded.changed_by_id, changed_by_name = excluded.changed_by_name, changed_at = excluded.changed_at`;

  const changed = FIELDS.filter(f => previous[f] !== next[f]).map(f => LABEL[f]);
  await recordAudit(audit, {
    module: "Portal Settings", action: "pickup_instructions.changed", outcome: "success", actor: staffAuditActor(staff),
    target: { type: "setting", id: "pickup-instructions", display_name: "Pickup instructions" },
    description: changed.length
      ? `${staff.name} changed the Pickup instructions: ${changed.join(", ")}.`
      : `${staff.name} saved the Pickup instructions without changes.`,
    occurred_at: new Date().toISOString(), metadata: { previous, next, changed }, operationId: `pickup-instructions:${randomUUID()}`,
  });
  return { ok: true, instructions: next };
}
