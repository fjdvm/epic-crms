-- #671: Pickup is retired (the shop delivers only), so CREOMS drops the Pickup instructions table (owner decision).
-- Run as creoms_writer on the target database. Drops only crms.pickup_instructions (created by crms-pickup-instructions.sql).
-- Pickup Orders live in the storefront's tables, which creoms_writer cannot write; their deletion is a storefront-side step.
DROP TABLE IF EXISTS crms.pickup_instructions;
