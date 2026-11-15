-- Order detail shows what each line reserved (#337). Run once on production, as the table owner:
GRANT SELECT ON public.stock_reservations TO creoms_readonly;
-- Without it the Order detail still opens; the Stock column shows "–" and CREOMS logs the read failure.
