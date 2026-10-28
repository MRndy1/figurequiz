/**
 * What Claude returns on each generation route: sent as the structured-output format, then
 * checked again with Zod when the reply comes back (web/lib/llm/call.ts).
 *
 * Shapes only. Structured outputs can't enforce counts or lengths, and one stray item should not
 * cost a whole slide, so limits and every rule that needs the slide or the grader to judge —
 * evidence in the slide text, an answer key that grades its own label, options that differ — live
 * in web/lib/generation/validate.ts, which drops what fails. Every field is required, as strict
 * schemas want; "none" is an empty list or an empty string.
 */

import { z } from "zod";

/** Route `diagram_labels`: which extracted labels to blank, and how to grade each one. */
export const DiagramLabelsOutput = z.strictObject({
  title: z.string().describe("A short name for what the diagram shows, naming no covered label."),
  blanks: z.array(
    z.strictObject({
      label_index: z.int().min(0).describe("The label's index in the list you were given."),
      answer: z.string(),
      synonyms: z.array(z.string()),
      confusables: z.array(z.string()),
    }),
  ),
});
export type DiagramLabelsOutput = z.infer<typeof DiagramLabelsOutput>;

/** Route `table_cells`: which cells of an extracted table to blank, and how to grade each one. */
export const TableCellsOutput = z.strictObject({
  title: z.string().describe("A short name for what the table shows, naming no covered cell."),
  blanks: z.array(
    z.strictObject({
      row: z.int().min(0).describe("The cell's row, counted from 0."),
      col: z.int().min(0).describe("The cell's column, counted from 0."),
      answer: z.string(),
      synonyms: z.array(z.string()),
      confusables: z.array(z.string()),
    }),
  ),
});
export type TableCellsOutput = z.infer<typeof TableCellsOutput>;

/** Route `text_questions`: questions answerable from one slide's text. */
export const TextQuestionsOutput = z.strictObject({
  mcqs: z.array(
    z.strictObject({
      title: z.string(),
      question: z.string(),
      correct: z.string(),
      distractors: z.array(z.string()).describe("Exactly three wrong answers."),
      evidence: z.string(),
    }),
  ),
  fill_ins: z.array(
    z.strictObject({
      title: z.string(),
      sentence: z.string().describe("The sentence with the missing term written as ____."),
      answer: z.string(),
      synonyms: z.array(z.string()),
      confusables: z.array(z.string()),
      evidence: z.string(),
    }),
  ),
  flashcards: z.array(
    z.strictObject({
      title: z.string(),
      front: z.string(),
      back: z.string(),
      evidence: z.string(),
    }),
  ),
});
export type TextQuestionsOutput = z.infer<typeof TextQuestionsOutput>;

/** Route `image_check`: what kind of picture a diagram candidate is. */
export const ImageCheckOutput = z.strictObject({
  reason: z.string().describe("What the picture shows, in at most fifteen words."),
  kind: z.enum(["labelled_diagram", "screenshot", "chart", "photo", "text", "decoration", "plain_figure"]),
});
export type ImageCheckOutput = z.infer<typeof ImageCheckOutput>;

/** Route `essay_questions`: written-answer questions from a deck's text, and how to mark them. */
export const EssayQuestionsOutput = z.strictObject({
  essays: z.array(
    z.strictObject({
      title: z.string(),
      prompt: z.string(),
      source_page: z.int().describe("The page the question draws on most."),
      rubric: z.array(z.strictObject({ criterion: z.string(), points: z.int() })),
      model_answer: z.string(),
    }),
  ),
});
export type EssayQuestionsOutput = z.infer<typeof EssayQuestionsOutput>;

/** Route `essay_marking`: feedback and points for each rubric criterion, in the rubric's order. */
export const EssayMarkingOutput = z.strictObject({
  criteria: z.array(z.strictObject({ feedback: z.string(), points: z.int() })),
  comment: z.string().describe("Two sentences at most, to the student."),
});
export type EssayMarkingOutput = z.infer<typeof EssayMarkingOutput>;
