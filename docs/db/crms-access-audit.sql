-- #261: run as creoms_writer before deploying. Additive and safe to re-run.
-- Attribution only: neither table grants access or replaces live Portal validation.
create table if not exists crms.access_audit_sessions (
  handle_hash text primary key,
  staff_id text not null,
  staff_name text not null,
  expires_at timestamptz not null
);
create index if not exists access_audit_sessions_expiry on crms.access_audit_sessions (expires_at);

-- One row per Staff member and Module, shared across sessions and app instances.
create table if not exists crms.access_audit_refusals (
  staff_id text not null,
  module text not null,
  recorded_at timestamptz not null,
  primary key (staff_id, module)
);
