-- Run as creoms_writer before deploying #249. Additive and safe to re-run.
create table if not exists crms.portal_copy_audiences (
  notification_id bigint primary key references crms.notifications(id) on delete cascade
);
create table if not exists crms.portal_copies (
  notification_id bigint not null references crms.notifications(id) on delete cascade,
  user_id text not null,
  remote_id text,
  read_synced boolean not null default false,
  last_attempt_at timestamptz,
  primary key (notification_id, user_id)
);

create index if not exists portal_copies_pending_idx on crms.portal_copies (last_attempt_at) where not read_synced;
