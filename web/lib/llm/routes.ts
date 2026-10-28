/**
 * Which model answers each kind of call (CLAUDE.md, Claude API usage, decided 2026-10-26).
 *
 * Effort is pinned per route, never inherited: both models think adaptively by default, thinking
 * is billed as output tokens, and output dominates the bill. Pinning it also keeps each route's
 * request identical apart from the slide, so its cached system prompt keeps hitting. Caches are
 * per model, so each route warms its own. Model ids are OpenRouter slugs.
 */
export const ROUTES = {
  /** What kind of picture a diagram candidate is, so only labelled diagrams reach Sonnet. */
  image_check: { model: "anthropic/claude-haiku-5.5", effort: "low", maxTokens: 4000 },
  /** Which labels to blank, with synonyms and confusables: a wrong key mis-grades students. */
  diagram_labels: { model: "anthropic/claude-sonnet-5.5", effort: "medium", maxTokens: 8000 },
  /** Which table cells to blank, with synonyms and confusables: the same stakes as a diagram. */
  table_cells: { model: "anthropic/claude-sonnet-5.5", effort: "medium", maxTokens: 8000 },
  /** Multiple choice, fill-in-the-blank and flashcards from one slide's text. */
  text_questions: { model: "anthropic/claude-haiku-5.5", effort: "low", maxTokens: 8000 },
  /** A deck's written-answer questions, each with the rubric and model answer it's marked by. */
  essay_questions: { model: "anthropic/claude-sonnet-5.5", effort: "low", maxTokens: 8000 },
  /** Marks a written answer against its rubric: the student pays credits for it and reads it. */
  essay_marking: { model: "anthropic/claude-sonnet-5.5", effort: "medium", maxTokens: 8000 },
} as const;

export type RouteName = keyof typeof ROUTES;
