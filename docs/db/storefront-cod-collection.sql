-- #601 COD collection. For the STOREFRONT repo's migrations: public.orders is storefront-owned (neondb_owner);
-- creoms_writer cannot alter it and CREOMS only reads it (table-level SELECT already covers new columns).
-- The storefront saves these with the status in the same transaction when it receives `codCollection` on
-- POST /api/internal/orders/:id/status for a Cash on Delivery Order moving to delivered or collected.
BEGIN;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cod_collected_amount_in_centavos integer,
  ADD COLUMN IF NOT EXISTS cod_collected_at timestamptz,
  ADD COLUMN IF NOT EXISTS cod_collected_by_id text,
  ADD COLUMN IF NOT EXISTS cod_collected_by_name text;
COMMIT;
