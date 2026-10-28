-- Each deck's study progress, for the Home and Decks pages: how many ready questions it has and
-- of which types, how many of them the student has answered at least once, when they last
-- answered one, and the image of its first diagram for the deck's card.
--
-- security_invoker, so `questions` and `attempts` are read with the caller's own RLS: a student
-- gets rows for their own decks only. Nothing here is an answer: `image_path` is the blanked
-- render a diagram question is asked with, which the student sees before answering.

create view public.deck_progress
with (security_invoker = true)
as
select
  q.document_id,
  q.user_id,
  count(*)::int as questions,
  count(a.last_answered_at)::int as answered,
  max(a.last_answered_at) as last_answered_at,
  array_agg(q.type order by q.type) as types,
  (array_agg(q.image_path order by q.source_page, q.created_at)
    filter (where q.type = 'diagram_blank' and q.image_path is not null))[1] as cover_image_path
from public.questions q
-- One row per question either way: max() over no attempts is null, which `count` skips.
left join lateral (
  select max(attempts.answered_at) as last_answered_at
  from public.attempts
  where attempts.question_id = q.id
) a on true
where q.status = 'ready'
group by q.document_id, q.user_id;

-- The view reads all of a user's questions at once, which no query did before: RLS filters
-- `questions` on `user_id`, and the existing indexes lead with other columns.
create index questions_user_id_idx on public.questions (user_id);

-- New relations in `public` get no privileges by default (core schema); students read their own.
grant select on public.deck_progress to authenticated;
