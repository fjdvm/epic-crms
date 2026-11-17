-- Additive migration (#559). Run as creoms_writer (owner of crms); no storefront writes.
-- Pickup instructions: where and when a Customer collects a Pickup Order. No row means "not set yet".
BEGIN;
CREATE TABLE IF NOT EXISTS crms.pickup_instructions (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  country text NOT NULL DEFAULT 'Philippines',
  region_code text NOT NULL DEFAULT '', province_code text NOT NULL DEFAULT '',
  city_code text NOT NULL DEFAULT '', barangay_code text NOT NULL DEFAULT '',
  region text NOT NULL DEFAULT '', province text NOT NULL DEFAULT '', city text NOT NULL DEFAULT '', barangay text NOT NULL DEFAULT '',
  street text NOT NULL DEFAULT '',
  hours text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  changed_by_id text, changed_by_name text, changed_at timestamptz
);
INSERT INTO crms.pickup_instructions (singleton) VALUES (true) ON CONFLICT DO NOTHING;
COMMIT;
