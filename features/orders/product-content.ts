import { randomUUID } from "node:crypto";
import type postgres from "postgres";

import { recordAudit, staffAuditActor, type AuditTrail } from "@/lib/audit-trail";
import { ORDERS_MODULE } from "@/lib/portal/config";
import { canWork, READ_ONLY_REASON } from "@/lib/portal/roles";

export const MAX_DESCRIPTION = 2000;

/** What Staff published for one IMS product. */
export interface ProductContent { description: string; imageUrl: string | null }
export interface PublishedImage { fileId: string; url: string }
export type ProductContentResult = { ok: true } | { ok: false; reason: string };

type Staff = { id: string; name: string; role: string };

/** Published content by IMS product id. Throws when the table cannot be read; callers decide how to degrade. */
export async function loadProductContent(sql: postgres.Sql, productIds?: number[]): Promise<Map<number, ProductContent>> {
  const rows = await sql<{ id: number; description: string; image_url: string | null }[]>`
    select ims_product_id as id, description, image_url from crms.product_content
    ${productIds ? sql`where ims_product_id = any(${productIds})` : sql``}`;
  return new Map(rows.map((row) => [row.id, { description: row.description, imageUrl: row.image_url }]));
}

/**
 * Publishes the description and, when given, a new image for one product. `image: undefined` keeps the saved image.
 * Staff or Manager only, checked here and not only on the page. Audited under the person's name.
 */
export async function saveProductContent(
  sql: postgres.Sql, audit: AuditTrail, staff: Staff,
  input: { productId: number; description: string; image?: PublishedImage | null },
): Promise<ProductContentResult> {
  if (!canWork(staff)) return { ok: false, reason: READ_ONLY_REASON };
  if (!Number.isSafeInteger(input.productId) || input.productId < 1) return { ok: false, reason: "That product could not be found." };
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (description.length > MAX_DESCRIPTION) return { ok: false, reason: `The description is at most ${MAX_DESCRIPTION} characters.` };
  const image = input.image ?? null;

  await sql`
    insert into crms.product_content (ims_product_id, description, image_file_id, image_url, updated_by_id, updated_by_name, updated_at)
    values (${input.productId}, ${description}, ${image?.fileId ?? null}, ${image?.url ?? null}, ${staff.id}, ${staff.name}, now())
    on conflict (ims_product_id) do update set description = excluded.description,
      image_file_id = coalesce(excluded.image_file_id, crms.product_content.image_file_id),
      image_url = coalesce(excluded.image_url, crms.product_content.image_url),
      updated_by_id = excluded.updated_by_id, updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at`;

  await recordAudit(audit, {
    module: ORDERS_MODULE, action: "product_content.published", outcome: "success", actor: staffAuditActor(staff),
    target: { type: "product", id: String(input.productId), display_name: `Product ${input.productId}` },
    description: `${staff.name} published the ${image ? "image and " : ""}description of product ${input.productId} to the store.`,
    occurred_at: new Date().toISOString(), metadata: { imageChanged: image !== null, descriptionLength: description.length },
    operationId: `product-content:${input.productId}:${randomUUID()}`,
  });
  return { ok: true };
}
