-- Credits (docs/credits-plan.md, phase 1). One credit writes questions from one page, and only
-- pages that end up with questions are paid for. Everyone gets 100 free credits once: 25 as a
-- guest, the rest on sign-up.
--
-- The ledger is append-only: every grant, hold and release is a row, and a balance is their
-- sum. Writing a deck's questions holds one credit per page that could get some, then
-- releases what the run didn't use. Both take a per-user lock, so two decks running at once
-- can't spend the same credits, and a page is never paid for twice.

create type public.credit_reason as enum (
  'welcome_guest',    -- 25 when a guest is created
  'welcome_account',  -- the rest of 100 when an account is created or a guest signs up
  'deck_hold',        -- held as a deck's questions start: one per page that could get some
  'deck_release',     -- what that hold didn't use, given back when the run ends
  'admin_grant'       -- granted by hand, e.g. for a demo account
);

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  delta integer not null,
  reason public.credit_reason not null,
  -- The deck a hold or release is for. Kept as history if the deck is deleted.
  document_id uuid references public.documents (id) on delete set null,
  -- A release names the hold it settles; a hold has exactly one release once its run ends.
  hold_id uuid references public.credit_ledger (id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  check ((reason = 'deck_release') = (hold_id is not null)),
  -- A release of 0 is the record that a hold used everything it held.
  check (case reason when 'deck_hold' then delta < 0 when 'deck_release' then delta >= 0 else delta > 0 end)
);

create index credit_ledger_user_id_created_at_idx on public.credit_ledger (user_id, created_at desc);
create index credit_ledger_document_id_idx on public.credit_ledger (document_id) where document_id is not null;
create unique index credit_ledger_welcome_guest_once on public.credit_ledger (user_id) where reason = 'welcome_guest';
create unique index credit_ledger_welcome_account_once on public.credit_ledger (user_id) where reason = 'welcome_account';
create unique index credit_ledger_release_once on public.credit_ledger (hold_id) where reason = 'deck_release';

alter table public.credit_ledger enable row level security;
create policy "Owners read their credits" on public.credit_ledger
  for select to authenticated using ((select auth.uid()) = user_id);
grant select on public.credit_ledger to authenticated;
grant select, insert, update, delete on public.credit_ledger to service_role;

create view public.credit_balance
with (security_invoker = true)
as
select user_id, sum(delta)::integer as balance
from public.credit_ledger
group by user_id;

grant select on public.credit_balance to authenticated, service_role;

-- Pages that could get questions but were left for lack of credits. "Finish this deck" writes
-- them once there are credits again.
alter table public.documents
  add column pages_waiting integer not null default 0 check (pages_waiting >= 0);

-- Welcome credits, from the database itself, so every way of signing up gets them: a guest
-- gets 25, and an account (new, or a guest signing up) gets the rest of 100. Each at most once.
create function public.grant_welcome_credits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.is_anonymous, false) then
    insert into public.credit_ledger (user_id, delta, reason)
    values (new.id, 25, 'welcome_guest')
    on conflict (user_id) where reason = 'welcome_guest' do nothing;
  else
    insert into public.credit_ledger (user_id, delta, reason)
    select new.id, 100 - coalesce(sum(l.delta), 0), 'welcome_account'
      from public.credit_ledger as l
     where l.user_id = new.id and l.reason = 'welcome_guest'
    on conflict (user_id) where reason = 'welcome_account' do nothing;
  end if;
  return new;
end;
$$;

create trigger grant_welcome_credits_on_create
  after insert on auth.users
  for each row execute function public.grant_welcome_credits();

create trigger grant_welcome_credits_on_sign_up
  after update of is_anonymous on auth.users
  for each row when (old.is_anonymous and not new.is_anonymous)
  execute function public.grant_welcome_credits();

-- Accounts made before credits existed start with the same 100.
insert into public.credit_ledger (user_id, delta, reason)
select u.id, 100, 'welcome_account'
  from auth.users as u
 where not coalesce(u.is_anonymous, false)
on conflict (user_id) where reason = 'welcome_account' do nothing;

-- Settle a hold: keep one credit for each page that got its first questions since the hold,
-- give back the rest, and return the credits kept. A page that already had questions before
-- the hold isn't paid for again. Settling twice changes nothing.
create function public.release_credits(hold_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  hold public.credit_ledger;
  released integer;
  kept integer;
begin
  select h.* into hold
    from public.credit_ledger as h
   where h.id = release_credits.hold_id and h.reason = 'deck_hold';
  if not found then
    raise exception 'hold % does not exist', release_credits.hold_id using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('credits:' || hold.user_id::text, 0));

  select r.delta into released
    from public.credit_ledger as r
   where r.hold_id = hold.id and r.reason = 'deck_release';
  if found then
    return -hold.delta - released;
  end if;

  select count(distinct q.source_page) into kept
    from public.questions as q
   where q.document_id = hold.document_id
     and q.created_at >= hold.created_at
     and not exists (
       select 1 from public.questions as earlier
        where earlier.document_id = q.document_id
          and earlier.source_page = q.source_page
          and earlier.created_at < hold.created_at
     );
  kept := least(kept, -hold.delta);

  insert into public.credit_ledger (user_id, delta, reason, document_id, hold_id, note)
  values (hold.user_id, -hold.delta - kept, 'deck_release', hold.document_id, hold.id,
          kept || ' of ' || -hold.delta || ' pages got questions');
  return kept;
end;
$$;

-- Hold credits for up to `pages` pages of a document's next run: as many as the owner's
-- balance covers. Returns the hold and the pages it covers, or no hold and 0 when the balance
-- is empty. A hold an earlier run never settled (it was cut off) is settled first.
create function public.hold_credits(document_id uuid, pages integer)
returns table (hold_id uuid, held integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
  balance integer;
  open_hold uuid;
begin
  if hold_credits.pages is null or hold_credits.pages < 1 then
    raise exception 'pages must be at least 1, not %', hold_credits.pages using errcode = '22023';
  end if;
  select d.user_id into owner from public.documents as d where d.id = hold_credits.document_id;
  if not found then
    raise exception 'document % does not exist', hold_credits.document_id using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('credits:' || owner::text, 0));

  for open_hold in
    select h.id
      from public.credit_ledger as h
     where h.document_id = hold_credits.document_id
       and h.reason = 'deck_hold'
       and not exists (select 1 from public.credit_ledger as r where r.hold_id = h.id)
  loop
    perform public.release_credits(open_hold);
  end loop;

  select coalesce(sum(l.delta), 0) into balance from public.credit_ledger as l where l.user_id = owner;
  held := least(hold_credits.pages, greatest(balance, 0));
  if held = 0 then
    hold_id := null;
    return next;
    return;
  end if;

  insert into public.credit_ledger (user_id, delta, reason, document_id, note)
  values (owner, -held, 'deck_hold', hold_credits.document_id, 'held for ' || held || ' pages')
  returning id into hold_id;
  return next;
end;
$$;

-- Credits granted by hand, e.g. to a demo account: payments are a mockup (docs/credits-plan.md).
create function public.grant_credits(user_id uuid, amount integer, note text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.credit_ledger (user_id, delta, reason, note)
  values (grant_credits.user_id, grant_credits.amount, 'admin_grant', grant_credits.note)
  returning id;
$$;

revoke all on function
  public.grant_welcome_credits(),
  public.release_credits(uuid),
  public.hold_credits(uuid, integer),
  public.grant_credits(uuid, integer, text)
from public, anon, authenticated;

grant execute on function
  public.release_credits(uuid),
  public.hold_credits(uuid, integer),
  public.grant_credits(uuid, integer, text)
to service_role;
