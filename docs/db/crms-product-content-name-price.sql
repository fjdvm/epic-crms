-- Additive migration. Run as creoms_writer (owner of crms); no storefront or IMS writes. Safe to re-run.
-- CREOMS owns the shop name and price of each IMS product. They live only here and are never sent to the IMS;
-- the IMS still owns the product itself and its physical stock. A null name means "use the IMS name"; a null
-- price keeps the product off the shop. The price is a Manager-level decision, so who set it is kept apart.
BEGIN;
ALTER TABLE crms.product_content ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE crms.product_content ADD COLUMN IF NOT EXISTS price numeric(12,2);
ALTER TABLE crms.product_content ADD COLUMN IF NOT EXISTS price_updated_by_id text;
ALTER TABLE crms.product_content ADD COLUMN IF NOT EXISTS price_updated_by_name text;
ALTER TABLE crms.product_content ADD COLUMN IF NOT EXISTS price_updated_at timestamptz;
ALTER TABLE crms.product_content DROP CONSTRAINT IF EXISTS product_content_name_check;
ALTER TABLE crms.product_content ADD CONSTRAINT product_content_name_check CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 120);
ALTER TABLE crms.product_content DROP CONSTRAINT IF EXISTS product_content_price_check;
ALTER TABLE crms.product_content ADD CONSTRAINT product_content_price_check CHECK (price IS NULL OR (price > 0 AND price <= 1000000));
-- A row may now hold only a name or a price, before anyone publishes a description.
ALTER TABLE crms.product_content ALTER COLUMN description SET DEFAULT '';
COMMIT;
