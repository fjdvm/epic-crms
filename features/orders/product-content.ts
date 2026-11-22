import { randomUUID } from "node:crypto";
import type postgres from "postgres";

import { recordAudit, staffAuditActor, type AuditTrail } from "@/lib/audit-trail";
import { ORDERS_MODULE } from "@/lib/portal/config";
import { canWork, READ_ONLY_REASON } from "@/lib/portal/roles";

import { MAX_DESCRIPTION, MAX_NAME, parsePrice } from "./product-content-limits";

export { MAX_DESCRIPTION, MAX_NAME } from "./product-content-limits";

/**
 * What CREOMS published for one IMS product. All of it stays in CREOMS: none is ever sent to the IMS, which still owns
 * the product and its stock. A null name means the IMS name shows; a null price keeps the product off the shop.
 */
export interface ProductContent { description: string; imageUrl: string | null; name: string | null; price: number | null }
export interface PublishedImage { fileId: string; url: string }
export type ProductContentResult = { ok: true } | { ok: false; reason: string };

type Staff = { id: string; name: string; role: string };

/** Published content by IMS product id. Throws when the table cannot be read; callers decide how to degrade. */
export async function loadProductContent(sql: postgres.Sql, productIds?: number[]): Promise<Map<number, ProductContent>> {
  const rows = await sql<{ id: number; description: string; image_url: string | null; name: string | null; price: string | null }[]>`
    select ims_product_id as id, description, image_url, name, price from crms.product_content
    ${productIds ? sql`where ims_product_id = any(${productIds})` : sql``}`;
  return new Map(rows.map((row) => [row.id, {
    description: row.description, imageUrl: row.image_url, name: row.name, price: row.price === null ? null : Number(row.price),
  }]));
}

const validProduct = (id: number) => Number.isSafeInteger(id) && id > 0;
// Letters, digits, spaces and ordinary punctuation; no control or invisible characters, no markup.
const PLAIN = /^[^<>\p{C}\u034f\u17b4\u17b5\u3164\uffa0]*$/u;

/** The shop name from what was typed: `undefined` keeps the saved one, an empty one goes back to the IMS name. */
function nameOf(input: string | null | undefined): { ok: true; name: string | null | undefined } | { ok: false; reason: string } {
  if (input === undefined) return { ok: true, name: undefined };
  const name = typeof input === "string" ? input.trim().replace(/\s+/g, " ") : "";
  if (name.length > MAX_NAME) return { ok: false, reason: `The name is at most ${MAX_NAME} characters.` };
  if (!PLAIN.test(name)) return { ok: false, reason: "Use plain text for the name." };
  return { ok: true, name: name === "" ? null : name };
}

/**
 * Publishes the description and, when given, a new image for one product. `image: undefined` keeps the saved image.
 * Staff or Manager only, checked here and not only on the page. Audited under the person's name.
 */
export async function saveProductContent(
  sql: postgres.Sql, audit: AuditTrail, staff: Staff,
  input: { productId: number; description: string; image?: PublishedImage | null; /** `undefined` keeps the saved name; empty uses the IMS name. */ name?: string | null },
): Promise<ProductContentResult> {
  if (!canWork(staff)) return { ok: false, reason: READ_ONLY_REASON };
  if (!validProduct(input.productId)) return { ok: false, reason: "That product could not be found." };
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (description.length > MAX_DESCRIPTION) return { ok: false, reason: `The description is at most ${MAX_DESCRIPTION} characters.` };
  const named = nameOf(input.name);
  if (!named.ok) return named;
  const image = input.image ?? null;
  const keepName = named.name === undefined;

  await sql`
    insert into crms.product_content (ims_product_id, description, image_file_id, image_url, name, updated_by_id, updated_by_name, updated_at)
    values (${input.productId}, ${description}, ${image?.fileId ?? null}, ${image?.url ?? null}, ${named.name ?? null}, ${staff.id}, ${staff.name}, now())
    on conflict (ims_product_id) do update set description = excluded.description,
      image_file_id = coalesce(excluded.image_file_id, crms.product_content.image_file_id),
      image_url = coalesce(excluded.image_url, crms.product_content.image_url),
      name = case when ${keepName} then crms.product_content.name else excluded.name end,
      updated_by_id = excluded.updated_by_id, updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at`;

  await recordAudit(audit, {
    module: ORDERS_MODULE, action: "product_content.published", outcome: "success", actor: staffAuditActor(staff),
    target: { type: "product", id: String(input.productId), display_name: `Product ${input.productId}` },
    description: `${staff.name} published the ${keepName ? "" : "name, "}${image ? "image and " : ""}description of product ${input.productId} to the store.`,
    occurred_at: new Date().toISOString(), metadata: { imageChanged: image !== null, nameChanged: !keepName, descriptionLength: description.length },
    operationId: `product-content:${input.productId}:${randomUUID()}`,
  });
  return { ok: true };
}

/**
 * Sets one product's shop price in pesos. Only in CREOMS: the IMS price is never touched. The price is money, so the
 * caller has already made sure a Manager-level person decided it (in person, or by approving a Staff request);
 * `decidedBy` is that person. Audited with the old and the new price.
 */
export async function applyProductPrice(
  sql: postgres.Sql, audit: AuditTrail, decidedBy: Staff, input: { productId: number; price: number },
): Promise<ProductContentResult> {
  if (!validProduct(input.productId)) return { ok: false, reason: "That product could not be found." };
  const price = parsePrice(input.price);
  if (price === null) return { ok: false, reason: "Enter a price above ₱0 with at most two decimals." };
  const [previous] = await sql<{ price: string | null }[]>`select price from crms.product_content where ims_product_id = ${input.productId}`;
  await sql`
    insert into crms.product_content (ims_product_id, price, price_updated_by_id, price_updated_by_name, price_updated_at, updated_by_id, updated_by_name, updated_at)
    values (${input.productId}, ${price}, ${decidedBy.id}, ${decidedBy.name}, now(), ${decidedBy.id}, ${decidedBy.name}, now())
    on conflict (ims_product_id) do update set price = excluded.price, price_updated_by_id = excluded.price_updated_by_id,
      price_updated_by_name = excluded.price_updated_by_name, price_updated_at = excluded.price_updated_at`;
  const before = previous?.price == null ? null : Number(previous.price);
  await recordAudit(audit, {
    module: ORDERS_MODULE, action: "product_price.changed", outcome: "success", actor: staffAuditActor(decidedBy),
    target: { type: "product", id: String(input.productId), display_name: `Product ${input.productId}` },
    description: `${decidedBy.name} set the shop price of product ${input.productId} to ₱${price.toFixed(2)}${before === null ? "" : ` (was ₱${before.toFixed(2)})`}.`,
    occurred_at: new Date().toISOString(), metadata: { previousPrice: before, price },
    operationId: `product-price:${input.productId}:${randomUUID()}`,
  });
  return { ok: true };
}
