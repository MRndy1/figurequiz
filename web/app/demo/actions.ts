"use server";

import { revealImage, slideImage } from "@/lib/demo/media";
import type {
  DiagramOutcome,
  FlashcardOutcome,
  McqOutcome,
  ShortAnswerOutcome,
  TableOutcome,
} from "@/lib/grade-types";
import { gradeBlank, gradeBlanks } from "@/lib/grading";
import { getQuestion } from "@/lib/questions";

/**
 * Grading runs here, on the server, so the answer key never ships to the browser. Results come
 * back only after a submission, which is the first moment the correct answer is allowed out —
 * and with it the source slide and the un-blanked diagram, which show the answer too.
 *
 * Arguments arrive from the browser, so they are typed `unknown` and checked; anything malformed
 * gets null. Nothing is persisted: the demo has no accounts.
 */

function find(questionId: unknown) {
  return typeof questionId === "string" ? getQuestion(questionId) : undefined;
}

export async function gradeDiagramAnswers(
  questionId: unknown,
  responses: unknown,
): Promise<DiagramOutcome | null> {
  const question = find(questionId);
  if (question?.type !== "diagram") return null;
  if (typeof responses !== "object" || responses === null) return null;

  const given = responses as Record<string, unknown>;
  const byNumber: Record<number, string> = {};
  for (const blank of question.blanks) {
    const response = given[String(blank.number)];
    byNumber[blank.number] = typeof response === "string" ? response : "";
  }

  const results = gradeBlanks(byNumber, question.blanks);
  return {
    results,
    score: results.filter((result) => result.correct).length,
    total: results.length,
    revealImage: revealImage(question),
    slideImage: slideImage(question),
  };
}

export async function gradeMcqChoice(
  questionId: unknown,
  choice: unknown,
): Promise<McqOutcome | null> {
  const question = find(questionId);
  if (question?.type !== "mcq") return null;
  if (typeof choice !== "number" || !Number.isInteger(choice)) return null;
  if (choice < 0 || choice >= question.options.length) return null;

  return {
    chosen: choice,
    correct: choice === question.answerIndex,
    answerIndex: question.answerIndex,
    slideImage: slideImage(question),
  };
}

export async function gradeShortAnswerResponse(
  questionId: unknown,
  response: unknown,
): Promise<ShortAnswerOutcome | null> {
  const question = find(questionId);
  if (question?.type !== "short_answer" || typeof response !== "string") return null;

  // A fill-in-the-blank is one blank, so it reuses the diagram blank grader unchanged: exact,
  // then synonyms, then confusable rejection, then a typo allowance.
  const result = gradeBlank(response, {
    number: 1,
    answer: question.answer,
    synonyms: question.synonyms,
    confusables: question.confusables,
  });

  return {
    correct: result.correct,
    expected: result.expected,
    rejectedAs: result.rejectedAs,
    matched: result.matched,
    slideImage: slideImage(question),
  };
}

/** Nothing to grade: the rating is the student's own, and answering unlocks the source slide. */
export async function rateFlashcard(
  questionId: unknown,
  known: unknown,
): Promise<FlashcardOutcome | null> {
  const question = find(questionId);
  if (question?.type !== "flashcard" || typeof known !== "boolean") return null;

  return { known, slideImage: slideImage(question) };
}

/** The demo deck has no table questions, so every call is for an unknown one. */
export async function gradeTableAnswers(): Promise<TableOutcome | null> {
  return null;
}
