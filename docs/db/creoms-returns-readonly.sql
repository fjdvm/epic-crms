-- #170: run as the shared database owner AFTER the storefront has deployed its Returns schema.
-- This changes permissions only. CREOMS must not create or own storefront Return tables.
-- Fails transactionally if the existing role or any source table is missing; rerunning is safe.
BEGIN;
GRANT USAGE ON SCHEMA public TO creoms_readonly;
GRANT SELECT ON
  public.order_returns,
  public.order_return_items,
  public.order_return_images,
  public.order_return_history
TO creoms_readonly;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  public.order_returns,
  public.order_return_items,
  public.order_return_images,
  public.order_return_history
FROM creoms_readonly;
COMMIT;
