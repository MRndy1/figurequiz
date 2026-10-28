/**
 * Turns one route's reply into questions `create_question` accepts, enforcing at runtime the
 * invariants web/lib/questions.test.ts checks over the hand-written demo deck. It grades with
 * web/lib/grading.ts itself, so "this key grades as intended" means exactly what the grader will
 * do to a student's answer.
 *
 * Nothing is repaired by guessing. A part that breaks a rule is dropped — a confusable the grader
 * would accept, a synonym two blanks share — and a question that breaks one is dropped whole:
 * evidence that is not on the slide, a sentence that already shows its answer. Fewer questions
 * beat a key that marks a correct student wrong.
 */

import { randomInt } from "node:crypto";

import type { z } from "zod";

import { CreateQuestionArgs, GAP, type PageName } from "@/lib/contracts";
import { countWords, ESSAY_MAX_WORDS } from "@/lib/essays";
import { gradeBlank, normalize, type BlankKey } from "@/lib/grading";
import type {
  DiagramLabelsOutput,
  EssayQuestionsOutput,
  TableCellsOutput,
  TextQuestionsOutput,
} from "@/lib/schemas/generation";

/** Fewer than two blanks is not worth a question; more than eight is a wall of boxes. */
export const BLANKS = { min: 2, max: 8 };
/** Per slide, as the text prompt asks. */
export const PER_SLIDE = { mcqs: 3, fillIns: 2, flashcards: 3 };
/** Per deck, as the essay prompt asks: usually one. */
export const ESSAYS_PER_DECK = 2;
/** A blank takes a term, not a phrase: longer answers can't be graded by matching. */
const MAX_ANSWER_WORDS = 5;
const MAX_TITLE_LENGTH = 80;

/** Shown with every diagram: it reads the same for a neuron, a network or a water cycle. */
export const DIAGRAM_PROMPT = "Fill in each numbered label.";
/** Shown with every table. */
export const TABLE_PROMPT = "Fill in each numbered cell.";

const NONE_OF_THESE = /\b(?:all|none|both|neither)\s+of\s+(?:the\s+)?(?:above|these|them|those)\b/i;

export type DiagramSource = {
  documentId: string;
  assetId: string;
  page: number;
  slideTitle: string | null;
  /** The asset's labels: an index into this list is a key's `label_index`. */
  labels: { text: string }[];
  model: string;
};

export type TableSource = {
  documentId: string;
  assetId: string;
  page: number;
  slideTitle: string | null;
  /** The asset's cells: a key's `row` and `col` index into these. */
  rows: string[][];
  /** Heading rows at the top, never blanked. */
  headerRows: number;
  model: string;
};

export type TextSource = {
  documentId: string;
  assetId: string;
  page: number;
  title: string | null;
  /** One paragraph per line, as the asset stores it. */
  text: string;
  /** What the document's pages are called: a deck's are slides. */
  pageName: PageName;
  model: string;
};

type Answer = { answer: string; synonyms: string[]; confusables: string[] };
type Blank = Answer & { labelIndex: number };
type Cell = Answer & { row: number; col: number };

/** One diagram question from the model's choice of labels, or null when too few survive. */
export function diagramQuestion(
  source: DiagramSource,
  output: DiagramLabelsOutput,
): CreateQuestionArgs | null {
  const { labels } = source;
  let blanks: Blank[] = [];

  for (const proposed of output.blanks) {
    const label = labels[proposed.label_index];
    const answer = proposed.answer.trim();
    if (!label || !normalize(answer) || words(answer) > MAX_ANSWER_WORDS) continue;
    if (blanks.some((blank) => blank.labelIndex === proposed.label_index)) continue;
    if (blanks.some((blank) => normalize(blank.answer) === normalize(answer))) continue;

    const blank: Blank = {
      labelIndex: proposed.label_index,
      answer,
      synonyms: distinct(proposed.synonyms, [answer]),
      confusables: distinct(proposed.confusables),
    };
    // The box covers this label, so the label as printed must grade correct; if it doesn't, the
    // model paired an answer with the wrong label. An answer that is most of the label (without a
    // marker letter or a parenthetical) is fine, and the printed form is then accepted as well.
    if (!gradeBlank(label.text, keyOf(blank)).correct) {
      if (!coversLabel(label.text, answer)) continue;
      blank.synonyms.push(label.text.trim());
    }
    blanks.push(blank);
  }

  dropSharedSynonyms(blanks);

  // Every other label stays readable or is another blank. One that already grades correct here
  // prints this answer twice; one that only passes as a typo is a near-identical term, which the
  // grader must reject.
  blanks = blanks.filter((blank) =>
    labels.every((label, index) => {
      if (index === blank.labelIndex) return true;
      const result = gradeBlank(label.text, keyOf(blank));
      if (result.correct && result.matched !== "fuzzy") return false;
      if (result.correct) blank.confusables.push(label.text.trim());
      return true;
    }),
  );

  blanks = blanks.sort((a, b) => a.labelIndex - b.labelIndex).slice(0, BLANKS.max);
  if (blanks.length < BLANKS.min) return null;

  const keys = blanks.map(keyOf);
  for (const blank of blanks) blank.confusables = rejectable(blank.confusables, keyOf(blank), keys);

  const answers = blanks.flatMap((blank) => [blank.answer, ...blank.synonyms]);
  return (
    checked({
      type: "diagram_blank",
      document_id: source.documentId,
      asset_id: source.assetId,
      source_page: source.page,
      title: pickTitle([output.title, source.slideTitle], answers, "Label the diagram"),
      payload: { prompt: DIAGRAM_PROMPT, numbers: blanks.map((_, index) => index + 1) },
      answer_key: {
        blanks: blanks.map((blank, index) => ({
          number: index + 1,
          label_index: blank.labelIndex,
          answer: blank.answer,
          synonyms: blank.synonyms,
          confusables: blank.confusables,
        })),
      },
      model_used: source.model,
    })[0] ?? null
  );
}

/**
 * One table question from the model's choice of cells, or null when too few survive. The same rules
 * as a diagram's labels, with cells: a heading or empty cell is never blanked, the cell as printed
 * must grade correct, and no cell left visible may show a blank's answer.
 */
export function tableQuestion(source: TableSource, output: TableCellsOutput): CreateQuestionArgs | null {
  const { rows, headerRows } = source;
  const columns = rows[0]?.length ?? 0;
  const keyOfCell = (cell: Cell): BlankKey => ({ ...cell, number: cell.row * columns + cell.col + 1 });
  let cells: Cell[] = [];

  for (const proposed of output.blanks) {
    const { row, col } = proposed;
    const text = row >= headerRows ? rows[row]?.[col] : undefined;
    const answer = proposed.answer.trim();
    if (!text || !normalize(text) || !normalize(answer) || words(answer) > MAX_ANSWER_WORDS) continue;
    if (cells.some((cell) => cell.row === row && cell.col === col)) continue;
    if (cells.some((cell) => normalize(cell.answer) === normalize(answer))) continue;

    const cell: Cell = {
      row,
      col,
      answer,
      synonyms: distinct(proposed.synonyms, [answer]),
      confusables: distinct(proposed.confusables),
    };
    // As with a diagram's label: the cell as printed must grade correct, or the model paired an
    // answer with the wrong cell.
    if (!gradeBlank(text, keyOfCell(cell)).correct) {
      if (!coversLabel(text, answer)) continue;
      cell.synonyms.push(text.trim());
    }
    cells.push(cell);
  }

  dropSharedSynonyms(cells);

  // Every other cell is visible or another blank. One that shows an accepted form in its words
  // gives the answer away; one that only passes as a typo is a near-identical term to reject.
  cells = cells.filter((cell) => {
    const accepted = [cell.answer, ...cell.synonyms];
    return rows.every((row, r) =>
      row.every((text, c) => {
        if ((r === cell.row && c === cell.col) || !normalize(text)) return true;
        if (shows(text, accepted)) return false;
        if (gradeBlank(text, keyOfCell(cell)).correct) cell.confusables.push(text.trim());
        return true;
      }),
    );
  });

  // Each row keeps a cell visible to work its blanks out from.
  cells = cells
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .filter((cell, index, sorted) => {
      const inRow = sorted.filter((other) => other.row === cell.row);
      const filled = rows[cell.row].filter((text) => normalize(text)).length;
      return inRow.length < filled || inRow.indexOf(cell) < filled - 1;
    })
    .slice(0, BLANKS.max);
  if (cells.length < BLANKS.min) return null;

  const keys = cells.map(keyOfCell);
  for (const cell of cells) cell.confusables = rejectable(cell.confusables, keyOfCell(cell), keys);

  const numberAt = new Map(cells.map((cell, index) => [`${cell.row}:${cell.col}`, index + 1]));
  const answers = cells.flatMap((cell) => [cell.answer, ...cell.synonyms]);
  return (
    checked({
      type: "table_blank",
      document_id: source.documentId,
      asset_id: source.assetId,
      source_page: source.page,
      title: pickTitle([output.title, source.slideTitle], answers, "Fill in the table"),
      payload: {
        prompt: TABLE_PROMPT,
        header_rows: headerRows === 1 ? 1 : 0,
        rows: rows.map((row, r) =>
          row.map((text, c) => {
            const number = numberAt.get(`${r}:${c}`);
            return number === undefined ? text : { blank: number };
          }),
        ),
      },
      answer_key: {
        blanks: cells.map((cell, index) => ({
          number: index + 1,
          row: cell.row,
          col: cell.col,
          answer: cell.answer,
          synonyms: cell.synonyms,
          confusables: cell.confusables,
        })),
      },
      model_used: source.model,
    })[0] ?? null
  );
}

/** The slide's multiple-choice, fill-in-the-blank and flashcard questions that hold up. */
export function textQuestions(source: TextSource, output: TextQuestionsOutput): CreateQuestionArgs[] {
  const slide = ` ${normalize(`${source.title ?? ""}\n${source.text}`)} `;
  // The quote a question was written from must be on the slide, so it is answerable from it.
  const grounded = (evidence: string) =>
    words(evidence) >= 2 && slide.includes(` ${normalize(evidence)} `);
  const fallbacks = [source.title, `From ${source.pageName} ${source.page}`];
  const base = {
    document_id: source.documentId,
    asset_id: source.assetId,
    source_page: source.page,
    model_used: source.model,
  };

  const mcqs = output.mcqs.flatMap((mcq) => {
    const question = mcq.question.trim();
    const correct = mcq.correct.trim();
    if (!question || !normalize(correct) || NONE_OF_THESE.test(correct)) return [];
    if (!grounded(mcq.evidence) || shows(question, [correct])) return [];
    const distractors = distinct(mcq.distractors, [correct])
      .filter((distractor) => !NONE_OF_THESE.test(distractor))
      .slice(0, 3);
    if (distractors.length < 2) return [];
    // Models tend to put the answer first, so the order is the server's.
    const options = shuffle([correct, ...distractors]);
    return checked({
      ...base,
      type: "mcq",
      title: pickTitle([mcq.title, ...fallbacks], [correct], "Practice question"),
      payload: { prompt: question, options },
      answer_key: { answer_index: options.indexOf(correct) },
    });
  });

  const fillIns = output.fill_ins.flatMap((fillIn) => {
    const prompt = fillIn.sentence.trim().replace(/_{3,}/g, GAP);
    const answer = fillIn.answer.trim();
    if (prompt.split(GAP).length !== 2) return [];
    if (!normalize(answer) || words(answer) > MAX_ANSWER_WORDS) return [];
    const synonyms = distinct(fillIn.synonyms, [answer]);
    const accepted = [answer, ...synonyms];
    // The missing term comes from the slide, and the sentence around the gap must not show it.
    if (!grounded(fillIn.evidence) || !shows(fillIn.evidence, accepted)) return [];
    if (shows(prompt.replace(GAP, " "), accepted)) return [];
    const confusables = rejectable(fillIn.confusables, { number: 1, answer, synonyms });
    return checked({
      ...base,
      type: "short_answer",
      title: pickTitle([fillIn.title, ...fallbacks], accepted, "Practice question"),
      payload: { prompt },
      answer_key: { answer, synonyms, confusables },
    });
  });

  const flashcards = output.flashcards.flatMap((card) => {
    const front = card.front.trim();
    const back = card.back.trim();
    if (!front || !back || !grounded(card.evidence)) return [];
    return checked({
      ...base,
      type: "flashcard",
      title: pickTitle([card.title, ...fallbacks], [], "Practice question"),
      payload: { front, back },
    });
  });

  return [
    ...mcqs.slice(0, PER_SLIDE.mcqs),
    ...fillIns.slice(0, PER_SLIDE.fillIns),
    ...flashcards.slice(0, PER_SLIDE.flashcards),
  ];
}

export type EssaySource = {
  documentId: string;
  /** The pages the essays were written from: each must cite one of them. */
  pages: number[];
  model: string;
};

/**
 * The deck's written-answer questions that hold up: citing a page they were written from, with a
 * rubric the contract accepts, and a model answer a student could write within the limit, since
 * it earns every point.
 */
export function essayQuestions(source: EssaySource, output: EssayQuestionsOutput): CreateQuestionArgs[] {
  const essays = output.essays.flatMap((essay) => {
    const prompt = essay.prompt.trim();
    const modelAnswer = essay.model_answer.trim();
    if (!prompt || !source.pages.includes(essay.source_page)) return [];
    if (!modelAnswer || countWords(modelAnswer) > ESSAY_MAX_WORDS) return [];
    return checked({
      type: "essay",
      document_id: source.documentId,
      title: pickTitle([essay.title], [], "Written answer"),
      source_page: essay.source_page,
      payload: { prompt },
      answer_key: {
        rubric: essay.rubric.map(({ criterion, points }) => ({ criterion: criterion.trim(), points })),
        model_answer: modelAnswer,
      },
      model_used: source.model,
    });
  });
  return essays.slice(0, ESSAYS_PER_DECK);
}

function keyOf(blank: Blank): BlankKey {
  // Label indexes are unique, so they serve as the grader's blank numbers until final numbering.
  return {
    number: blank.labelIndex + 1,
    answer: blank.answer,
    synonyms: blank.synonyms,
    confusables: blank.confusables,
  };
}

/** A form two blanks accept would grade one blank's answer correct on the other: drop it from both. */
function dropSharedSynonyms(blanks: Answer[]): void {
  const accepted = blanks.map((blank) => [blank.answer, ...blank.synonyms].map(normalize));
  blanks.forEach((blank, index) => {
    const elsewhere = new Set(accepted.filter((_, other) => other !== index).flat());
    blank.synonyms = blank.synonyms.filter((synonym) => !elsewhere.has(normalize(synonym)));
  });
}

/** Confusables the grader would still accept, being the answer or a synonym, are dropped. */
function rejectable(confusables: string[], key: BlankKey, keys: BlankKey[] = []): string[] {
  const candidates = distinct(confusables);
  const withAll = { ...key, confusables: candidates };
  return candidates.filter((candidate) => !gradeBlank(candidate, withAll, keys).correct);
}

/** Whether an answer is most of its label, as when the label adds a marker letter or a note. */
function coversLabel(label: string, answer: string): boolean {
  return shows(label, [answer]) && normalize(answer).length * 2 >= normalize(label).length;
}

/** Whether `text`, read the way the grader reads answers, shows any of `terms` as whole words. */
function shows(text: string, terms: string[]): boolean {
  const haystack = ` ${normalize(text)} `;
  return terms.some((term) => {
    const needle = normalize(term);
    return needle !== "" && haystack.includes(` ${needle} `);
  });
}

/** Trimmed, non-blank and distinct as the grader compares them, minus `exclude`. */
function distinct(values: string[], exclude: string[] = []): string[] {
  const seen = new Set(exclude.map(normalize));
  const kept: string[] = [];
  for (const value of values) {
    const key = normalize(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(value.trim());
  }
  return kept;
}

function words(value: string): number {
  const normalized = normalize(value);
  return normalized ? normalized.split(" ").length : 0;
}

/** The first candidate short enough to be a title that shows none of `answers`. */
function pickTitle(candidates: (string | null)[], answers: string[], last: string): string {
  for (const candidate of candidates) {
    const title = candidate?.trim() ?? "";
    if (title && title.length <= MAX_TITLE_LENGTH && !shows(title, answers)) return title;
  }
  return last;
}

function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/** The question as `create_question` takes it, or nothing if the contract refuses it. */
function checked(question: z.input<typeof CreateQuestionArgs>): CreateQuestionArgs[] {
  const parsed = CreateQuestionArgs.safeParse(question);
  if (parsed.success) return [parsed.data];
  console.warn(`generation: dropped a question the contract refuses: ${parsed.error.issues[0]?.message}`);
  return [];
}
