"use server";

import { z } from "zod";

import { requireUser, type SessionUser } from "@/lib/dal/auth";
import { getQuestionToGrade, recordAttempt, type QuestionToGrade } from "@/lib/dal/questions";
import { signRender, UNLOCKED_IMAGE_TTL_SECONDS } from "@/lib/dal/storage";
import { countWords, ESSAY_MAX_WORDS } from "@/lib/essays";
import type {
  DiagramOutcome,
  EssayResult,
  FlashcardOutcome,
  McqOutcome,
  ShortAnswerOutcome,
  TableOutcome,
} from "@/lib/grade-types";
import { gradeBlank, gradeBlanks } from "@/lib/grading";
import { markEssayAnswer } from "@/lib/marking";

/**
 * The product's grading: the demo's actions (app/demo/actions.ts) with Postgres behind them.
 *
 * Each action checks who is asking, loads the question and its key for that user, grades with
 * lib/grading.ts, and stores the attempt. Only then does it sign what answering unlocks — the
 * source slide, and for a diagram the unblanked image — so no answer leaves the server without
 * an attempt on record (build plan, D-3).
 *
 * Arguments arrive from the browser, so they are typed `unknown` and checked. Anything
 * malformed, or a question that isn't the user's or isn't ready, gets null.
 */

/** Answers are short labels; the cap only stops a client storing an essay in `attempts`. */
const TypedAnswer = z.string().max(200);

/** A written answer: some words, and no more than the limit, in characters as well. */
const WrittenAnswer = z
  .string()
  .trim()
  .min(1)
  .max(ESSAY_MAX_WORDS * 20)
  .refine((answer) => countWords(answer) <= ESSAY_MAX_WORDS);

async function questionFor(questionId: unknown) {
  const user = await requireUser();
  const question = typeof questionId === "string" ? await getQuestionToGrade(user, questionId) : null;
  return { user, question };
}

function unlockSlide(user: SessionUser, question: QuestionToGrade): Promise<string> {
  return signRender(user.id, question.slide.path, UNLOCKED_IMAGE_TTL_SECONDS, question.slide.filename);
}

export async function gradeDiagramAnswers(
  questionId: unknown,
  responses: unknown,
): Promise<DiagramOutcome | null> {
  const { user, question } = await questionFor(questionId);
  if (question?.type !== "diagram_blank") return null;
  const given = z.record(z.string(), TypedAnswer).safeParse(responses);
  if (!given.success) return null;

  // Only the key's own blanks count, keyed by marker number; one left empty is graded as empty.
  const blanks: Record<string, string> = {};
  for (const { number } of question.key.blanks) blanks[number] = given.data[number] ?? "";

  const results = gradeBlanks(blanks, question.key.blanks);
  const score = results.filter((result) => result.correct).length;
  await recordAttempt(user, question.id, { blanks }, score === results.length);

  const [revealImage, slideImage] = await Promise.all([
    signRender(user.id, question.revealPath, UNLOCKED_IMAGE_TTL_SECONDS),
    unlockSlide(user, question),
  ]);
  return { results, score, total: results.length, revealImage, slideImage };
}

export async function gradeMcqChoice(
  questionId: unknown,
  choice: unknown,
): Promise<McqOutcome | null> {
  const { user, question } = await questionFor(questionId);
  if (question?.type !== "mcq") return null;
  const chosen = z.int().min(0).max(question.optionCount - 1).safeParse(choice);
  if (!chosen.success) return null;

  const { answer_index: answerIndex } = question.key;
  const correct = chosen.data === answerIndex;
  await recordAttempt(user, question.id, { choice: chosen.data }, correct);

  return { chosen: chosen.data, correct, answerIndex, slideImage: await unlockSlide(user, question) };
}

export async function gradeShortAnswerResponse(
  questionId: unknown,
  response: unknown,
): Promise<ShortAnswerOutcome | null> {
  const { user, question } = await questionFor(questionId);
  if (question?.type !== "short_answer") return null;
  const text = TypedAnswer.safeParse(response);
  if (!text.success) return null;

  // One blank, so the diagram blank grader applies unchanged: exact, synonyms, confusable
  // rejection, then a typo allowance.
  const result = gradeBlank(text.data, { number: 1, ...question.key });
  await recordAttempt(user, question.id, { text: text.data }, result.correct);

  return {
    correct: result.correct,
    expected: result.expected,
    rejectedAs: result.rejectedAs,
    matched: result.matched,
    slideImage: await unlockSlide(user, question),
  };
}

/** Nothing to grade: the rating is the student's own, stored as the attempt's verdict. */
export async function rateFlashcard(
  questionId: unknown,
  known: unknown,
): Promise<FlashcardOutcome | null> {
  const { user, question } = await questionFor(questionId);
  if (question?.type !== "flashcard" || typeof known !== "boolean") return null;

  await recordAttempt(user, question.id, { known }, known);
  return { known, slideImage: await unlockSlide(user, question) };
}

export async function gradeTableAnswers(
  questionId: unknown,
  responses: unknown,
): Promise<TableOutcome | null> {
  const { user, question } = await questionFor(questionId);
  if (question?.type !== "table_blank") return null;
  const given = z.record(z.string(), TypedAnswer).safeParse(responses);
  if (!given.success) return null;

  // As for a diagram: only the key's own blanks count, and one left empty is graded as empty.
  const cells: Record<string, string> = {};
  for (const { number } of question.key.blanks) cells[number] = given.data[number] ?? "";

  const results = gradeBlanks(cells, question.key.blanks);
  const score = results.filter((result) => result.correct).length;
  await recordAttempt(user, question.id, { cells }, score === results.length);

  return { results, score, total: results.length, slideImage: await unlockSlide(user, question) };
}

/**
 * Marks a written answer with a model, for credits (lib/marking.ts). Unlike the others, it can
 * fail for a reason the student should read: out of credits, the day's budget, a failed call.
 */
export async function markEssay(questionId: unknown, response: unknown): Promise<EssayResult | null> {
  const { user, question } = await questionFor(questionId);
  if (question?.type !== "essay") return null;
  const answer = WrittenAnswer.safeParse(response);
  if (!answer.success) return null;

  const marked = await markEssayAnswer(user, question, answer.data);
  if (!marked.ok) return marked;
  return {
    ok: true,
    outcome: { ...marked.marking, modelAnswer: question.key.model_answer, slideImage: await unlockSlide(user, question) },
  };
}
