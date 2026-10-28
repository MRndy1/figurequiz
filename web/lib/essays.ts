/**
 * Written answers (docs/credits-plan.md, phase 4): the limits the essay card and the marking
 * action both hold to. No question data here, so client components may import it.
 */

/** The most a written answer may run to. */
export const ESSAY_MAX_WORDS = 250;

/** What marking one written answer costs: a model reads it, so it takes credits. */
export const MARKING_CREDITS = 2;

/** Words as a student counts them: runs of characters between spaces. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
