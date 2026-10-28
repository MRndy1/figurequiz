-- Guest credits come with the human check, not with the anonymous user (docs/credits-plan.md,
-- phase 2). Anyone holding the publishable key can make an anonymous user straight through
-- Supabase Auth, skipping Turnstile and the daily cap, so such a user now starts with nothing:
-- web's guest start grants the 25 credits once Turnstile has passed. An account still gets the
-- rest of 100 on sign-up, the same as signing up directly.

create or replace function public.grant_welcome_credits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A guest's credits come from web's guest start (grant_guest_credits), not from here.
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;
  insert into public.credit_ledger (user_id, delta, reason)
  select new.id, 100 - coalesce(sum(l.delta), 0), 'welcome_account'
    from public.credit_ledger as l
   where l.user_id = new.id and l.reason = 'welcome_guest'
  on conflict (user_id) where reason = 'welcome_account' do nothing;
  return new;
end;
$$;

-- 25 credits for a guest web has just let in: Turnstile passed and the day's cap had room.
-- Only an anonymous user gets them, and only once. Returns whether they were granted.
create function public.grant_guest_credits(user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
-- `user_id` below, in on conflict, is the ledger's column; the argument is always qualified.
#variable_conflict use_column
begin
  if not exists (
    select 1 from auth.users as u where u.id = grant_guest_credits.user_id and u.is_anonymous
  ) then
    return false;
  end if;
  insert into public.credit_ledger (user_id, delta, reason)
  values (grant_guest_credits.user_id, 25, 'welcome_guest')
  on conflict (user_id) where reason = 'welcome_guest' do nothing;
  return found;
end;
$$;

revoke all on function public.grant_guest_credits(uuid) from public, anon, authenticated;
grant execute on function public.grant_guest_credits(uuid) to service_role;
