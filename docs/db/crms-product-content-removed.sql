-- Additive migration. Run as creoms_writer (owner of crms); no storefront or IMS writes. Safe to re-run.
-- Staff or a Manager can take a product off the shop from Products & Stocks ("Remove from store"). It stays off until
-- someone publishes it again, which clears these. The storefront reads removed_at and treats the product as not sold.
BEGIN;
ALTER TABLE crms.product_content ADD COLUMN IF NOT EXISTS removed_at timestamptz;
ALTER TABLE crms.product_content ADD COLUMN IF NOT EXISTS removed_by_id text;
ALTER TABLE crms.product_content ADD COLUMN IF NOT EXISTS removed_by_name text;
COMMIT;
