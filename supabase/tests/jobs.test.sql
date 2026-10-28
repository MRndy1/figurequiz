-- The job state machine: every transition the seven functions make, and the duplicate and
-- stale calls a worker can produce (a retried job, a message delivered twice). Runs as the
-- owner so it can look inside the queues; rls.test.sql checks who may call the functions.
begin;
create extension if not exists pgtap with schema extensions;
select plan(68);

-- Message ids outlive a rolled-back run, so the ones a later assertion needs are kept here.
create temp table job (name text primary key, msg_id bigint not null);

insert into auth.users (id, email) values
  ('c0000000-0000-0000-0000-00000000000c', 'c@example.com'),
  ('d0000000-0000-0000-0000-00000000000d', 'd@example.com');

insert into public.units (id, user_id, name)
values ('c1000000-0000-0000-0000-00000000000c', 'c0000000-0000-0000-0000-00000000000c', 'Neuro');

insert into public.documents (id, user_id, unit_id, filename, mime, storage_path, size_bytes)
select id, 'c0000000-0000-0000-0000-00000000000c', 'c1000000-0000-0000-0000-00000000000c',
       'brain.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
       'c0000000-0000-0000-0000-00000000000c/' || id || '.pptx', 1000
  from unnest(array[
    'c2000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000002',
    'c2000000-0000-0000-0000-000000000003'
  ]::uuid[]) as id;

-- enqueue_extract

select throws_ok(
  $$select public.enqueue_extract('c2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000d')$$,
  'P0002', null, 'enqueue_extract refuses another user''s document');
select isnt(
  public.enqueue_extract('c2000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c'),
  null, 'enqueue_extract returns the message id');
select is((select status from public.documents where id = 'c2000000-0000-0000-0000-000000000001'),
  'queued', 'the document is queued');
select results_eq('select message from pgmq.q_extract',
  $$values ('{"document_id": "c2000000-0000-0000-0000-000000000001",
              "user_id": "c0000000-0000-0000-0000-00000000000c",
              "storage_path": "c0000000-0000-0000-0000-00000000000c/c2000000-0000-0000-0000-000000000001.pptx"}'::jsonb)$$,
  'the extract message carries the document, its owner and its object key');
select is(
  (select uploads_used from public.usage_counters
    where user_id = 'c0000000-0000-0000-0000-00000000000c'
      and period_start = date_trunc('month', now() at time zone 'utc')::date),
  1, 'the upload is counted in this month''s usage');
select throws_ok(
  $$select public.enqueue_extract('c2000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c')$$,
  'P0002', null, 'a document is queued only once');

-- claim_next_job

select throws_ok('select * from public.claim_next_job(0)', '22023', null,
  'claim_next_job refuses a visibility timeout of 0');
select results_eq(
  $$select queue_name, read_ct, message ->> 'document_id' from public.claim_next_job(30)$$,
  $$values ('extract'::text, 1, 'c2000000-0000-0000-0000-000000000001'::text)$$,
  'the worker gets the extract job');
select is((select status from public.documents where id = 'c2000000-0000-0000-0000-000000000001'),
  'processing', 'the document is processing');
select is_empty('select * from public.claim_next_job(30)', 'a claimed job stays hidden');

do $$ begin perform pgmq.set_vt('extract', (select max(msg_id) from pgmq.q_extract), 0); end $$;
select results_eq(
  $$select queue_name, read_ct from public.claim_next_job(30)$$,
  $$values ('extract'::text, 2)$$,
  'after its visibility timeout a job is handed out again, read_ct raised');

-- complete_extract

insert into job select 'first extract', max(msg_id) from pgmq.q_extract;
select is(public.complete_extract(-1, 1, '[]'), false, 'complete_extract ignores an unknown message');
select is(
  public.complete_extract((select msg_id from job where name = 'first extract'), 4, $$[
    {"id": "c3000000-0000-0000-0000-000000000001", "page": 3, "kind": "labeled_diagram", "tier": 2,
     "payload": {"labels": [
       {"text": "Frontal lobe", "x": 0.1, "y": 0.2, "w": 0.15, "h": 0.05},
       {"text": "Parietal lobe", "x": 0.5, "y": 0.1, "w": 0.16, "h": 0.05}
     ], "image_width": 1090, "image_height": 780},
     "image_path": "c0000000-0000-0000-0000-00000000000c/c2000000-0000-0000-0000-000000000001/assets/c3000000-0000-0000-0000-000000000001.png"},
    {"id": "c3000000-0000-0000-0000-000000000002", "page": 3, "kind": "text_block", "tier": 1,
     "payload": {"title": "Lobes of the brain", "text": "The cerebrum has four lobes."},
     "image_path": null},
    {"id": "c3000000-0000-0000-0000-000000000003", "page": 4, "kind": "table", "tier": 1,
     "payload": {"rows": [["Lobe", "Location"], ["Frontal", "Front"], ["Occipital", "Back"]],
                 "header_rows": 1},
     "image_path": null}
  ]$$),
  true, 'complete_extract accepts the worker''s assets');
select results_eq(
  'select id, user_id, document_id, page, kind::text, tier::integer from public.assets order by id',
  $$values
    ('c3000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-00000000000c'::uuid,
     'c2000000-0000-0000-0000-000000000001'::uuid, 3, 'labeled_diagram', 2),
    ('c3000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000000c',
     'c2000000-0000-0000-0000-000000000001', 3, 'text_block', 1),
    ('c3000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-00000000000c',
     'c2000000-0000-0000-0000-000000000001', 4, 'table', 1)$$,
  'assets are written with the document and owner taken from the job');
select results_eq(
  $$select status::text, page_count from public.documents where id = 'c2000000-0000-0000-0000-000000000001'$$,
  $$values ('extracted', 4)$$,
  'the document is extracted, with its page count');
select is_empty('select * from pgmq.q_extract', 'the extract message is deleted');
select is(public.complete_extract((select msg_id from job where name = 'first extract'), 4, '[]'), false,
  'a duplicate completion changes nothing');

-- A second document: a reused asset id is refused, then the job fails.

do $$
begin
  perform public.enqueue_extract('c2000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000000c');
  perform public.claim_next_job(30);
end
$$;
select throws_ok(
  $$select public.complete_extract((select max(msg_id) from pgmq.q_extract), 1,
      '[{"id": "c3000000-0000-0000-0000-000000000002", "page": 1, "kind": "text_block", "tier": 1,
         "payload": {"title": null, "text": "x"}}]')$$,
  '23505', null, 'an asset id that belongs to another document is refused');
select is(public.fail_job('extract', -1, 'Something went wrong.'), false, 'fail_job ignores an unknown message');
select throws_ok(
  $$select public.fail_job('extract', (select max(msg_id) from pgmq.q_extract), ' ')$$,
  '22023', null, 'a failed job needs a reason');
select throws_ok(
  $$select public.fail_job('render', (select max(msg_id) from pgmq.q_extract), 'Nope.')$$,
  '22023', null, 'fail_job refuses an unknown queue');
select is(
  public.fail_job('extract', (select max(msg_id) from pgmq.q_extract),
    'This file isn''t a PowerPoint deck we can open.'),
  true, 'fail_job closes the extract job');
select results_eq(
  $$select status::text, error from public.documents where id = 'c2000000-0000-0000-0000-000000000002'$$,
  $$values ('failed', 'This file isn''t a PowerPoint deck we can open.')$$,
  'the document is failed with the reason a student will read');
select results_eq(
  $$select message ->> 'document_id' from pgmq.a_extract$$,
  $$values ('c2000000-0000-0000-0000-000000000002')$$,
  'the failed message is archived, not deleted');

-- create_question. Queue a third document first: its extract job is older than any blank job.

do $$
begin
  perform public.enqueue_extract('c2000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-00000000000c');
end
$$;

select throws_ok(
  $$select public.create_question('c2000000-0000-0000-0000-000000000001', 'diagram_blank', 'Lobes',
      '{"prompt": "Name them.", "numbers": [1]}', 3, 'c3000000-0000-0000-0000-000000000001',
      '{"blanks": [{"number": 1, "label_index": 2, "answer": "Temporal lobe"}]}')$$,
  '22023', null, 'a blank must name one of the asset''s labels');
select throws_ok(
  $$select public.create_question('c2000000-0000-0000-0000-000000000001', 'diagram_blank', 'Lobes',
      '{"prompt": "Name them.", "numbers": [1]}', 3, 'c3000000-0000-0000-0000-000000000001',
      '{"blanks": [{"number": 1, "label_index": -1, "answer": "Parietal lobe"}]}')$$,
  '22023', null, 'a negative label index is refused, not read from the end');
select throws_ok(
  $$select public.create_question('c2000000-0000-0000-0000-000000000001', 'diagram_blank', 'Lobes',
      '{"prompt": "Name them.", "numbers": []}', 3, 'c3000000-0000-0000-0000-000000000001',
      '{"blanks": []}')$$,
  '22023', null, 'a diagram question needs a blank');
select throws_ok(
  $$select public.create_question('c2000000-0000-0000-0000-000000000001', 'diagram_blank', 'Lobes',
      '{"prompt": "Name them.", "numbers": [1]}', 3, 'c3000000-0000-0000-0000-000000000002',
      '{"blanks": [{"number": 1, "label_index": 0, "answer": "Frontal lobe"}]}')$$,
  '22023', null, 'a diagram question needs a labeled_diagram asset');
select throws_ok(
  $$select public.create_question('c2000000-0000-0000-0000-000000000001', 'mcq', 'Lobes',
      '{"prompt": "?", "options": ["a", "b"]}', 3, 'c3000000-0000-0000-0000-0000000000ff',
      '{"answer_index": 0}')$$,
  'P0002', null, 'the asset must belong to the document');
select throws_ok(
  $$select public.create_question('c2000000-0000-0000-0000-000000000001', 'mcq', 'Lobes',
      '{"prompt": "?", "options": ["a", "b"]}', 2, 'c3000000-0000-0000-0000-000000000002',
      '{"answer_index": 0}')$$,
  '22023', null, 'source_page must be the asset''s page');
select throws_ok(
  $$select public.create_question('c2000000-0000-0000-0000-000000000001', 'mcq', 'Lobes',
      '{"prompt": "?", "options": ["a", "b"], "answer_index": 0}', 3)$$,
  '23514', null, 'a payload carrying an answer field is refused');

select isnt(
  public.create_question('c2000000-0000-0000-0000-000000000001', 'diagram_blank', 'Lobes of the brain',
    '{"prompt": "Name the numbered lobes.", "numbers": [1, 2]}', 3, 'c3000000-0000-0000-0000-000000000001',
    '{"blanks": [
       {"number": 1, "label_index": 1, "answer": "Parietal lobe", "synonyms": [], "confusables": ["Frontal lobe"]},
       {"number": 2, "label_index": 0, "answer": "Frontal lobe", "synonyms": [], "confusables": []}
     ]}',
    'anthropic/claude-sonnet-5.5'),
  null, 'create_question stores a diagram question');
select results_eq(
  $$select status::text, source_ref, model_used from public.questions where type = 'diagram_blank'$$,
  $$values ('pending', 'brain.pptx, slide 3', 'anthropic/claude-sonnet-5.5')$$,
  'it waits for its blank job, with source_ref derived from the document');
select is(
  (select k.answer_key -> 'blanks' -> 0 ->> 'answer'
     from public.question_keys as k join public.questions as q on q.id = k.question_id
    where q.type = 'diagram_blank'),
  'Parietal lobe', 'its answer key is stored apart from the question');
select results_eq(
  $$select message - 'question_id' from pgmq.q_blank$$,
  $$values ('{"document_id": "c2000000-0000-0000-0000-000000000001",
              "user_id": "c0000000-0000-0000-0000-00000000000c",
              "asset_id": "c3000000-0000-0000-0000-000000000001",
              "image_path": "c0000000-0000-0000-0000-00000000000c/c2000000-0000-0000-0000-000000000001/assets/c3000000-0000-0000-0000-000000000001.png",
              "blanks": [{"number": 1, "x": 0.5, "y": 0.1, "w": 0.16, "h": 0.05},
                         {"number": 2, "x": 0.1, "y": 0.2, "w": 0.15, "h": 0.05}]}'::jsonb)$$,
  'the blank job draws the key''s blanks at the boxes extraction found');
select results_eq(
  $$select message ->> 'question_id' from pgmq.q_blank$$,
  $$select id::text from public.questions where type = 'diagram_blank'$$,
  'the blank job names its question');
select ok(
  (select message::text not like '%lobe%' from pgmq.q_blank),
  'the blank job carries no label text');

select isnt(
  public.create_question('c2000000-0000-0000-0000-000000000001', 'mcq', 'Lobes',
    '{"prompt": "How many lobes has each hemisphere?", "options": ["Two", "Three", "Four", "Five"]}', 3,
    'c3000000-0000-0000-0000-000000000002', '{"answer_index": 2}', 'anthropic/claude-haiku-5.5'),
  null, 'create_question stores an MCQ');
select isnt(
  public.create_question('c2000000-0000-0000-0000-000000000001', 'flashcard', 'Lobes',
    '{"front": "How many lobes has each hemisphere?", "back": "Four"}', 3),
  null, 'create_question stores a flashcard without a key');
select results_eq(
  $$select q.type::text, q.status::text, k.question_id is not null
      from public.questions as q left join public.question_keys as k on k.question_id = q.id
     where q.type <> 'diagram_blank' order by q.type$$,
  $$values ('mcq', 'ready', true), ('flashcard', 'ready', false)$$,
  'text questions are ready at once; only graded ones have a key');
select is(
  (select questions_generated from public.usage_counters
    where user_id = 'c0000000-0000-0000-0000-00000000000c'
      and period_start = date_trunc('month', now() at time zone 'utc')::date),
  3, 'stored questions are counted, refused ones are not');

-- Table questions: the payload must be the asset's table with exactly the key's cells blanked.

select throws_ok(
  $$select public.create_question('c2000000-0000-0000-0000-000000000001', 'table_blank', 'Lobes',
      '{"prompt": "Fill in each numbered cell.", "header_rows": 1,
        "rows": [[{"blank": 1}, "Location"], ["Frontal", "Front"], ["Occipital", "Back"]]}',
      4, 'c3000000-0000-0000-0000-000000000003',
      '{"blanks": [{"number": 1, "row": 0, "col": 0, "answer": "Lobe"}]}')$$,
  '22023', null, 'a heading cell is never blanked');
select throws_ok(
  $$select public.create_question('c2000000-0000-0000-0000-000000000001', 'table_blank', 'Lobes',
      '{"prompt": "Fill in each numbered cell.", "header_rows": 1,
        "rows": [["Lobe", "Location"], ["Frontal", "Front"], ["Occipital", "Back"]]}',
      4, 'c3000000-0000-0000-0000-000000000003',
      '{"blanks": [{"number": 1, "row": 1, "col": 1, "answer": "Front"}]}')$$,
  '22023', null, 'a payload that still shows a blanked cell is refused');
select throws_ok(
  $$select public.create_question('c2000000-0000-0000-0000-000000000001', 'table_blank', 'Lobes',
      '{"prompt": "Fill in each numbered cell.", "header_rows": 0,
        "rows": [["Lobe", "Location"], ["Frontal", {"blank": 1}], ["Occipital", "Back"]]}',
      4, 'c3000000-0000-0000-0000-000000000003',
      '{"blanks": [{"number": 1, "row": 1, "col": 1, "answer": "Front"}]}')$$,
  '22023', null, 'the payload keeps the table''s heading rows');
select throws_ok(
  $$select public.create_question('c2000000-0000-0000-0000-000000000001', 'table_blank', 'Lobes',
      '{"prompt": "Fill in each numbered cell.", "header_rows": 1,
        "rows": [["Lobe", "Location"], ["Frontal", {"blank": 1}], ["Occipital", "Back"]]}',
      4, 'c3000000-0000-0000-0000-000000000003',
      '{"blanks": [{"number": 1, "row": 1, "col": -1, "answer": "Front"}]}')$$,
  '22023', null, 'a negative column is refused, not read from the end');
select throws_ok(
  $$select public.create_question('c2000000-0000-0000-0000-000000000001', 'table_blank', 'Lobes',
      '{"prompt": "Fill in each numbered cell.", "header_rows": 1,
        "rows": [["Lobe", "Location"], ["Frontal", {"blank": 1}]]}',
      3, 'c3000000-0000-0000-0000-000000000002',
      '{"blanks": [{"number": 1, "row": 1, "col": 1, "answer": "Front"}]}')$$,
  '22023', null, 'a table question needs a table asset');

select isnt(
  public.create_question('c2000000-0000-0000-0000-000000000001', 'table_blank', 'Where the lobes sit',
    '{"prompt": "Fill in each numbered cell.", "header_rows": 1,
      "rows": [["Lobe", "Location"], ["Frontal", {"blank": 1}], [{"blank": 2}, "Back"]]}',
    4, 'c3000000-0000-0000-0000-000000000003',
    '{"blanks": [
       {"number": 1, "row": 1, "col": 1, "answer": "Front", "synonyms": [], "confusables": ["Back"]},
       {"number": 2, "row": 2, "col": 0, "answer": "Occipital", "synonyms": [], "confusables": []}
     ]}',
    'anthropic/claude-sonnet-5.5'),
  null, 'create_question stores a table question');
select results_eq(
  $$select status::text, source_ref from public.questions where type = 'table_blank'$$,
  $$values ('ready', 'brain.pptx, slide 4')$$,
  'a table question is ready at once');
select is_empty(
  $$select 1 from pgmq.q_blank
     where message ->> 'question_id' = (select id::text from public.questions where type = 'table_blank')$$,
  'a table question needs no blank job');

-- Blank jobs come first, then complete_blank.

select is((select queue_name from public.claim_next_job(30)), 'blank',
  'a blank job is handed out before an older extract job');
select results_eq(
  $$select queue_name, message ->> 'document_id' from public.claim_next_job(30)$$,
  $$values ('extract'::text, 'c2000000-0000-0000-0000-000000000003'::text)$$,
  'then the extract job');
select is(public.complete_blank(-1, 'x.png'), false, 'complete_blank ignores an unknown message');
select is(
  public.complete_blank((select max(msg_id) from pgmq.q_blank),
    'c0000000-0000-0000-0000-00000000000c/c2000000-0000-0000-0000-000000000001/questions/q.png'),
  true, 'complete_blank closes the blank job');
select results_eq(
  $$select status::text, image_path from public.questions where type = 'diagram_blank'$$,
  $$values ('ready', 'c0000000-0000-0000-0000-00000000000c/c2000000-0000-0000-0000-000000000001/questions/q.png')$$,
  'the diagram question is ready, with its blanked image');
select is_empty('select * from pgmq.q_blank', 'the blank message is deleted');

-- A blank job whose question is no longer waiting is archived instead of handed out.

do $$
begin
  perform public.create_question('c2000000-0000-0000-0000-000000000001', 'diagram_blank', 'Orphan',
    '{"prompt": "Name it.", "numbers": [1]}', 3, 'c3000000-0000-0000-0000-000000000001',
    '{"blanks": [{"number": 1, "label_index": 0, "answer": "Frontal lobe"}]}');
  update public.questions set status = 'failed', error = 'Removed.' where title = 'Orphan';
end
$$;
select is_empty('select * from public.claim_next_job(30)', 'a stale blank job is skipped');
select results_eq(
  $$select message ->> 'question_id' from pgmq.a_blank$$,
  $$select id::text from public.questions where title = 'Orphan'$$,
  'and archived');

-- fail_job on a blank job.

do $$
begin
  perform public.create_question('c2000000-0000-0000-0000-000000000001', 'diagram_blank', 'Unlucky',
    '{"prompt": "Name it.", "numbers": [1]}', 3, 'c3000000-0000-0000-0000-000000000001',
    '{"blanks": [{"number": 1, "label_index": 0, "answer": "Frontal lobe"}]}');
end
$$;
select is(
  public.fail_job('blank', (select max(msg_id) from pgmq.q_blank), 'We couldn''t draw this diagram''s blanks.'),
  true, 'fail_job closes a blank job');
select results_eq(
  $$select status::text, error from public.questions where title = 'Unlucky'$$,
  $$values ('failed', 'We couldn''t draw this diagram''s blanks.')$$,
  'the question is failed with its reason');

-- retry_job_later on the third document's extract job, which the worker holds.

do $$ begin perform pgmq.set_vt('extract', (select max(msg_id) from pgmq.q_extract), 0); end $$;
select throws_ok(
  $$select public.retry_job_later('render', (select max(msg_id) from pgmq.q_extract), 60)$$,
  '22023', null, 'retry_job_later refuses an unknown queue');
select throws_ok(
  $$select public.retry_job_later('extract', (select max(msg_id) from pgmq.q_extract), 0)$$,
  '22023', null, 'retry_job_later refuses a delay of 0');
select is(public.retry_job_later('extract', -1, 60), false, 'retry_job_later ignores an unknown message');
select is(public.retry_job_later('extract', (select max(msg_id) from pgmq.q_extract), 600), true,
  'retry_job_later hides the job');
select is_empty('select * from public.claim_next_job(30)', 'a job retried later is not handed out yet');

-- A completion that arrives after its document stopped processing changes nothing.

do $$
begin
  perform pgmq.set_vt('extract', (select max(msg_id) from pgmq.q_extract), 0);
  update public.documents set status = 'failed', error = 'Stopped.'
   where id = 'c2000000-0000-0000-0000-000000000003';
end
$$;
select is(public.complete_extract((select max(msg_id) from pgmq.q_extract), 1, '[]'), false,
  'complete_extract refuses a document that is not processing');
select is_empty('select * from pgmq.q_extract', 'and archives its message');

-- A deck's questions cite slides; a PDF's cite pages.

insert into public.documents (id, user_id, unit_id, filename, mime, storage_path, size_bytes)
values ('c2000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-00000000000c',
        'c1000000-0000-0000-0000-00000000000c', 'Week 4 notes.pdf', 'application/pdf',
        'c0000000-0000-0000-0000-00000000000c/c2000000-0000-0000-0000-000000000004.pdf', 1000);
select isnt(
  public.create_question('c2000000-0000-0000-0000-000000000004', 'flashcard', 'Neurons',
    '{"front": "What do neurons carry?", "back": "Electrical signals"}', 2),
  null, 'create_question stores a question from a PDF');
select is(
  (select source_ref from public.questions where document_id = 'c2000000-0000-0000-0000-000000000004'),
  'Week 4 notes.pdf, page 2', 'a PDF''s question cites its page');

select * from finish();
rollback;
