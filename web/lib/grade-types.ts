/**
 * What grading sends back, and the actions a QuestionCard calls to get it.
 *
 * A result is the first moment an answer may reach the browser, so it also carries what answering
 * unlocks: the source slide for every type, and the unblanked diagram for a diagram question. A
 * table's blanked cells come back as the expected answers in its results. Both
 * show answers, which is why neither is ever part of a PublicQuestion.
 *
 * The demo and the product each implement QuestionActions with their own server actions — the
 * demo grades from committed JSON, the product from Postgres — so one QuestionCard serves both.
 */

import type { BlankResult } from "@/lib/grading";

/** Unlocked by answering: the full render of the slide the question came from. */
type Unlocked = { slideImage: string };

export type DiagramOutcome = Unlocked & {
  results: BlankResult[];
  score: number;
  total: number;
  /** The diagram with its labels showing. */
  revealImage: string;
};

export type McqOutcome = Unlocked & {
  chosen: number;
  correct: boolean;
  answerIndex: number;
};

export type ShortAnswerOutcome = Unlocked & {
  correct: boolean;
  expected: string;
  rejectedAs?: BlankResult["rejectedAs"];
  matched: BlankResult["matched"];
};

/** Graded cell by cell, like a diagram; the expected answers come back in `results`. */
export type TableOutcome = Unlocked & {
  results: BlankResult[];
  score: number;
  total: number;
};

/** Self-rated: the student's own verdict is the whole attempt. */
export type FlashcardOutcome = Unlocked & { known: boolean };

/** How a model marked a written answer against the question's rubric. */
export type EssayMarking = {
  criteria: { criterion: string; points: number; outOf: number; feedback: string }[];
  points: number;
  outOf: number;
  comment: string;
};

/** Marked, so the model answer that earns every point can be shown too. */
export type EssayOutcome = Unlocked & EssayMarking & { modelAnswer: string };

/** Marking costs credits and asks a model, so it can fail in ways the student should hear about. */
export type EssayResult =
  | { ok: true; outcome: EssayOutcome }
  /** `topUp`: out of credits, so the card points to where more come from. */
  | { ok: false; error: string; topUp?: boolean };

/** Each returns null for an unknown question or a malformed answer. */
export type QuestionActions = {
  gradeDiagramAnswers: (
    questionId: string,
    responses: Record<string, string>,
  ) => Promise<DiagramOutcome | null>;
  gradeMcqChoice: (questionId: string, choice: number) => Promise<McqOutcome | null>;
  gradeShortAnswerResponse: (
    questionId: string,
    response: string,
  ) => Promise<ShortAnswerOutcome | null>;
  rateFlashcard: (questionId: string, known: boolean) => Promise<FlashcardOutcome | null>;
  gradeTableAnswers: (
    questionId: string,
    responses: Record<string, string>,
  ) => Promise<TableOutcome | null>;
  /** Only the product marks written answers; the demo shows its essay locked. */
  markEssay?: (questionId: string, answer: string) => Promise<EssayResult | null>;
};
