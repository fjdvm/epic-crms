-- Additive migration (#666). Run as creoms_writer (owner of crms); no storefront writes. Safe to re-run.
-- Payment window: hours an Online-payment Order has to be paid, counted from the moment Staff's confirmation is saved. Default 24.
-- The storefront needs SELECT on this table (as for crms.delivery_settings) and stores each Order's deadline at confirmation,
-- so a change only affects Orders confirmed afterwards.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.payment_window_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  hours integer NOT NULL DEFAULT 24 CHECK (hours >= 1 AND hours <= 720),
  changed_by_id text, changed_by_name text, changed_at timestamptz
);
INSERT INTO crms.payment_window_settings (singleton) VALUES (true) ON CONFLICT DO NOTHING;
COMMIT;
