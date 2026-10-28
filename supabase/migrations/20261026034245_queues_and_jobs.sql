-- Job queues and the state machine around them (build plan, D-2).
--
-- These seven functions are the only way a job moves. Web calls `enqueue_extract` and
-- `create_question`; the ingest worker calls the other five over PostgREST with the secret key.
-- Each runs as its owner (`security definer`, empty search_path, every name qualified), so the
-- worker needs no table grants, and each is executable by `service_role` only, never by `anon`
-- or `authenticated`. A function call is one transaction, so a job can never be marked done
-- without its rows being written, or the reverse.
--
-- Messages carry what the worker needs and nothing more (examples in contracts/examples.json):
--   extract  {document_id, user_id, storage_path}
--   blank    {question_id, document_id, user_id, asset_id, image_path, blanks: [{number, x, y, w, h}]}
-- A message is deleted when its job completes, and archived (pgmq.a_extract, pgmq.a_blank)
-- when the job fails or its document or question is gone, so failures stay inspectable.

create extension if not exists pgmq;

select pgmq.create('extract');
select pgmq.create('blank');

-- A file finished uploading: queue it for extraction and count the upload. Web checks the
-- Storage object first and passes the signed-in user, so nobody can queue another user's file.
create function public.enqueue_extract(document_id uuid, user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  doc public.documents;
  new_msg_id bigint;
begin
  update public.documents as d
     set status = 'queued', error = null
   where d.id = enqueue_extract.document_id
     and d.user_id = enqueue_extract.user_id
     and d.status = 'uploading'
  returning d.* into doc;
  if not found then
    raise exception 'document % is not waiting for an upload', enqueue_extract.document_id
      using errcode = 'P0002';
  end if;

  select * into new_msg_id from pgmq.send('extract', jsonb_build_object(
    'document_id', doc.id, 'user_id', doc.user_id, 'storage_path', doc.storage_path
  ));

  insert into public.usage_counters as u (user_id, period_start, uploads_used)
  values (doc.user_id, date_trunc('month', now() at time zone 'utc')::date, 1)
  on conflict on constraint usage_counters_pkey
  do update set uploads_used = u.uploads_used + 1;

  return new_msg_id;
end;
$$;

-- The worker's next job, blank before extract: blank jobs are small and a student may be
-- waiting on one. The message stays hidden for `visibility_seconds`; if the worker dies it
-- reappears with `read_ct` one higher. A message whose document or question is gone or no
-- longer waiting is archived and skipped. Returns no row when both queues are empty.
create function public.claim_next_job(visibility_seconds integer default 600)
returns table (queue_name text, msg_id bigint, read_ct integer, message jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  job record;
begin
  if claim_next_job.visibility_seconds not between 1 and 3600 then
    raise exception 'visibility_seconds must be between 1 and 3600' using errcode = '22023';
  end if;

  loop
    select * into job from pgmq.read('blank', claim_next_job.visibility_seconds, 1);
    exit when not found;
    if exists (
      select 1 from public.questions as q
       where q.id = (job.message ->> 'question_id')::uuid and q.status = 'pending'
    ) then
      return query select 'blank'::text, job.msg_id, job.read_ct, job.message;
      return;
    end if;
    perform pgmq.archive('blank', job.msg_id);
  end loop;

  loop
    select * into job from pgmq.read('extract', claim_next_job.visibility_seconds, 1);
    exit when not found;
    update public.documents as d
       set status = 'processing'
     where d.id = (job.message ->> 'document_id')::uuid
       and d.status in ('queued', 'processing');
    if found then
      return query select 'extract'::text, job.msg_id, job.read_ct, job.message;
      return;
    end if;
    perform pgmq.archive('extract', job.msg_id);
  end loop;
end;
$$;

-- The worker finished reading a file. Writes its assets (upserted by their deterministic
-- ids), records the page count, marks the document `extracted` and deletes the message.
-- Returns false and changes nothing when the job was already completed or failed.
create function public.complete_extract(msg_id bigint, page_count integer, assets jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  doc public.documents;
  written integer;
begin
  select d.* into doc
    from pgmq.q_extract as q
    join public.documents as d on d.id = (q.message ->> 'document_id')::uuid
   where q.msg_id = complete_extract.msg_id
     for update of d;
  if not found then
    return false;
  end if;
  if doc.status <> 'processing' then
    perform pgmq.archive('extract', complete_extract.msg_id);
    return false;
  end if;

  if jsonb_typeof(complete_extract.assets) is distinct from 'array' then
    raise exception 'assets must be a JSON array' using errcode = '22023';
  end if;

  insert into public.assets as a (id, user_id, document_id, page, kind, tier, payload, image_path)
  select x.id, doc.user_id, doc.id, x.page, x.kind, x.tier, x.payload, x.image_path
    from jsonb_to_recordset(complete_extract.assets) as x (
      id uuid, page integer, kind public.asset_kind, tier smallint, payload jsonb,
      image_path text
    )
  on conflict on constraint assets_pkey do update
     set page = excluded.page, kind = excluded.kind, tier = excluded.tier,
         payload = excluded.payload, image_path = excluded.image_path
   where a.document_id = excluded.document_id;
  get diagnostics written = row_count;
  if written <> jsonb_array_length(complete_extract.assets) then
    raise exception 'an asset id already belongs to another document' using errcode = '23505';
  end if;

  update public.documents as d
     set status = 'extracted', page_count = complete_extract.page_count, error = null
   where d.id = doc.id;

  perform pgmq.delete('extract', complete_extract.msg_id);
  return true;
end;
$$;

-- Store one generated question and its answer key, and count it. A diagram question starts
-- `pending` with a blank job built here from its key and its asset, so the image gets exactly
-- the blanks the key grades, at the boxes extraction found: the model only ever picks label
-- indices, never positions. `source_ref` comes from the document, so it is always present.
create function public.create_question(
  document_id uuid,
  type public.question_type,
  title text,
  payload jsonb,
  source_page integer,
  asset_id uuid default null,
  answer_key jsonb default null,
  model_used text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  doc public.documents;
  asset public.assets;
  key_blank jsonb;
  label jsonb;
  label_index integer;
  boxes jsonb := '[]'::jsonb;
  new_status public.question_status := 'ready';
  new_id uuid;
begin
  select d.* into doc from public.documents as d where d.id = create_question.document_id;
  if not found then
    raise exception 'document % does not exist', create_question.document_id
      using errcode = 'P0002';
  end if;

  if create_question.asset_id is not null then
    select a.* into asset
      from public.assets as a
     where a.id = create_question.asset_id and a.document_id = doc.id;
    if not found then
      raise exception 'asset % is not part of document %', create_question.asset_id, doc.id
        using errcode = 'P0002';
    end if;
    if asset.page <> create_question.source_page then
      raise exception 'source_page % is not the page of asset % (%)',
        create_question.source_page, asset.id, asset.page
        using errcode = '22023';
    end if;
  end if;

  if create_question.type = 'diagram_blank' then
    if asset.kind is distinct from 'labeled_diagram' then
      raise exception 'a diagram_blank question needs a labeled_diagram asset'
        using errcode = '22023';
    end if;
    for key_blank in
      select e.value
        from jsonb_array_elements(coalesce(create_question.answer_key -> 'blanks', '[]')) as e
    loop
      label_index := (key_blank ->> 'label_index')::integer;
      label := asset.payload -> 'labels' -> label_index;
      if label_index is null or label_index < 0 or label is null
         or key_blank -> 'number' is null then
        raise exception 'blank % does not name a label of asset %', key_blank, asset.id
          using errcode = '22023';
      end if;
      boxes := boxes || jsonb_build_array(jsonb_build_object(
        'number', (key_blank ->> 'number')::integer,
        'x', label -> 'x', 'y', label -> 'y', 'w', label -> 'w', 'h', label -> 'h'
      ));
    end loop;
    if jsonb_array_length(boxes) = 0 then
      raise exception 'a diagram_blank question needs at least one blank' using errcode = '22023';
    end if;
    new_status := 'pending';
  end if;

  insert into public.questions as q (
    user_id, document_id, asset_id, type, status, title, payload, source_ref, source_page,
    model_used
  )
  values (
    doc.user_id, doc.id, create_question.asset_id, create_question.type, new_status,
    create_question.title, create_question.payload,
    doc.filename || ', '
      || case
           when doc.mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
           then 'slide'
           else 'page'
         end
      || ' ' || create_question.source_page,
    create_question.source_page, create_question.model_used
  )
  returning q.id into new_id;

  if create_question.answer_key is not null then
    insert into public.question_keys (question_id, answer_key)
    values (new_id, create_question.answer_key);
  end if;

  if new_status = 'pending' then
    perform pgmq.send('blank', jsonb_build_object(
      'question_id', new_id, 'document_id', doc.id, 'user_id', doc.user_id,
      'asset_id', asset.id, 'image_path', asset.image_path, 'blanks', boxes
    ));
  end if;

  insert into public.usage_counters as u (user_id, period_start, questions_generated)
  values (doc.user_id, date_trunc('month', now() at time zone 'utc')::date, 1)
  on conflict on constraint usage_counters_pkey
  do update set questions_generated = u.questions_generated + 1;

  return new_id;
end;
$$;

-- The worker drew a question's blanks and stored the image at `image_path`: the question is
-- `ready` for students. Returns false when the job was already completed or failed.
create function public.complete_blank(msg_id bigint, image_path text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
begin
  select (q.message ->> 'question_id')::uuid into target_id
    from pgmq.q_blank as q
   where q.msg_id = complete_blank.msg_id;
  if not found then
    return false;
  end if;

  update public.questions as q
     set status = 'ready', image_path = complete_blank.image_path, error = null
   where q.id = target_id and q.status = 'pending';
  if not found then
    perform pgmq.archive('blank', complete_blank.msg_id);
    return false;
  end if;

  perform pgmq.delete('blank', complete_blank.msg_id);
  return true;
end;
$$;

-- A job can't be done. Records `reason` — shown to the student as is, so it must read like
-- "Couldn't read slide 4: it looks like a scan", never a stack trace — on the document or
-- question, and archives the message. Returns false when the message is already gone.
create function public.fail_job(queue_name text, msg_id bigint, reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_message jsonb;
begin
  if fail_job.reason is null or btrim(fail_job.reason) = '' then
    raise exception 'a failed job needs a reason' using errcode = '22023';
  end if;

  if fail_job.queue_name = 'extract' then
    select q.message into job_message from pgmq.q_extract as q where q.msg_id = fail_job.msg_id;
    if not found then
      return false;
    end if;
    update public.documents as d
       set status = 'failed', error = fail_job.reason
     where d.id = (job_message ->> 'document_id')::uuid
       and d.status in ('queued', 'processing');
  elsif fail_job.queue_name = 'blank' then
    select q.message into job_message from pgmq.q_blank as q where q.msg_id = fail_job.msg_id;
    if not found then
      return false;
    end if;
    update public.questions as q
       set status = 'failed', error = fail_job.reason
     where q.id = (job_message ->> 'question_id')::uuid
       and q.status = 'pending';
  else
    raise exception 'unknown queue %', fail_job.queue_name using errcode = '22023';
  end if;

  perform pgmq.archive(fail_job.queue_name, fail_job.msg_id);
  return true;
end;
$$;

-- A job hit a passing problem (Storage briefly unreachable, say): hide it for `delay_seconds`,
-- then any worker picks it up again. Each pickup still raises `read_ct`, so the worker's retry
-- limit holds. Returns false when the message is already gone.
create function public.retry_job_later(queue_name text, msg_id bigint, delay_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if retry_job_later.queue_name not in ('extract', 'blank') then
    raise exception 'unknown queue %', retry_job_later.queue_name using errcode = '22023';
  end if;
  if retry_job_later.delay_seconds not between 1 and 86400 then
    raise exception 'delay_seconds must be between 1 and 86400' using errcode = '22023';
  end if;

  perform pgmq.set_vt(
    retry_job_later.queue_name, retry_job_later.msg_id, retry_job_later.delay_seconds
  );
  return found;
end;
$$;

-- New functions are executable by PUBLIC by default, and `anon` and `authenticated` inherit
-- that, so revoke it explicitly.
revoke all on function
  public.enqueue_extract(uuid, uuid),
  public.claim_next_job(integer),
  public.complete_extract(bigint, integer, jsonb),
  public.create_question(uuid, public.question_type, text, jsonb, integer, uuid, jsonb, text),
  public.complete_blank(bigint, text),
  public.fail_job(text, bigint, text),
  public.retry_job_later(text, bigint, integer)
from public, anon, authenticated;

grant execute on function
  public.enqueue_extract(uuid, uuid),
  public.claim_next_job(integer),
  public.complete_extract(bigint, integer, jsonb),
  public.create_question(uuid, public.question_type, text, jsonb, integer, uuid, jsonb, text),
  public.complete_blank(bigint, text),
  public.fail_job(text, bigint, text),
  public.retry_job_later(text, bigint, integer)
to service_role;
