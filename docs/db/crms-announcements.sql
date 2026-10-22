-- Upgrades an existing crms schema (docs/db/crms-schema.sql as first run) for Announcements.
-- Run on the live database on 2026-10-22, as creoms_writer (which owns crms), through a temporary grant to the owner.

-- One Marketing Email composed by Staff. Shared by every Staff member with the Marketing Module, so
-- created_by and updated_by only say who touched it last, never who may. images holds the public
-- HTTPS addresses of the shrunk images, in order (empty for a text-only Announcement). image_layout is
-- how Staff chose to arrange them (see features/marketing/image-layouts.ts); null means the default
-- for the number of images. scheduled_by is the Staff member who scheduled it, who the scheduled send is
-- audited as; both are null unless the Announcement is Scheduled.
CREATE TABLE crms.announcements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL CHECK (title <> '' AND char_length(title) <= 60),
  description     text NOT NULL CHECK (description <> ''),
  images          text[] NOT NULL DEFAULT '{}',
  image_layout    text CHECK (image_layout IN ('stacked', 'single', 'two-columns', 'two-rows', 'three-feature-left',
                                               'three-feature-top', 'three-row', 'four-grid', 'four-feature-left',
                                               'four-feature-top')),
  state           text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'scheduled', 'sent', 'failed')),
  scheduled_for   timestamptz,
  scheduled_by_id   text,
  scheduled_by_name text,
  sent_at         timestamptz,
  created_by_id   text NOT NULL,
  created_by_name text NOT NULL,
  updated_by_id   text NOT NULL,
  updated_by_name text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX announcements_updated ON crms.announcements (updated_at DESC);

-- The Customers an Announcement was handed to, so a retry skips them and a Customer Profile can list it.
CREATE TABLE crms.announcement_recipients (
  announcement_id uuid NOT NULL REFERENCES crms.announcements (id) ON DELETE CASCADE,
  customer_id     text NOT NULL,
  handed_over_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, customer_id)
);

CREATE INDEX announcement_recipients_customer ON crms.announcement_recipients (customer_id);
