// One-time carry-over, run after migrate-product-content-name-price.mjs. Safe to re-run.
// CREOMS now owns the shop price and image, and a product without them stays off the shop. So that no Size already on sale
// disappears, this copies what the storefront charges and shows today into crms.product_content, for every Size on sale
// that CREOMS has not priced yet. It changes nothing a Customer sees, never overwrites a CREOMS edit (it only adds rows, and
// fills an image only on a row it added itself), and
// writes nothing to the storefront or the IMS. The name is left empty, so the IMS name keeps showing.
// Needs CREOMS_DATABASE_URL (read-only storefront), CREOMS_WRITER_DATABASE_URL (crms) and the gateway for File Storage.
import postgres from "postgres";

const direct = (value) => {
  const url = new URL(value);
  if (url.hostname.endsWith(".neon.tech")) url.hostname = url.hostname.replace(/-pooler(?=\.)/, "");
  return url.toString();
};
for (const name of ["CREOMS_DATABASE_URL", "CREOMS_WRITER_DATABASE_URL", "CREOMS_GATEWAY_URL", "CREOMS_GATEWAY_CALLER_KEY"]) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}

/** The public address of a stored image, or null when File Storage does not answer for it. */
async function imageUrl(fileId) {
  try {
    const response = await fetch(`${process.env.CREOMS_GATEWAY_URL.replace(/\/$/, "")}/files/${encodeURIComponent(fileId)}`, {
      headers: { Authorization: `Bearer ${process.env.CREOMS_GATEWAY_CALLER_KEY}` }, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const file = await response.json();
    return file.status === "active" && file.visibility === "public" && typeof file.url === "string" && file.url.startsWith("https://") ? file.url : null;
  } catch { return null; }
}

const shop = postgres(direct(process.env.CREOMS_DATABASE_URL), { max: 1 });
const crms = postgres(direct(process.env.CREOMS_WRITER_DATABASE_URL), { max: 1 });
try {
  const live = await shop`
    select s.ims_product_id as id, s.price_in_centavos as centavos,
      first.file_id, first.url
    from sizes s
    left join lateral (select pi.file_id, pi.url from product_images pi where pi.product_slug = s.product_slug order by pi.position limit 1) first on true where s.ims_product_id is not null and not s.discontinued and s.price_in_centavos > 0`;
  let added = 0;
  for (const size of live) {
    // File Storage first; otherwise the public address the storefront itself shows for that image.
    const url = (size.file_id ? await imageUrl(size.file_id) : null) ?? (typeof size.url === "string" && size.url.startsWith("https://") ? size.url : null);
    const rows = await crms.begin(async (tx) => {
      await tx`set local role creoms_writer`;
      return tx`
        insert into crms.product_content (ims_product_id, description, price, price_updated_by_id, price_updated_by_name, price_updated_at,
          image_file_id, image_url, updated_by_id, updated_by_name, updated_at)
        values (${size.id}, '', ${size.centavos / 100}, 'migration', 'Carried over from the storefront', now(),
          ${url ? size.file_id ?? "storefront" : null}, ${url}, 'migration', 'Carried over from the storefront', now())
        on conflict (ims_product_id) do update set image_file_id = excluded.image_file_id, image_url = excluded.image_url
          -- Only fills an image this carry-over left empty; anything a person set stays.
          where crms.product_content.updated_by_id = 'migration' and crms.product_content.image_url is null and excluded.image_url is not null
        returning ims_product_id`;
    });
    added += rows.length;
    console.log(`IMS product ${size.id}: ₱${(size.centavos / 100).toFixed(2)}${url ? " with its image" : " (no image found)"}${rows.length ? "" : " — already in CREOMS, left as it is"}`);
  }
  console.log(`Carried over ${added} of ${live.length} Sizes on sale.`);
} finally {
  await shop.end();
  await crms.end();
}
