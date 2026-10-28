-- AI-marked essays (docs/credits-plan.md, phase 4). An essay question shows only its prompt; its
-- rubric and model answer are the key, which no user reads. Marking a written answer costs
-- credits: they are spent before the model is asked, and given back if marking fails.

-- The essay key fields a bug would most likely misplace into what the student sees.
alter table public.questions
  add constraint questions_payload_no_essay_key check (not payload ?| array['rubric', 'model_answer']);

-- How a written answer was marked: points and feedback per rubric criterion. Null for answers
-- the app grades itself. Its owner reads it with the attempt; it holds no model answer.
alter table public.attempts
  add column marking jsonb check (marking is null or jsonb_typeof(marking) = 'object');

-- A refund names the spend it gives back, as a release names its hold, and settles it once.
alter table public.credit_ledger
  drop constraint credit_ledger_check,
  drop constraint credit_ledger_check1,
  add constraint credit_ledger_settles
    check ((reason in ('deck_release', 'marking_refund')) = (hold_id is not null)),
  add constraint credit_ledger_sign
    check (case reason
             when 'deck_hold' then delta < 0
             when 'marking' then delta < 0
             when 'deck_release' then delta >= 0
             else delta > 0
           end);

create unique index credit_ledger_refund_once on public.credit_ledger (hold_id) where reason = 'marking_refund';

-- Spend `amount` credits to mark a written answer to this question, if its owner's balance
-- covers them. Returns the spend, which `refund_marking` gives back if marking fails, or null
-- when the balance is short. Takes the same per-user lock as a deck's hold.
create function public.spend_marking(question_id uuid, amount integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  question public.questions;
  balance integer;
  spend_id uuid;
begin
  if spend_marking.amount is null or spend_marking.amount < 1 then
    raise exception 'amount must be at least 1, not %', spend_marking.amount using errcode = '22023';
  end if;
  select q.* into question from public.questions as q where q.id = spend_marking.question_id;
  if not found then
    raise exception 'question % does not exist', spend_marking.question_id using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('credits:' || question.user_id::text, 0));

  select coalesce(sum(l.delta), 0) into balance
    from public.credit_ledger as l
   where l.user_id = question.user_id;
  if balance < spend_marking.amount then
    return null;
  end if;

  insert into public.credit_ledger (user_id, delta, reason, document_id, note)
  values (question.user_id, -spend_marking.amount, 'marking', question.document_id, question.title)
  returning id into spend_id;
  return spend_id;
end;
$$;

-- Give back a spend whose marking failed. Refunding twice changes nothing.
create function public.refund_marking(spend_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  spend public.credit_ledger;
begin
  select s.* into spend
    from public.credit_ledger as s
   where s.id = refund_marking.spend_id and s.reason = 'marking';
  if not found then
    raise exception 'spend % does not exist', refund_marking.spend_id using errcode = 'P0002';
  end if;

  insert into public.credit_ledger (user_id, delta, reason, document_id, hold_id, note)
  values (spend.user_id, -spend.delta, 'marking_refund', spend.document_id, spend.id, spend.note)
  on conflict (hold_id) where reason = 'marking_refund' do nothing;
end;
$$;

revoke all on function public.spend_marking(uuid, integer), public.refund_marking(uuid)
from public, anon, authenticated;
grant execute on function public.spend_marking(uuid, integer), public.refund_marking(uuid)
to service_role;
