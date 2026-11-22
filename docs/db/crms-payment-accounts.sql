-- Additive migration (#582, #583, #584). Run as creoms_writer (owner of crms); no storefront writes. Safe to re-run.
-- The shop's receiving Payment accounts. Numbers are text (leading zeros kept); number_normalised drives the duplicate check.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.payment_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  method text NOT NULL CHECK (method IN ('gcash', 'maya', 'bank_transfer')),
  label text NOT NULL,
  account_name text NOT NULL,
  account_number text NOT NULL,
  number_normalised text NOT NULL,
  bank_name text,
  active boolean NOT NULL DEFAULT true,
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((method = 'bank_transfer') = (bank_name IS NOT NULL)),
  UNIQUE (method, number_normalised)
);
-- #583: the optional QR image, a private File in File Storage. Only its id is kept, never a signed link.
ALTER TABLE crms.payment_accounts ADD COLUMN IF NOT EXISTS qr_file_id text;
-- #584: a method can be disabled as a whole (no row means enabled); first_used_at is set by the payment flow the first
-- time an account is shown to or used by a Customer, and an account with it set can never be deleted.
CREATE TABLE IF NOT EXISTS crms.payment_methods (
  method text PRIMARY KEY CHECK (method IN ('gcash', 'maya', 'bank_transfer')),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE crms.payment_accounts ADD COLUMN IF NOT EXISTS first_used_at timestamptz;
COMMIT;
