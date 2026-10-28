-- Table questions (after the enum values the previous migration added): `create_question`
-- learns `table_blank`, and a table question, like a diagram question, always has its asset.

alter table public.questions
  add constraint questions_table_blank_has_asset check (type <> 'table_blank' or asset_id is not null);

-- Store one generated question and its answer key, and count it. A diagram question starts
-- `pending` with a blank job built here from its key and its asset, so the image gets exactly
-- the blanks the key grades, at the boxes extraction found: the model only ever picks label
-- indices, never positions. A table question is checked against its asset the same way: its
-- payload must be the extracted table with exactly the key's cells replaced by their numbers,
-- so no cell the key grades can reach the browser. `source_ref` comes from the document, so it
-- is always present.
create or replace function public.create_question(
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
  cells jsonb;
  cell_row integer;
  cell_col integer;
  blank_count integer := 0;
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

  if create_question.type = 'table_blank' then
    if asset.kind is distinct from 'table' then
      raise exception 'a table_blank question needs a table asset' using errcode = '22023';
    end if;
    if create_question.payload -> 'header_rows' is distinct from asset.payload -> 'header_rows' then
      raise exception 'payload.header_rows must be the table''s own' using errcode = '22023';
    end if;
    cells := asset.payload -> 'rows';
    for key_blank in
      select e.value
        from jsonb_array_elements(coalesce(create_question.answer_key -> 'blanks', '[]')) as e
    loop
      cell_row := (key_blank ->> 'row')::integer;
      cell_col := (key_blank ->> 'col')::integer;
      -- A negative index counts from the end in jsonb, so it is refused outright, as is a
      -- header cell and a cell another blank already took.
      if cell_row is null or cell_col is null or cell_col < 0
         or cell_row < (asset.payload ->> 'header_rows')::integer
         or jsonb_typeof(cells -> cell_row -> cell_col) is distinct from 'string'
         or key_blank -> 'number' is null then
        raise exception 'blank % does not name a body cell of table %', key_blank, asset.id
          using errcode = '22023';
      end if;
      cells := jsonb_set(
        cells,
        array[cell_row::text, cell_col::text],
        jsonb_build_object('blank', (key_blank ->> 'number')::integer)
      );
      blank_count := blank_count + 1;
    end loop;
    if blank_count = 0 then
      raise exception 'a table_blank question needs at least one blank' using errcode = '22023';
    end if;
    if create_question.payload -> 'rows' is distinct from cells then
      raise exception 'payload.rows must be the table with exactly the key''s cells blanked'
        using errcode = '22023';
    end if;
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

-- Replacing a function keeps its grants; restated so this file shows who may call it.
revoke all on function
  public.create_question(uuid, public.question_type, text, jsonb, integer, uuid, jsonb, text)
from public, anon, authenticated;
grant execute on function
  public.create_question(uuid, public.question_type, text, jsonb, integer, uuid, jsonb, text)
to service_role;
