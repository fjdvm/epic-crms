-- #610 / #609 handoff: storefront-owned columns for the Refund destination. CREOMS only reads them (creoms_readonly already has
-- table-level SELECT on order_returns, so no CREOMS grant or migration is needed) and never writes them; it changes a locked
-- destination only through POST /api/internal/returns/{id}/refund-destination (see docs/refund-destination.md).
-- Run as the shared database owner once the storefront ships #609. Rerunning is safe.
ALTER TABLE public.order_returns
  ADD COLUMN IF NOT EXISTS refund_method text CHECK (refund_method IN ('gcash','maya','bank-transfer')),
  ADD COLUMN IF NOT EXISTS refund_account_name text,
  ADD COLUMN IF NOT EXISTS refund_account_number text,
  ADD COLUMN IF NOT EXISTS refund_bank_name text,
  ADD COLUMN IF NOT EXISTS refund_destination_changed_at timestamptz;
