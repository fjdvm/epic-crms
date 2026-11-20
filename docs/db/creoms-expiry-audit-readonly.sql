-- Apply as the storefront table owner. CREOMS reads the `order.expired:<id>` notification the storefront saves with each automatic payment-window expiry, to audit it (#675).
GRANT SELECT ON public.customer_notifications TO creoms_readonly;
