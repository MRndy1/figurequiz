-- Sign-ups waiting to be confirmed: unconfirmed_sign_up finds the account web's sign-up gives the
-- latest password to. Runs as the owner; rls.test.sql checks who may call it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email, is_anonymous, email_confirmed_at, confirmation_sent_at) values
  ('a1000000-0000-0000-0000-00000000000a', 'waiting@example.com', false, null, now() - interval '2 minutes'),
  ('a2000000-0000-0000-0000-00000000000a', 'no-link-yet@example.com', false, null, null),
  ('a3000000-0000-0000-0000-00000000000a', 'just-sent@example.com', false, null, now() - interval '10 seconds'),
  ('a4000000-0000-0000-0000-00000000000a', 'confirmed@example.com', false, now(), now() - interval '2 minutes');
-- A guest signing up: its address waits in email_change until it's confirmed.
insert into auth.users (id, email, email_change, is_anonymous)
values ('a5000000-0000-0000-0000-00000000000a', null, 'guest@example.com', true);

select is(public.unconfirmed_sign_up('waiting@example.com'), 'a1000000-0000-0000-0000-00000000000a'::uuid,
  'an unconfirmed account whose link went out over a minute ago');
select is(public.unconfirmed_sign_up('Waiting@Example.com'), 'a1000000-0000-0000-0000-00000000000a'::uuid,
  'whatever the case of the address typed');
select is(public.unconfirmed_sign_up('no-link-yet@example.com'), 'a2000000-0000-0000-0000-00000000000a'::uuid,
  'or one that has had no link');
select is(public.unconfirmed_sign_up('just-sent@example.com'), null,
  'not within a minute of its last link, when Supabase would refuse to send another');
select is(public.unconfirmed_sign_up('confirmed@example.com'), null, 'never a confirmed account');
select is(public.unconfirmed_sign_up('guest@example.com'), null, 'nor a guest, whose password is its own');

select * from finish();
rollback;
