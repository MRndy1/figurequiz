/**
 * What the browser may know about a question before it is answered.
 *
 * The demo builds this with `toPublic` in lib/questions.ts; the product will build it from
 * Postgres. Either way it carries no answer key and nothing that shows one: the unblanked diagram
 * and the source slide arrive only in a grade result (lib/grade-types.ts).
 *
 * This module holds no question data, so client components may import from it.
 */

/** Where a numbered blank sits, as 0–1 fractions of the blanked image. A position, never text. */
export type MarkerBox = { x: number; y: number; w: number; h: number };

/** A cell of a table question: its text, or the number of the blank the student fills in. */
export type TableCell = string | { blank: number };

export type PublicQuestion = {
  id: string;
  title: string;
  /** Where this came from, e.g. "lecture-04.pptx, slide 14" — a trust feature, not decoration. */
  sourceRef: string;
  typeLabel: string;
} & (
  | {
      type: "diagram";
      prompt: string;
      /** The render with numbered blanks over its labels. */
      image: string;
      /**
       * One per numbered blank, in order. `box` places a type-on field over the blank; it is null
       * when the position is unknown, and the card falls back to a list of fields.
       */
      markers: { number: number; box: MarkerBox | null }[];
    }
  | { type: "mcq"; prompt: string; options: string[] }
  | { type: "short_answer"; prompt: string }
  // Self-rated, not graded, so the back is not a key and may ship with the front.
  | { type: "flashcard"; front: string; back: string }
  | {
      type: "table";
      prompt: string;
      /** Heading rows at the top: 0 or 1. */
      headerRows: number;
      /** The table's cells, each blanked one as its number: never its text. */
      rows: TableCell[][];
    }
  /** Written, then marked by a model. The demo can't mark, so it says why: `lockedReason`. */
  | { type: "essay"; prompt: string; lockedReason: string | null }
);
