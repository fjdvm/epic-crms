-- #342: run as the shared database owner AFTER the storefront has deployed its Senior/PWD schema
-- (public.senior_pwd_verifications and public.orders.senior_pwd_verification_id).
-- Permissions only; CREOMS must not create or own storefront tables.
-- The grant is column by column on purpose: CREOMS can never read id_hash (the keyed hash of the ID number).
-- Fails transactionally if the existing role or the source table is missing; rerunning is safe.
BEGIN;
GRANT USAGE ON SCHEMA public TO creoms_readonly;
GRANT SELECT (id, customer_id, id_type, status, photo_file_id, photo_back_file_id, submitted_at, decided_at, decided_by_id,
  decided_by_name, decline_reason, expires_on) ON public.senior_pwd_verifications TO creoms_readonly;
GRANT SELECT (senior_pwd_verification_id) ON public.orders TO creoms_readonly;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.senior_pwd_verifications FROM creoms_readonly;
COMMIT;
