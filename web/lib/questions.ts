/**
 * Question data for the demo at /demo.
 *
 * Hand-authored from the sample lecture deck and committed under data/demo/ as JSON plus images,
 * exactly as `ingest` will emit them once generation runs against the Claude API. The shape
 * mirrors the `questions` / answer-key split in CLAUDE.md, so moving this into Postgres later is a
 * change of data source rather than a rewrite.
 *
 * SAFETY: this module is server-only. Everything that identifies a correct answer —
 * `blanks[].answer`, `answerIndex`, `answer` — must never reach a client component. Use
 * `toPublic()` for anything crossing that boundary. It has no `import "server-only"` guard on
 * purpose: tests and Node scripts read the demo deck through it.
 */

import questionsData from "@/data/demo/questions.json";
import type { PublicQuestion } from "@/lib/public-question";

export type BlankBox = { x: number; y: number; w: number; h: number };

export type QuestionBlank = {
  number: number;
  answer: string;
  synonyms?: string[];
  confusables?: string[];
  box: BlankBox;
};

type QuestionCommon = {
  id: string;
  title: string;
  /** Where this came from, e.g. "lecture-04.pptx, slide 14" — a trust feature, not decoration. */
  sourceRef: string;
  /** 1-based slide number, so the student can open the slide it was generated from. */
  sourceSlide: number;
};

/** Label the blanked-out parts of a diagram. */
export type DiagramQuestion = QuestionCommon & {
  type: "diagram";
  prompt: string;
  /** File name of the blanked render in public/demo/. */
  image: string;
  blanks: QuestionBlank[];
};

/** One correct option out of four. */
export type McqQuestion = QuestionCommon & {
  type: "mcq";
  prompt: string;
  options: string[];
  answerIndex: number;
};

/** A sentence with a gap written as `____`, graded with the same rules as a diagram blank. */
export type ShortAnswerQuestion = QuestionCommon & {
  type: "short_answer";
  prompt: string;
  answer: string;
  synonyms?: string[];
  confusables?: string[];
};

/** Self-rated: no auto-grading, so the back is allowed to reach the browser. */
export type FlashcardQuestion = QuestionCommon & {
  type: "flashcard";
  front: string;
  back: string;
};

/** Shown but not answerable yet: marking written answers needs a live model call. */
export type EssayQuestion = QuestionCommon & {
  type: "essay";
  prompt: string;
  locked: true;
  lockedReason: string;
};

export type Question =
  | DiagramQuestion
  | McqQuestion
  | ShortAnswerQuestion
  | FlashcardQuestion
  | EssayQuestion;

export type QuestionType = Question["type"];

export const questions = questionsData as Question[];

export function getQuestion(id: string): Question | undefined {
  return questions.find((question) => question.id === id);
}

/**
 * File name of the un-blanked render in data/demo/. It shows every answer, so it is served only
 * through lib/demo/media.ts, after grading.
 */
export function originalImage(question: DiagramQuestion): string {
  return question.image.replace(/\.png$/, "-original.png");
}

export const TYPE_LABEL: Record<PublicQuestion["type"], string> = {
  diagram: "Diagram",
  mcq: "Multiple choice",
  short_answer: "Fill in the blank",
  flashcard: "Flashcard",
  essay: "Written answer",
  table: "Table",
};

/** How many parts a question has, for the list summary. */
export function questionSummary(question: Question): string {
  switch (question.type) {
    case "diagram":
      return `${question.blanks.length} labels`;
    case "mcq":
      return `${question.options.length} options`;
    case "short_answer":
      return "One blank";
    case "flashcard":
      return "Self-rated";
    case "essay":
      return "Locked";
  }
}

/** Questions a student actually works through, in order. */
export function studyQuestions(): Question[] {
  return questions;
}

/*
 * The client-safe projection.
 *
 * Every branch below drops the answer key. Flashcards are the one exception and deliberately
 * so: they are self-rated, the student presses "show answer" themselves, and nothing about
 * them is graded, so the back is not a key.
 *
 * Images that show answers — the un-blanked diagram and the source slide — are left out too.
 * The grading actions hand them out once an answer is in.
 */

export function toPublic(question: Question): PublicQuestion {
  const base = {
    id: question.id,
    title: question.title,
    sourceRef: question.sourceRef,
    // Computed here, on the server: client components must not import this module, because it
    // pulls in questions.json — answer keys and all.
    typeLabel: TYPE_LABEL[question.type],
  };

  switch (question.type) {
    case "diagram":
      return {
        ...base,
        type: "diagram",
        prompt: question.prompt,
        image: `/demo/${question.image}`,
        // Positions only: copied field by field so nothing else a blank holds can come along.
        markers: question.blanks.map(({ number, box }) => ({
          number,
          box: { x: box.x, y: box.y, w: box.w, h: box.h },
        })),
      };
    case "mcq":
      return { ...base, type: "mcq", prompt: question.prompt, options: question.options };
    case "short_answer":
      return { ...base, type: "short_answer", prompt: question.prompt };
    case "flashcard":
      return { ...base, type: "flashcard", front: question.front, back: question.back };
    case "essay":
      return {
        ...base,
        type: "essay",
        prompt: question.prompt,
        lockedReason: question.lockedReason,
      };
  }
}
