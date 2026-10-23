-- Proposed storefront-owned read contract for #170, not a production CREOMS migration.
create table order_returns (
  id integer primary key generated always as identity,
  order_id integer not null references orders(id),
  status text not null default 'requested'
    check (status in ('requested','approved','goods received','refunded','declined','cancelled')),
  reason text not null check (reason in ('damaged','defective','wrong item','other')),
  note text not null default '',
  amount_in_centavos integer not null check (amount_in_centavos >= 0),
  goods_required boolean,
  decline_reason text,
  requested_at timestamptz not null default now(),
  refunded_at timestamptz
);
create table order_return_items (
  return_id integer not null references order_returns(id) on delete cascade,
  order_line_id integer not null references order_lines(id),
  product_name text not null,
  size_label text not null,
  quantity integer not null check (quantity > 0),
  price_in_centavos integer not null check (price_in_centavos >= 0),
  primary key (return_id, order_line_id)
);
create table order_return_images (
  return_id integer not null references order_returns(id) on delete cascade,
  position integer not null check (position between 1 and 3),
  file_id text not null,
  primary key (return_id, position)
);
create table order_return_history (
  id integer primary key generated always as identity,
  return_id integer not null references order_returns(id) on delete cascade,
  status text not null,
  actor_type text not null check (actor_type in ('customer','staff')),
  actor_id text not null,
  actor_name text not null,
  occurred_at timestamptz not null,
  note text
);
