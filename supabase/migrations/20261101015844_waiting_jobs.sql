-- How many jobs a worker could claim right now. The cloud worker only runs while there is work:
-- Azure asks this function every few seconds (a `metrics-api` KEDA rule, through PostgREST with
-- the worker's key) and starts a run when the answer isn't zero. A claimed job stays hidden
-- until its visibility timeout, so it doesn't count and can't start a second run. `stable` lets
-- PostgREST answer a GET, the only method that rule sends.
create function public.waiting_jobs()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('waiting',
    (select count(*) from pgmq.q_blank where vt <= clock_timestamp())
    + (select count(*) from pgmq.q_extract where vt <= clock_timestamp()));
$$;

revoke all on function public.waiting_jobs() from public, anon, authenticated;
grant execute on function public.waiting_jobs() to service_role;
