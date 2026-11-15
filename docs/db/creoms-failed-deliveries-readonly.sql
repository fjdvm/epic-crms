-- Run on the storefront database after 0032_failed_deliveries, as its owner.
GRANT SELECT ON public.failed_deliveries TO creoms_readonly;
