-- Additive migration (#578). Run as creoms_writer (owner of crms); no storefront writes. Safe to re-run.
-- Free delivery threshold: the subtotal after discounts above which a Delivery Order ships free. Default ₱2,500.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.delivery_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  free_delivery_threshold_in_centavos bigint NOT NULL DEFAULT 250000
    CHECK (free_delivery_threshold_in_centavos > 0 AND free_delivery_threshold_in_centavos <= 100000000),
  changed_by_id text, changed_by_name text, changed_at timestamptz
);
INSERT INTO crms.delivery_settings (singleton) VALUES (true) ON CONFLICT DO NOTHING;
COMMIT;
