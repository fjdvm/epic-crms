-- #603 Dispatch record. For the STOREFRONT repo's migrations: public.orders is storefront-owned (neondb_owner);
-- creoms_writer cannot alter it and CREOMS only reads it (table-level SELECT already covers new columns).
-- `courier` and `courier_tracking_url` may already exist; the rider columns are new. Rider details are personal data:
-- never put them in a Customer email, a Customer API response, a log or an Audit event.
BEGIN;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS courier text CHECK (courier IN ('Lalamove', 'Grab')),
  ADD COLUMN IF NOT EXISTS courier_tracking_url text CHECK (courier_tracking_url IS NULL OR (courier_tracking_url ~ '^https://[^[:space:]]+$' AND length(courier_tracking_url) <= 2048)),
  ADD COLUMN IF NOT EXISTS courier_rider_name text CHECK (length(courier_rider_name) <= 100),
  ADD COLUMN IF NOT EXISTS courier_rider_plate text CHECK (length(courier_rider_plate) <= 100),
  ADD COLUMN IF NOT EXISTS courier_rider_phone text CHECK (length(courier_rider_phone) <= 100);
COMMIT;

-- Storefront endpoints (Bearer credential, aud brenraphaels-orders, scope orders:status):
--
-- POST /api/internal/orders/:id/status   { status: "dispatched", courier: { name, trackingUrl?, riderName?, riderPlate?, riderPhone? } }
--   The link is now OPTIONAL. If present it must be https, with no spaces or credentials, up to 2048 characters.
--   Saves courier, courier_tracking_url and the rider columns with the status in one transaction. Emails the Customer once,
--   with the link only when there is one. Answers { id, status, courier: { name, trackingUrl } , ... } (no rider details).
--
-- POST /api/internal/orders/:id/courier  { courier: { name, trackingUrl?, riderName?, riderPlate?, riderPhone? }, staffId, staffName }
--   Allowed only while the Delivery Order is `dispatched`; otherwise 409 "Order already changed.". Same validation, 400 on a bad link.
--   Replaces the whole booking (an omitted field is cleared). Does not email the Customer again. A Customer-facing page shows the
--   current link but never the rider columns. Answers { id, status: "dispatched", courier: { name, trackingUrl }, deliveryFeeInCentavos }.
