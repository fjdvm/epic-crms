-- CREOMS's own stock count (2026-11-23). Run as creoms_writer (owner of crms). Safe to re-run.
-- crms.stock_mirror becomes crms.stock_count: one row per IMS Size with what the shop can sell from the Factory.
-- The IMS is its only writer (POST /api/internal/ims-stock); no CREOMS user can edit it. Orders change it only through
-- their reservations in the IMS. The storefront reads it to decide what the shop lists.
BEGIN;
DO $$
BEGIN
  IF to_regclass('crms.stock_count') IS NULL AND to_regclass('crms.stock_mirror') IS NOT NULL THEN
    ALTER TABLE crms.stock_mirror RENAME TO stock_count;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS crms.stock_count (
  ims_product_id integer PRIMARY KEY,
  name text NOT NULL,
  variant text,
  image text,
  price numeric,
  active boolean NOT NULL DEFAULT true,
  quantity integer,
  reserved integer,
  available integer,
  synced_at timestamptz NOT NULL DEFAULT now()
);
-- The IMS version of the figures (microseconds on the IMS database clock); a push older than the row is ignored.
ALTER TABLE crms.stock_count ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 0;
-- When the IMS last changed the figures.
ALTER TABLE crms.stock_count ADD COLUMN IF NOT EXISTS changed_at timestamptz;
-- Until every running CREOMS reads crms.stock_count, the old name still reads the same rows. Drop it after the deploy.
CREATE OR REPLACE VIEW crms.stock_mirror AS
  SELECT ims_product_id, name, variant, image, price, active, quantity, reserved, available, synced_at FROM crms.stock_count;
COMMIT;
