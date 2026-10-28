-- Core schema: the tables web, the ingest worker and the job functions share.
--
-- Access model (CLAUDE.md, Write protection): a signed-in user may read their own rows and
-- nothing else, and every write goes through the service role (Server Actions, the ingest
-- worker, the job functions in the queues migration). So users get SELECT-only policies,
-- `anon` gets nothing, and the two tables that hold answer material — `assets` (unblanked
-- labels and crops) and `question_keys` — have no user policy and no user grant at all.
--
-- Grants are explicit on every table, and the API roles get nothing by default on tables or
-- sequences created in `public` later: a migration that forgets its grants fails closed. That
-- is the platform's default for new projects (and config.toml's locally), but this project was
-- created through the Management API with the old one, so it is set here for both. Functions
-- can't be closed this way — PUBLIC may execute any new function, and `anon` and
-- `authenticated` inherit that — so each migration revokes its own.
--
-- Each user-owned table carries `user_id` so its RLS policy is a plain ownership check, and a
-- composite foreign key ties that column to the parent row's: a question can never claim a
-- different owner than its document, which is what RLS trusts. `question_keys` has no user
-- policy and never will, so it needs no owner column of its own.

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;

create extension if not exists moddatetime with schema extensions;

create type public.document_status as enum (
  'uploading',   -- row created; the browser is uploading the file
  'queued',      -- file uploaded; an extract job waits for the worker
  'processing',  -- the worker holds the extract job
  'extracted',   -- assets written; waiting for question generation
  'generating',  -- web is generating questions
  'ready',       -- generation finished
  'failed'       -- `error` says why, in words a student can act on
);

-- Values are added by a migration together with the code that produces them, so the
-- database never holds a kind or type no code can read (web/lib/contracts.ts checks both).
create type public.asset_kind as enum ('text_block', 'labeled_diagram');
create type public.question_type as enum ('diagram_blank', 'mcq', 'short_answer', 'flashcard');
-- Diagram questions start `pending` until their blank job draws the image; students only
-- see `ready` questions.
create type public.question_status as enum ('pending', 'ready', 'failed');

create table public.units (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  exam_date date,
  created_at timestamptz not null default now(),
  unique (user_id, name),
  unique (id, user_id)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  unit_id uuid not null,
  filename text not null check (length(filename) between 1 and 255),
  mime text not null,
  -- Object key inside the `uploads` bucket: `{user_id}/{document_id}.pptx`.
  storage_path text not null unique,
  size_bytes bigint not null check (size_bytes > 0),
  status public.document_status not null default 'uploading',
  error text,
  page_count integer check (page_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (unit_id, user_id) references public.units (id, user_id) on delete cascade
);

create index documents_unit_id_user_id_idx on public.documents (unit_id, user_id);
create index documents_user_id_created_at_idx on public.documents (user_id, created_at desc);

create trigger documents_updated_at
  before update on public.documents
  for each row execute function extensions.moddatetime(updated_at);

create table public.assets (
  -- Chosen by the worker and deterministic, so a retried extract job rewrites the same rows
  -- and the same Storage objects instead of adding new ones.
  id uuid primary key,
  user_id uuid not null,
  document_id uuid not null,
  -- 1-based, as people number slides; the page render is `pages/{page:03}.png`.
  page integer not null check (page >= 1),
  kind public.asset_kind not null,
  tier smallint not null check (tier in (1, 2)),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  -- Object key inside the `renders` bucket of the unblanked crop the payload's boxes are
  -- normalized to.
  image_path text,
  created_at timestamptz not null default now(),
  unique (id, document_id),
  foreign key (document_id, user_id) references public.documents (id, user_id) on delete cascade,
  check (kind <> 'labeled_diagram' or image_path is not null)
);

create index assets_document_id_user_id_idx on public.assets (document_id, user_id);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  document_id uuid not null,
  asset_id uuid,
  type public.question_type not null,
  status public.question_status not null,
  title text not null check (length(btrim(title)) > 0),
  -- What the student sees. The answer key lives in `question_keys`, which no user can read;
  -- the check below refuses the key fields a generation bug would most likely misplace.
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and not payload ?| array['answer', 'answers', 'answer_index', 'synonyms', 'confusables']
  ),
  -- Object key inside `renders` of the blanked image, set when the blank job finishes.
  image_path text,
  error text,
  -- Where the question came from, e.g. "lecture-04.pptx, slide 14" — a trust feature.
  source_ref text not null check (length(btrim(source_ref)) > 0),
  source_page integer not null check (source_page >= 1),
  model_used text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (document_id, user_id) references public.documents (id, user_id) on delete cascade,
  foreign key (asset_id, document_id) references public.assets (id, document_id) on delete cascade,
  check (type <> 'diagram_blank' or asset_id is not null),
  check (type <> 'diagram_blank' or status <> 'ready' or image_path is not null)
);

create index questions_document_id_user_id_idx on public.questions (document_id, user_id);
create index questions_asset_id_document_id_idx on public.questions (asset_id, document_id);

create trigger questions_updated_at
  before update on public.questions
  for each row execute function extensions.moddatetime(updated_at);

-- Service-only: grading reads it with the service role, never through a user's session.
create table public.question_keys (
  question_id uuid primary key references public.questions (id) on delete cascade,
  answer_key jsonb not null check (jsonb_typeof(answer_key) = 'object'),
  created_at timestamptz not null default now()
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  question_id uuid not null,
  response jsonb not null,
  correct boolean not null,
  answered_at timestamptz not null default now(),
  foreign key (question_id, user_id) references public.questions (id, user_id) on delete cascade
);

create index attempts_question_id_user_id_idx on public.attempts (question_id, user_id);

-- Quota counts per UTC calendar month (`period_start` is its first day). The job functions
-- keep them: `enqueue_extract` counts uploads, `create_question` counts questions.
create table public.usage_counters (
  user_id uuid not null references auth.users (id) on delete cascade,
  period_start date not null check (period_start = date_trunc('month', period_start)::date),
  uploads_used integer not null default 0 check (uploads_used >= 0),
  questions_generated integer not null default 0 check (questions_generated >= 0),
  primary key (user_id, period_start)
);

-- One row per model call. Cost comes from OpenRouter's own `usage.cost`; its 5.5% credit fee
-- sits outside it. `user_id` and `document_id` are null for calls that belong to no upload
-- (evals) and survive the deletion of either, so spend stays visible.
create table public.llm_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  document_id uuid references public.documents (id) on delete set null,
  route text not null,
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  batch boolean not null default false,
  cost_usd numeric(12, 6) not null check (cost_usd >= 0),
  stop_reason text,
  provider_request_id text,
  created_at timestamptz not null default now()
);

create index llm_requests_user_id_created_at_idx on public.llm_requests (user_id, created_at);
create index llm_requests_document_id_idx on public.llm_requests (document_id);

-- Row level security: on everywhere; owners read their own rows; no table has a write policy.

alter table public.units enable row level security;
alter table public.documents enable row level security;
alter table public.assets enable row level security;
alter table public.questions enable row level security;
alter table public.question_keys enable row level security;
alter table public.attempts enable row level security;
alter table public.usage_counters enable row level security;
alter table public.llm_requests enable row level security;

create policy "Owners read their units" on public.units
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Owners read their documents" on public.documents
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Owners read their questions" on public.questions
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Owners read their attempts" on public.attempts
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Owners read their usage" on public.usage_counters
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Owners read their model calls" on public.llm_requests
  for select to authenticated using ((select auth.uid()) = user_id);

-- Grants. `assets` and `question_keys` get nothing for anon or authenticated.

revoke all on
  public.units, public.documents, public.assets, public.questions, public.question_keys,
  public.attempts, public.usage_counters, public.llm_requests
from anon, authenticated;

grant select on
  public.units, public.documents, public.questions, public.attempts, public.usage_counters,
  public.llm_requests
to authenticated;

grant select, insert, update, delete on
  public.units, public.documents, public.assets, public.questions, public.question_keys,
  public.attempts, public.usage_counters, public.llm_requests
to service_role;
