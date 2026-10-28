import "server-only";

import { recordAttempt, type QuestionToGrade } from "@/lib/dal/questions";
import type { SessionUser } from "@/lib/dal/auth";
import { dailyBudgetUsd } from "@/lib/env";
import { MARKING_CREDITS } from "@/lib/essays";
import type { EssayMarking } from "@/lib/grade-types";
import { spentTodayUsd } from "@/lib/llm/budget";
import { callStructured, type CallStructured } from "@/lib/llm/call";
import { ESSAY_MARKING_SYSTEM, essayMarkingInput } from "@/lib/prompts/essay-marking";
import { EssayMarkingOutput } from "@/lib/schemas/generation";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Marking a written answer (docs/credits-plan.md, phase 4): the one kind of grading that asks a
 * model, so it costs credits. They are spent before the call and given back when the answer
 * can't be marked, so a student only ever pays for feedback they get.
 */

/** Shown to the student as is, so each says what happened and what to do. */
export const MARKING_FAILURES = {
  credits: `Marking an answer takes ${MARKING_CREDITS} credits, and you don't have enough.`,
  budget: "Marking has paused for today. Try again tomorrow.",
  failed: "Your answer couldn't be marked this time, so your credits are back. Try again in a minute.",
};

/** A careful read takes 10 to 30 seconds; past this, the student is better off trying again. */
const MARKING_MS = 90_000;

type Db = ReturnType<typeof createAdminClient>;
type EssayToMark = Extract<QuestionToGrade, { type: "essay" }>;

export type Marked = { ok: true; marking: EssayMarking } | { ok: false; error: string; topUp?: boolean };

/**
 * Marks `answer` against the question's rubric, paying for it in credits, and stores the attempt
 * with how it was marked.
 */
export async function markEssayAnswer(
  user: SessionUser,
  question: EssayToMark,
  answer: string,
  deps: { call: CallStructured; db: Db } = { call: callStructured, db: createAdminClient() },
): Promise<Marked> {
  const { call, db } = deps;
  if ((await spentTodayUsd(db)) >= dailyBudgetUsd()) return { ok: false, error: MARKING_FAILURES.budget };

  const spend = await db.rpc("spend_marking", { question_id: question.id, amount: MARKING_CREDITS });
  if (spend.error) throw new Error(`could not spend credits on ${question.id}: ${spend.error.message}`);
  if (!spend.data) return { ok: false, error: MARKING_FAILURES.credits, topUp: true };

  try {
    const result = await call({
      route: "essay_marking",
      system: ESSAY_MARKING_SYSTEM,
      content: essayMarkingInput({
        prompt: question.prompt,
        rubric: question.key.rubric,
        modelAnswer: question.key.model_answer,
        answer,
      }),
      schema: EssayMarkingOutput,
      userId: user.id,
      documentId: question.documentId,
      signal: AbortSignal.timeout(MARKING_MS),
    });
    const marking = result.ok ? toMarking(question.key.rubric, result.output) : null;
    if (!marking) throw new Error(result.ok ? "the marking doesn't fit the rubric" : `the reply was ${result.failure}`);
    // Half the points or more counts as answered right, wherever a session tallies answers.
    await recordAttempt(user, question.id, { text: answer }, marking.points * 2 >= marking.outOf, marking);
    return { ok: true, marking };
  } catch (error) {
    console.error(`marking: question ${question.id} wasn't marked`, error);
    const refund = await db.rpc("refund_marking", { spend_id: spend.data });
    if (refund.error) console.error(`marking: could not refund spend ${spend.data}`, refund.error);
    return { ok: false, error: MARKING_FAILURES.failed };
  }
}

/**
 * The reply as marks against the rubric: one per criterion, in its order, each held to that
 * criterion's points. Null when the reply has a different number of criteria.
 */
export function toMarking(
  rubric: { criterion: string; points: number }[],
  output: EssayMarkingOutput,
): EssayMarking | null {
  if (output.criteria.length !== rubric.length) return null;
  const criteria = rubric.map(({ criterion, points: outOf }, index) => {
    const { points, feedback } = output.criteria[index];
    return { criterion, points: Math.min(outOf, Math.max(0, points)), outOf, feedback: feedback.trim() };
  });
  return {
    criteria,
    points: criteria.reduce((sum, item) => sum + item.points, 0),
    outOf: criteria.reduce((sum, item) => sum + item.outOf, 0),
    comment: output.comment.trim(),
  };
}
