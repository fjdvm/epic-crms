-- #466: CREOMS dropped the email marketing module (#463), so its tables go, with no archive (owner decision).
-- Run as creoms_writer on the target database, in one transaction. Drops only the Announcement tables in
-- crms (created by crms-announcements.sql); the recipients table goes first because it references announcements.
-- The storefront's customers opt-in column and every other table are not touched.
DROP TABLE IF EXISTS crms.announcement_recipients;
DROP TABLE IF EXISTS crms.announcements;
