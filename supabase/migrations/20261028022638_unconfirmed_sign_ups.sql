-- Signing up again before confirming: Supabase sends a new link but keeps the first sign-up's
-- password, and whoever made that sign-up may not own the address. They could wait for its owner
-- to sign up and confirm, then sign in. So web's sign-up gives such an account the latest
-- sign-up's password before Supabase sends the new link (signUp in web/app/(auth)/actions.ts).
--
-- This finds that account: a password account under the address that isn't confirmed, and whose
-- last link went out over a minute ago. Inside that minute Supabase refuses to send another
-- (Authentication → Emails, minimum interval), and a new password would let it, since changing
-- the password ends every link sent before.
create function public.unconfirmed_sign_up(email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
    from auth.users as u
   where lower(u.email) = lower(unconfirmed_sign_up.email)
     and u.email_confirmed_at is null
     and not u.is_anonymous
     and not u.is_sso_user
     and (u.confirmation_sent_at is null or u.confirmation_sent_at < now() - interval '1 minute')
$$;

revoke all on function public.unconfirmed_sign_up(text) from public, anon, authenticated;
grant execute on function public.unconfirmed_sign_up(text) to service_role;
