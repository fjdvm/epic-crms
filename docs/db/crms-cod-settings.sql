-- Additive migration. Run as creoms_writer (owner of crms); no storefront writes.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.cod_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  first_order_amount_in_centavos bigint NOT NULL DEFAULT 150000
    CHECK (first_order_amount_in_centavos >= 0 AND first_order_amount_in_centavos <= 9007199254740991),
  changed_by_id text, changed_by_name text, changed_at timestamptz
);
INSERT INTO crms.cod_settings (singleton) VALUES (true) ON CONFLICT DO NOTHING;
COMMIT;
