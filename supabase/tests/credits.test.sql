-- Credits (docs/credits-plan.md): welcome grants, holds and releases, and who can read what.
-- Runs as the owner; rls.test.sql checks who may call the functions.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

-- A guest, and a member with a deck being written.
insert into auth.users (id, email, is_anonymous) values
  ('e0000000-0000-0000-0000-00000000000e', null, true),
  ('f0000000-0000-0000-0000-00000000000f', 'f@example.com', false);

insert into public.units (id, user_id, name)
values ('f1000000-0000-0000-0000-00000000000f', 'f0000000-0000-0000-0000-00000000000f', 'Neuro');
insert into public.documents (id, user_id, unit_id, filename, mime, storage_path, size_bytes, status, page_count)
values ('f2000000-0000-0000-0000-00000000000f', 'f0000000-0000-0000-0000-00000000000f',
        'f1000000-0000-0000-0000-00000000000f', 'brain.pptx',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'f0000000-0000-0000-0000-00000000000f/f2000000-0000-0000-0000-00000000000f.pptx', 100,
        'generating', 6),
       ('f3000000-0000-0000-0000-00000000000f', 'f0000000-0000-0000-0000-00000000000f',
        'f1000000-0000-0000-0000-00000000000f', 'cells.pdf', 'application/pdf',
        'f0000000-0000-0000-0000-00000000000f/f3000000-0000-0000-0000-00000000000f.pdf', 100,
        'generating', 3);

create function pg_temp.balance(owner uuid) returns integer language sql as
  $$ select balance from public.credit_balance where user_id = owner $$;
create function pg_temp.question(page integer) returns void language sql as $$
  insert into public.questions (user_id, document_id, type, status, title, payload, source_ref, source_page)
  values ('f0000000-0000-0000-0000-00000000000f', 'f2000000-0000-0000-0000-00000000000f', 'flashcard',
          'ready', 'Lobes', '{"front": "Front", "back": "Back"}', 'brain.pptx, slide ' || page, page)
$$;

-- Welcome credits

select is(coalesce(pg_temp.balance('e0000000-0000-0000-0000-00000000000e'), 0), 0,
  'a guest made straight through Auth starts with nothing');
select ok(public.grant_guest_credits('e0000000-0000-0000-0000-00000000000e'),
  'web''s guest start grants a guest its credits');
select is(pg_temp.balance('e0000000-0000-0000-0000-00000000000e'), 25, 'which are 25');
select ok(not public.grant_guest_credits('e0000000-0000-0000-0000-00000000000e'), 'once');
select ok(not public.grant_guest_credits('f0000000-0000-0000-0000-00000000000f'),
  'and never to an account');
select is(pg_temp.balance('f0000000-0000-0000-0000-00000000000f'), 100, 'an account starts with 100');

update auth.users set is_anonymous = false, email = 'e@example.com'
 where id = 'e0000000-0000-0000-0000-00000000000e';
select is(pg_temp.balance('e0000000-0000-0000-0000-00000000000e'), 100,
  'a guest who signs up is topped up to 100, not given another 100');

update auth.users set is_anonymous = true where id = 'e0000000-0000-0000-0000-00000000000e';
update auth.users set is_anonymous = false where id = 'e0000000-0000-0000-0000-00000000000e';
select is(pg_temp.balance('e0000000-0000-0000-0000-00000000000e'), 100, 'welcome credits come once');

-- A run: hold, write questions, release

create temp table run (name text primary key, hold_id uuid, held integer);
insert into run select 'first', h.hold_id, h.held
  from public.hold_credits('f2000000-0000-0000-0000-00000000000f', 4) as h;
select is((select held from run where name = 'first'), 4, 'a hold covers the pages asked for');
select is(pg_temp.balance('f0000000-0000-0000-0000-00000000000f'), 96, 'held credits leave the balance');

select pg_temp.question(1);
select pg_temp.question(1);
select pg_temp.question(2);
select is(public.release_credits((select hold_id from run where name = 'first')), 2,
  'a release keeps one credit per page that got questions');
select is(pg_temp.balance('f0000000-0000-0000-0000-00000000000f'), 98, 'and gives the rest back');
select is(public.release_credits((select hold_id from run where name = 'first')), 2,
  'releasing again reports the same');
select is(pg_temp.balance('f0000000-0000-0000-0000-00000000000f'), 98, 'and changes nothing');

-- A second run never pays again for a page that already had questions. Within one test
-- transaction now() doesn't move, so the first run's questions are moved into the past.
update public.questions set created_at = now() - interval '1 hour'
 where document_id = 'f2000000-0000-0000-0000-00000000000f';
insert into run select 'second', h.hold_id, h.held
  from public.hold_credits('f2000000-0000-0000-0000-00000000000f', 3) as h;
select pg_temp.question(1);
select pg_temp.question(3);
select is(public.release_credits((select hold_id from run where name = 'second')), 1,
  'a page that already had questions is not paid for twice');
select is(pg_temp.balance('f0000000-0000-0000-0000-00000000000f'), 97, 'so only the new page costs a credit');

-- A run cut off before writing anything, and never released, is settled by the next hold for
-- the same deck.
update public.questions set created_at = now() - interval '1 hour'
 where document_id = 'f2000000-0000-0000-0000-00000000000f';
insert into run select 'cut off', h.hold_id, h.held
  from public.hold_credits('f2000000-0000-0000-0000-00000000000f', 2) as h;
insert into run select 'after', h.hold_id, h.held
  from public.hold_credits('f2000000-0000-0000-0000-00000000000f', 2) as h;
select is(
  (select count(*) from public.credit_ledger where hold_id = (select hold_id from run where name = 'cut off')),
  1::bigint, 'the next hold settles a hold its run never released');
select is(public.release_credits((select hold_id from run where name = 'after')), 0, 'a run with no new questions keeps nothing');
select is(pg_temp.balance('f0000000-0000-0000-0000-00000000000f'), 97, 'and its credits all come back');

-- The balance caps a hold, and an empty balance holds nothing for another deck.
insert into run select 'big', h.hold_id, h.held
  from public.hold_credits('f2000000-0000-0000-0000-00000000000f', 1000) as h;
select is((select held from run where name = 'big'), 97, 'a hold covers only what the balance has');
select results_eq(
  $$select hold_id, held from public.hold_credits('f3000000-0000-0000-0000-00000000000f', 3)$$,
  $$values (null::uuid, 0)$$,
  'with nothing left, nothing is held');
select throws_ok(
  $$select * from public.hold_credits('f2000000-0000-0000-0000-00000000000f', 0)$$,
  '22023', null, 'a hold is for at least one page');

-- Granted by hand

select isnt(public.grant_credits('f0000000-0000-0000-0000-00000000000f', 50, 'demo account'), null,
  'credits can be granted by hand');

-- Marking a written answer: spent first, given back once when marking fails.

insert into public.questions (id, user_id, document_id, type, status, title, payload, source_ref, source_page)
values ('f4000000-0000-0000-0000-00000000000f', 'f0000000-0000-0000-0000-00000000000f',
        'f3000000-0000-0000-0000-00000000000f', 'essay', 'ready', 'How cells divide',
        '{"prompt": "Explain how a cell divides."}', 'cells.pdf, page 2', 2);
create temp table spend as
  select public.spend_marking('f4000000-0000-0000-0000-00000000000f', 2) as id;
select is(pg_temp.balance('f0000000-0000-0000-0000-00000000000f'), 48, 'marking spends its credits up front');
select public.refund_marking((select id from spend));
select public.refund_marking((select id from spend));
select is(pg_temp.balance('f0000000-0000-0000-0000-00000000000f'), 50, 'a failed marking gets them back, once');
select is(public.spend_marking('f4000000-0000-0000-0000-00000000000f', 51), null,
  'marking the balance can''t cover spends nothing');
select is(pg_temp.balance('f0000000-0000-0000-0000-00000000000f'), 50, 'and leaves the balance alone');
select throws_ok(
  $$select public.spend_marking('f4000000-0000-0000-0000-00000000000f', 0)$$,
  '22023', null, 'marking costs at least a credit');
select throws_ok(
  $$update public.questions set payload = payload || '{"model_answer": "By mitosis."}'
     where id = 'f4000000-0000-0000-0000-00000000000f'$$,
  '23514', null, 'an essay''s model answer can''t be put where the student sees it');

-- A deleted deck (deleteDeck in web) takes its questions and answers with it, and keeps its
-- history: the credits it used and what its model calls cost.

select pg_temp.question(5);
insert into public.attempts (user_id, question_id, response, correct)
select user_id, id, '{"rating": "knew"}', true
  from public.questions where document_id = 'f2000000-0000-0000-0000-00000000000f';
insert into public.llm_requests (id, user_id, document_id, route, model, cost_usd)
values ('f5000000-0000-0000-0000-00000000000f', 'f0000000-0000-0000-0000-00000000000f',
        'f2000000-0000-0000-0000-00000000000f', 'text_questions', 'anthropic/claude-haiku-5.5', 0.0021);
create temp table history as
  select id from public.credit_ledger where document_id = 'f2000000-0000-0000-0000-00000000000f';
create temp table before as select pg_temp.balance('f0000000-0000-0000-0000-00000000000f') as balance;
create temp table answered as
  select a.id from public.attempts as a
    join public.questions as q on q.id = a.question_id
   where q.document_id = 'f2000000-0000-0000-0000-00000000000f';

delete from public.documents where id = 'f2000000-0000-0000-0000-00000000000f';
select is(
  (select count(*) from public.questions where document_id = 'f2000000-0000-0000-0000-00000000000f'),
  0::bigint, 'deleting a deck deletes its questions');
select ok(
  (select count(*) from answered) > 0
    and not exists (select 1 from public.attempts where id in (select id from answered)),
  'and the answers given to them');
select is(
  (select count(*) from public.credit_ledger where id in (select id from history) and document_id is null),
  (select count(*) from history),
  'it keeps its holds and releases');
select is(pg_temp.balance('f0000000-0000-0000-0000-00000000000f'), (select balance from before),
  'so the balance doesn''t change');
select is(
  (select document_id from public.llm_requests where id = 'f5000000-0000-0000-0000-00000000000f'),
  null, 'its model calls stay on record, pointing at no deck');

-- Each user reads their own credits only, and writes none.

set local role authenticated;
set local request.jwt.claims to '{"sub": "e0000000-0000-0000-0000-00000000000e", "role": "authenticated"}';
select results_eq('select user_id, balance from public.credit_balance',
  $$values ('e0000000-0000-0000-0000-00000000000e'::uuid, 100)$$,
  'a user sees their own balance only');
select throws_ok(
  $$insert into public.credit_ledger (user_id, delta, reason, note)
    values ('e0000000-0000-0000-0000-00000000000e', 1000, 'admin_grant', 'free money')$$,
  '42501', null, 'a user cannot grant themselves credits');

select * from finish();
rollback;
