-- Additive migration (#677). Run as creoms_writer (owner of crms); no storefront writes. Safe to re-run.
-- CREOMS's copy of what the IMS last reported for each product, which Products & Stocks opens on (name, image,
-- price, stock) without waiting on the IMS. The IMS stays the only owner of physical stock: this table is only ever written from an IMS read.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.stock_mirror (
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
COMMIT;
