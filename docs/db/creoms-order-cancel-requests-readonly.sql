-- Lets CREOMS read Customers' cancellation requests (before payment or preparing) so Staff and Managers can approve or decline them.
-- For the owner to run once, by hand, against the shared Neon database (nothing in this repo runs it), after migration 0067.
-- Read-only: CREOMS never writes this table; decisions go through the storefront's internal cancel-request route.
-- Run it BEFORE deploying CREOMS's cancel-request screen, or a waiting request would freeze its Order with nothing to decide it.

GRANT SELECT ON TABLE order_cancel_requests TO creoms_readonly;
