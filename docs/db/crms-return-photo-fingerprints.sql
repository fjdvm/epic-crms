-- Run as creoms_writer before deploying the Return flag (#477). Safe to rerun.
-- Only a CREOMS-owned table is added; storefront Returns stay read-only.
CREATE TABLE IF NOT EXISTS crms.return_photo_fingerprints (
  return_id   integer NOT NULL,
  position    integer NOT NULL CHECK (position BETWEEN 1 AND 3),
  file_id     text NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{16}:[0-9a-f]{16}$'),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (return_id, position)
);
