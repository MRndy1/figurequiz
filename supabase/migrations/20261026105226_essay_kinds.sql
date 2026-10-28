-- AI-marked essays (docs/credits-plan.md, phase 4): the enum values the next migration uses.
-- A new enum value can't be used in the transaction that adds it, so they come first. Essays
-- go last in a deck's study order, after the questions the app grades itself.
alter type public.question_type add value 'essay';
alter type public.credit_reason add value 'marking';         -- spent to mark a written answer
alter type public.credit_reason add value 'marking_refund';  -- that spend, back when marking failed
