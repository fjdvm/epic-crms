-- Additive migration (#677). Run as creoms_writer (owner of crms); no storefront writes. Safe to re-run.
-- What CREOMS publishes to the store for one IMS product: the shop image (a public File in File Storage) and the description.
-- Keyed by the IMS product id. The shop name and price were added by crms-product-content-name-price.sql; the IMS still owns the Variant and stock.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.product_content (
  ims_product_id integer PRIMARY KEY,
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  image_file_id text,
  image_url text,
  updated_by_id text NOT NULL,
  updated_by_name text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((image_file_id IS NULL) = (image_url IS NULL))
);
-- The storefront reads this table to show the published image and description. Grant it its read role here once the
-- storefront names it (same style as docs/db/creoms-stock-readonly.sql):
--   GRANT USAGE ON SCHEMA crms TO <storefront_reader>; GRANT SELECT ON crms.product_content TO <storefront_reader>;
COMMIT;
