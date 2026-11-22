-- #422: the POS owns Walk-in Customers, so CREOMS drops their table and rows (owner decision, 2026-11-16).
-- Run as creoms_writer on the target database. No storefront tables are changed.
DROP TABLE IF EXISTS crms.walk_in_customers;
