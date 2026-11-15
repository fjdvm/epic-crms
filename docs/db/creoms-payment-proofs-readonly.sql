-- #340: run as the shared database owner AFTER the storefront has deployed its payment-proof schema
-- (public.order_payment_proofs, plus payment_proof_rejected_at and payment_proof_rejections on public.orders).
-- This changes permissions only. CREOMS must not create or own storefront tables.
-- Fails transactionally if the existing role or the source table is missing; rerunning is safe.
BEGIN;
GRANT USAGE ON SCHEMA public TO creoms_readonly;
GRANT SELECT ON public.order_payment_proofs TO creoms_readonly;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.order_payment_proofs FROM creoms_readonly;
COMMIT;
