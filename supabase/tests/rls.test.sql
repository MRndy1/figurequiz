-- Who can reach what. The browser holds the publishable key, so RLS and grants are the only
-- thing between a signed-in user and every other user's data — and between any user and the
-- answer keys. Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(101);

-- Two users, each with one row in every table.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('b0000000-0000-0000-0000-00000000000b', 'b@example.com');

insert into public.units (id, user_id, name) values
  ('a1000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'Neuro'),
  ('b1000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'Neuro');

insert into public.documents (id, user_id, unit_id, filename, mime, storage_path, size_bytes, status)
values
  ('a2000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'a1000000-0000-0000-0000-00000000000a', 'brain.pptx',
   'application/vnd.openxmlformats-officedocument.presentationml.presentation',
   'a0000000-0000-0000-0000-00000000000a/a2000000-0000-0000-0000-00000000000a.pptx', 100, 'ready'),
  ('b2000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b',
   'b1000000-0000-0000-0000-00000000000b', 'brain.pptx',
   'application/vnd.openxmlformats-officedocument.presentationml.presentation',
   'b0000000-0000-0000-0000-00000000000b/b2000000-0000-0000-0000-00000000000b.pptx', 100, 'ready');

insert into public.assets (id, user_id, document_id, page, kind, tier, payload, image_path) values
  ('a3000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'a2000000-0000-0000-0000-00000000000a', 3, 'labeled_diagram', 2,
   '{"labels": [{"text": "Cerebrum", "x": 0.1, "y": 0.1, "w": 0.2, "h": 0.05}], "image_width": 800, "image_height": 600}',
   'a/a/assets/a.png'),
  ('b3000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b',
   'b2000000-0000-0000-0000-00000000000b', 3, 'labeled_diagram', 2,
   '{"labels": [{"text": "Cerebrum", "x": 0.1, "y": 0.1, "w": 0.2, "h": 0.05}], "image_width": 800, "image_height": 600}',
   'b/b/assets/b.png');

insert into public.questions (id, user_id, document_id, type, status, title, payload, source_ref, source_page)
values
  ('a4000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'a2000000-0000-0000-0000-00000000000a', 'mcq', 'ready', 'Lobes',
   '{"prompt": "Which lobe?", "options": ["Frontal", "Parietal"]}', 'brain.pptx, slide 3', 3),
  -- Self-rated, so it has no answer key.
  ('a7000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'a2000000-0000-0000-0000-00000000000a', 'flashcard', 'ready', 'Lobes',
   '{"front": "Largest part of the brain?", "back": "The cerebrum"}', 'brain.pptx, slide 3', 3),
  ('b4000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b',
   'b2000000-0000-0000-0000-00000000000b', 'mcq', 'ready', 'Lobes',
   '{"prompt": "Which lobe?", "options": ["Frontal", "Parietal"]}', 'brain.pptx, slide 3', 3);

insert into public.question_keys (question_id, answer_key) values
  ('a4000000-0000-0000-0000-00000000000a', '{"answer_index": 0}'),
  ('b4000000-0000-0000-0000-00000000000b', '{"answer_index": 0}');

insert into public.attempts (id, user_id, question_id, response, correct) values
  ('a5000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'a4000000-0000-0000-0000-00000000000a', '{"choice": 0}', true),
  ('b5000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b',
   'b4000000-0000-0000-0000-00000000000b', '{"choice": 1}', false);

insert into public.usage_counters (user_id, period_start, uploads_used) values
  ('a0000000-0000-0000-0000-00000000000a', '2026-10-01', 1),
  ('b0000000-0000-0000-0000-00000000000b', '2026-10-01', 1);

insert into public.llm_requests (id, user_id, document_id, route, model, cost_usd) values
  ('a6000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a',
   'a2000000-0000-0000-0000-00000000000a', 'diagram_labels', 'anthropic/claude-sonnet-5.5', 0.01),
  ('b6000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b',
   'b2000000-0000-0000-0000-00000000000b', 'diagram_labels', 'anthropic/claude-sonnet-5.5', 0.01);

insert into storage.objects (bucket_id, name) values
  ('uploads', 'a0000000-0000-0000-0000-00000000000a/a2000000-0000-0000-0000-00000000000a.pptx');

-- 1. Table privileges: users may only SELECT, and never the answer material.

select table_privs_are('public', t, 'anon', '{}', 'anon has no privilege on ' || t)
  from unnest(array[
    'units', 'documents', 'assets', 'questions', 'question_keys', 'attempts',
    'usage_counters', 'llm_requests'
  ]) as t;

select table_privs_are('public', t, 'authenticated', array['SELECT'], 'authenticated may only read ' || t)
  from unnest(array['units', 'documents', 'questions', 'attempts', 'usage_counters', 'llm_requests']) as t;

select table_privs_are('public', t, 'authenticated', '{}', 'authenticated has no privilege on ' || t)
  from unnest(array['assets', 'question_keys']) as t;

select table_privs_are('public', 'deck_progress', 'anon', '{}', 'anon has no privilege on deck_progress');
select table_privs_are('public', t, 'anon', '{}', 'anon has no privilege on ' || t)
  from unnest(array['credit_ledger', 'credit_balance']) as t;
select table_privs_are('public', t, 'authenticated', array['SELECT'], 'authenticated may only read ' || t)
  from unnest(array['credit_ledger', 'credit_balance']) as t;
select table_privs_are('public', 'deck_progress', 'authenticated', array['SELECT'],
  'authenticated may only read deck_progress');

-- guest_starts only counts new guests for the daily cap: the service role's alone.
select table_privs_are('public', 'guest_starts', r, '{}', r || ' has no privilege on guest_starts')
  from unnest(array['anon', 'authenticated']) as r;
select ok((select relrowsecurity from pg_class where oid = 'public.guest_starts'::regclass),
  'guest_starts has RLS on');

-- A table a later migration adds stays closed until that migration grants it.
create table public.tap_new_table (id integer);
select table_privs_are('public', 'tap_new_table', r, '{}', 'a new table grants ' || r || ' nothing by default')
  from unnest(array['anon', 'authenticated']) as r;

select is(
  array(
    select t from unnest(array[
      'units', 'documents', 'assets', 'questions', 'question_keys', 'attempts',
      'usage_counters', 'llm_requests'
    ]) as t
    where not (
      has_table_privilege('service_role', 'public.' || t, 'SELECT')
      and has_table_privilege('service_role', 'public.' || t, 'INSERT')
      and has_table_privilege('service_role', 'public.' || t, 'UPDATE')
      and has_table_privilege('service_role', 'public.' || t, 'DELETE')
    )
  ),
  '{}'::text[],
  'service_role can read and write every table'
);

-- 2. The job functions belong to the service role alone.

select function_privs_are('public', f.name, f.args, r.role, '{}', r.role || ' cannot execute ' || f.name)
  from (values
    ('enqueue_extract', array['uuid', 'uuid']),
    ('claim_next_job', array['integer']),
    ('complete_extract', array['bigint', 'integer', 'jsonb']),
    ('create_question', array['uuid', 'question_type', 'text', 'jsonb', 'integer', 'uuid', 'jsonb', 'text']),
    ('complete_blank', array['bigint', 'text']),
    ('fail_job', array['text', 'bigint', 'text']),
    ('retry_job_later', array['text', 'bigint', 'integer']),
    ('hold_credits', array['uuid', 'integer']),
    ('release_credits', array['uuid']),
    ('grant_credits', array['uuid', 'integer', 'text']),
    ('spend_marking', array['uuid', 'integer']),
    ('refund_marking', array['uuid']),
    ('grant_guest_credits', array['uuid'])
  ) as f (name, args)
  cross join (values ('anon'), ('authenticated')) as r (role);

select function_privs_are('public', f.name, f.args, 'service_role', array['EXECUTE'], 'service_role can execute ' || f.name)
  from (values
    ('enqueue_extract', array['uuid', 'uuid']),
    ('claim_next_job', array['integer']),
    ('complete_extract', array['bigint', 'integer', 'jsonb']),
    ('create_question', array['uuid', 'question_type', 'text', 'jsonb', 'integer', 'uuid', 'jsonb', 'text']),
    ('complete_blank', array['bigint', 'text']),
    ('fail_job', array['text', 'bigint', 'text']),
    ('retry_job_later', array['text', 'bigint', 'integer']),
    ('hold_credits', array['uuid', 'integer']),
    ('release_credits', array['uuid']),
    ('grant_credits', array['uuid', 'integer', 'text']),
    ('spend_marking', array['uuid', 'integer']),
    ('refund_marking', array['uuid']),
    ('grant_guest_credits', array['uuid'])
  ) as f (name, args);

-- 3. The queues are unreachable except through those functions.

select schema_privs_are('pgmq', 'anon', '{}', 'anon cannot use the pgmq schema');
select schema_privs_are('pgmq', 'authenticated', '{}', 'authenticated cannot use the pgmq schema');
select schema_privs_are('pgmq', 'service_role', '{}', 'service_role reaches the queues only through the job functions');

-- 4. Storage: both buckets private, with their limits; no object is visible to a user.

select results_eq(
  'select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id',
  $$values
    ('renders'::text, false, 10485760::bigint, array['image/png', 'image/jpeg', 'image/webp']),
    ('uploads', false, 52428800, array['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/pdf'])
  $$,
  'uploads and renders are private buckets with size and type limits'
);

select is(
  (select count(*) from pg_policy where polrelid = 'storage.objects'::regclass),
  0::bigint,
  'storage.objects has no policies: only the service role and signed URLs reach files'
);

-- 5. A signed-in user sees their own rows and nothing else, and can write nothing.

set local role authenticated;
set local request.jwt.claims to '{"sub": "a0000000-0000-0000-0000-00000000000a", "role": "authenticated"}';

select results_eq('select id from public.units', $$values ('a1000000-0000-0000-0000-00000000000a'::uuid)$$,
  'a user sees only their own units');
select results_eq('select id from public.documents', $$values ('a2000000-0000-0000-0000-00000000000a'::uuid)$$,
  'a user sees only their own documents');
select results_eq('select id from public.questions order by id',
  $$values ('a4000000-0000-0000-0000-00000000000a'::uuid), ('a7000000-0000-0000-0000-00000000000a')$$,
  'a user sees only their own questions');
select results_eq('select id from public.attempts', $$values ('a5000000-0000-0000-0000-00000000000a'::uuid)$$,
  'a user sees only their own attempts');
select results_eq('select user_id from public.usage_counters', $$values ('a0000000-0000-0000-0000-00000000000a'::uuid)$$,
  'a user sees only their own usage');
select results_eq('select id from public.llm_requests', $$values ('a6000000-0000-0000-0000-00000000000a'::uuid)$$,
  'a user sees only their own model calls');
-- A security_invoker view: the same RLS, through the view. Two ready questions, one answered.
select results_eq(
  'select document_id, questions, answered, types::text[] from public.deck_progress',
  $$values ('a2000000-0000-0000-0000-00000000000a'::uuid, 2, 1, array['mcq', 'flashcard'])$$,
  'a user sees progress for their own decks only');

select throws_ok('select * from public.question_keys', '42501', null, 'a user cannot read any answer key');
select throws_ok('select * from public.assets', '42501', null, 'a user cannot read any asset');

select throws_ok(
  $$insert into public.units (user_id, name) values ('a0000000-0000-0000-0000-00000000000a', 'Mine')$$,
  '42501', null, 'a user cannot insert a unit');
select throws_ok(
  $$update public.documents set status = 'ready' where id = 'a2000000-0000-0000-0000-00000000000a'$$,
  '42501', null, 'a user cannot change their document''s status');
select throws_ok(
  $$delete from public.questions where id = 'a4000000-0000-0000-0000-00000000000a'$$,
  '42501', null, 'a user cannot delete a question');
select throws_ok(
  $$insert into public.attempts (user_id, question_id, response, correct)
    values ('a0000000-0000-0000-0000-00000000000a', 'a4000000-0000-0000-0000-00000000000a', '{}', true)$$,
  '42501', null, 'a user cannot record their own attempt');
select throws_ok(
  $$update public.usage_counters set uploads_used = 0$$,
  '42501', null, 'a user cannot reset their usage');

select throws_ok('select * from public.claim_next_job()', '42501', null, 'a user cannot claim a job');
select throws_ok(
  $$select public.enqueue_extract('a2000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'a user cannot queue an extract job');
select throws_ok('select * from pgmq.q_extract', '42501', null, 'a user cannot read the extract queue');

select is((select count(*) from storage.objects), 0::bigint, 'a user cannot list stored files, even their own');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('uploads', 'a0000000-0000-0000-0000-00000000000a/x.pptx')$$,
  '42501', null, 'a user cannot write a file without a signed upload URL');

set local request.jwt.claims to '{"sub": "b0000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select results_eq('select id from public.documents', $$values ('b2000000-0000-0000-0000-00000000000b'::uuid)$$,
  'the other user sees only theirs');
select results_eq('select document_id, questions, answered from public.deck_progress',
  $$values ('b2000000-0000-0000-0000-00000000000b'::uuid, 1, 1)$$,
  'the other user sees only their own deck''s progress');

-- 6. Signed out: nothing at all.

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';

select throws_ok('select * from public.units', '42501', null, 'anon cannot read units');
select throws_ok('select * from public.questions', '42501', null, 'anon cannot read questions');
select throws_ok('select * from public.deck_progress', '42501', null, 'anon cannot read deck progress');
select throws_ok('select * from public.claim_next_job()', '42501', null, 'anon cannot claim a job');
select is((select count(*) from storage.objects), 0::bigint, 'anon cannot list stored files');

reset role;

-- 7. The columns RLS trusts can't drift from their parent row, and payloads refuse key fields.

select throws_ok(
  $$insert into public.questions (user_id, document_id, type, status, title, payload, source_ref, source_page)
    values ('b0000000-0000-0000-0000-00000000000b', 'a2000000-0000-0000-0000-00000000000a', 'mcq', 'ready',
            'Stolen', '{"prompt": "?", "options": ["a", "b"]}', 'brain.pptx, slide 1', 1)$$,
  '23503', null, 'a question cannot claim an owner other than its document''s');
select throws_ok(
  $$insert into public.questions (user_id, document_id, type, status, title, payload, source_ref, source_page)
    values ('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-00000000000a', 'mcq', 'ready',
            'Leaky', '{"prompt": "?", "options": ["a", "b"], "answer_index": 0}', 'brain.pptx, slide 1', 1)$$,
  '23514', null, 'a public payload cannot carry an answer field');
select throws_ok(
  $$insert into public.questions (user_id, document_id, asset_id, type, status, title, payload, source_ref, source_page)
    values ('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-00000000000a',
            'a3000000-0000-0000-0000-00000000000a', 'diagram_blank', 'ready', 'Lobes',
            '{"prompt": "Name them.", "numbers": [1]}', 'brain.pptx, slide 3', 3)$$,
  '23514', null, 'a diagram question cannot be ready without its blanked image');

select * from finish();
rollback;
