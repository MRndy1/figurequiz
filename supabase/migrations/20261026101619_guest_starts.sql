-- Guest decks (docs/credits-plan.md, phase 2): when each guest was created, and nothing else,
-- so web can cap how many new guests a day may start spending the model budget. No address or
-- other detail of the visitor is stored. Service-only: no user reads or writes it.

create table public.guest_starts (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);

create index guest_starts_created_at_idx on public.guest_starts (created_at);

alter table public.guest_starts enable row level security;
grant select, insert, delete on public.guest_starts to service_role;
