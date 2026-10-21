-- Adds the image layout to crms.announcements, for an Announcement already created from docs/db/crms-announcements.sql.
-- Run as creoms_writer, which owns crms, on production (the brenraphaels-ecommerce Neon project) on 2026-10-22.
--
-- image_layout is how Staff chose to arrange the images (see features/marketing/image-layouts.ts).
-- Null means the default for the number of images, so existing rows need no backfill.
ALTER TABLE crms.announcements
  ADD COLUMN IF NOT EXISTS image_layout text CHECK (image_layout IN (
    'stacked', 'single', 'two-columns', 'two-rows', 'three-feature-left',
    'three-feature-top', 'three-row', 'four-grid', 'four-feature-left', 'four-feature-top'));
