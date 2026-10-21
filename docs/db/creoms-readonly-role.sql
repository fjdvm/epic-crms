-- CREOMS read-only role for the shared ecommerce Neon database (production).
-- Run on production (little-glitter-23408630, br-crimson-paper-b322i1v4) without a password;
-- a password still has to be set by the user (ALTER ROLE creoms_readonly PASSWORD ...).
--
-- CREOMS reads storefront `public` tables and `neon_auth."user"` and must never
-- write to either. The database enforces it: this role has SELECT only.
--
-- Replace <PASSWORD> with a generated secret before running. Do not commit it.

CREATE ROLE creoms_readonly LOGIN PASSWORD '<PASSWORD>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

GRANT USAGE ON SCHEMA public, neon_auth TO creoms_readonly;

-- Only the tables Customer Profiles needs.
GRANT SELECT ON
  public.customers,
  public.addresses,
  public.orders,
  public.order_lines,
  public.order_delivery_addresses,
  public.order_feedback,
  public.feedback_requests,
  public.cart_lines,
  public.products,
  public.sizes,
  neon_auth."user"
TO creoms_readonly;

-- Belt and braces: make sure no write privileges exist on these schemas.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public, neon_auth
  FROM creoms_readonly;
ALTER ROLE creoms_readonly SET default_transaction_read_only = on;

-- The Feedback page's Response rate card (#84) reads feedback_requests. On a database where this role
-- already exists, run only: GRANT SELECT ON public.feedback_requests TO creoms_readonly;
