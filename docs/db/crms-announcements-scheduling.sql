-- Adds who scheduled an Announcement to crms.announcements, for a table already created from docs/db/crms-announcements.sql.
-- NOT YET RUN on production (the brenraphaels-ecommerce Neon project). Run it as creoms_writer, which owns crms, before the
-- scheduled-announcements job is switched on, then record the date here.
--
-- scheduled_by is the Staff member who scheduled it; the scheduled send is audited as them. Both are null unless the
-- Announcement is Scheduled, so existing rows need no backfill.
ALTER TABLE crms.announcements
  ADD COLUMN IF NOT EXISTS scheduled_by_id text,
  ADD COLUMN IF NOT EXISTS scheduled_by_name text;
