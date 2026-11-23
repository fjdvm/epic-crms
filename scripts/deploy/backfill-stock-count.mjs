// One-time fill of crms.stock_count from the IMS, before the IMS starts pushing (2026-11-23). Safe to re-run: a row
// keeps the IMS's own pushed figures when they are newer. Needs CREOMS_WRITER_DATABASE_URL, IMS_URL and IMS_SHOP_API_KEY.
import postgres from "postgres";

const url = process.env.CREOMS_WRITER_DATABASE_URL;
const ims = process.env.IMS_URL?.replace(/\/$/, "");
const key = process.env.IMS_SHOP_API_KEY;
if (!url || !ims || !key) throw new Error("CREOMS_WRITER_DATABASE_URL, IMS_URL and IMS_SHOP_API_KEY are required.");

const read = async (path) => {
  const response = await fetch(`${ims}${path}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`The IMS answered ${response.status} for ${path}`);
  return response.json();
};
const { products } = await read("/api/shop/products");
const figures = new Map();
for (let start = 0; start < products.length; start += 200) {
  const ids = products.slice(start, start + 200).map((product) => product.productId).join(",");
  for (const entry of (await read(`/api/shop/inventory?productIds=${ids}`)).products) figures.set(entry.productId, entry);
}

const sql = postgres(url, { max: 1 });
try {
  // Below any version the IMS will push, so its first push always wins.
  const version = 1;
  let written = 0;
  for (const product of products) {
    const held = figures.get(product.productId);
    const rows = await sql`
      insert into crms.stock_count (ims_product_id, name, variant, image, price, active, quantity, reserved, available, synced_at, version, changed_at)
      values (${product.productId}, ${product.name}, ${product.variant?.trim() || null}, ${product.image ?? null},
        ${typeof product.price === "number" && product.price > 0 ? product.price : null}, ${product.active !== false},
        ${held?.quantity ?? null}, ${held?.reserved ?? null}, ${held?.available ?? null}, now(), ${version}, now())
      on conflict (ims_product_id) do update set name = excluded.name, variant = excluded.variant, image = excluded.image,
        price = excluded.price, active = excluded.active,
        quantity = coalesce(excluded.quantity, crms.stock_count.quantity),
        reserved = coalesce(excluded.reserved, crms.stock_count.reserved),
        available = coalesce(excluded.available, crms.stock_count.available),
        synced_at = excluded.synced_at, version = excluded.version, changed_at = excluded.changed_at
      where crms.stock_count.version <= excluded.version
      returning ims_product_id`;
    written += rows.length;
  }
  const known = products.map((product) => product.productId);
  if (known.length > 0) await sql`delete from crms.stock_count where ims_product_id <> all(${known})`;
  console.log(`Stock count filled for ${written} of ${products.length} Sizes.`);
} finally {
  await sql.end();
}
