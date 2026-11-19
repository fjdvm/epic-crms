-- Additive migration. Run as creoms_writer (owner of crms); no storefront writes. Safe to re-run.
-- The Senior/PWD discount rule, set by a Manager or the CEO in Commerce Settings: the discount (a percentage or pesos)
-- and a limit in pesos per day, week or month. The default is today's rule: 5% off, up to ₱125 per week.
-- discount_hundredths is a percentage times 100 (500 = 5%) or centavos, by discount_kind.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.senior_pwd_discount_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  discount_kind text NOT NULL DEFAULT 'percent' CHECK (discount_kind IN ('percent', 'pesos')),
  discount_hundredths bigint NOT NULL DEFAULT 500 CHECK (discount_hundredths > 0 AND discount_hundredths <= 100000000),
  limit_in_centavos bigint NOT NULL DEFAULT 12500 CHECK (limit_in_centavos > 0 AND limit_in_centavos <= 100000000),
  limit_per text NOT NULL DEFAULT 'week' CHECK (limit_per IN ('day', 'week', 'month')),
  changed_by_id text, changed_by_name text, changed_at timestamptz,
  CHECK (discount_kind <> 'percent' OR discount_hundredths <= 10000)
);
INSERT INTO crms.senior_pwd_discount_settings (singleton) VALUES (true) ON CONFLICT DO NOTHING;
COMMIT;
