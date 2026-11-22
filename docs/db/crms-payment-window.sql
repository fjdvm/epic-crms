-- Additive migration (#666). Run as creoms_writer (owner of crms); no storefront writes. Safe to re-run.
-- Payment window: hours an Online-payment Order has to be paid, counted from the moment Staff's confirmation is saved. Default 24.
-- The storefront already reads this column (lib/orders/payment-window.ts, 14 days at most) and saves each Order's deadline
-- at confirmation, so a change only affects Orders confirmed afterwards. It uses 24 when the column is missing.
BEGIN;
ALTER TABLE crms.delivery_settings
  ADD COLUMN IF NOT EXISTS payment_window_hours integer NOT NULL DEFAULT 24
    CHECK (payment_window_hours >= 1 AND payment_window_hours <= 336);
DROP TABLE IF EXISTS crms.payment_window_settings;
COMMIT;
