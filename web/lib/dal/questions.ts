import "server-only";

import { z } from "zod";

import {
  AnswerKeys,
  AssetPayloads,
  objectKeys,
  pageName,
  QuestionPayloads,
  type DocumentStatus,
  type PageName,
  type QuestionType,
} from "@/lib/contracts";
import type { SessionUser } from "@/lib/dal/auth";
import { QUESTION_IMAGE_TTL_SECONDS, signRenders } from "@/lib/dal/storage";
import { FREE_QUESTIONS } from "@/lib/guests";
import type { EssayMarking } from "@/lib/grade-types";
import type { MarkerBox, PublicQuestion } from "@/lib/public-question";
import { TYPE_LABEL } from "@/lib/questions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Questions from Postgres, for studying and for grading.
 *
 * Two clients, two jobs. Studying reads through the user's own session, so RLS decides what
 * exists, and selects public columns only: the answer key lives in `question_keys`, which that
 * client can't read at all. Grading reads the key with the service role, which bypasses RLS, so
 * there the `user_id` filter is the ownership check.
 */

const Id = z.guid();

/**
 * The order a deck is studied in. Enum order puts diagram_blank first, then table_blank;
 * `created_at` keeps generation order within a slide. A guest's free questions are the first in
 * this order, so studying and grading must sort alike.
 */
const STUDY_ORDER = ["type", "source_page", "created_at", "id"] as const;

// Studying

export type StudyDeck = {
  filename: string;
  status: DocumentStatus;
  /** Ready questions only, hero features first: diagrams, then tables, then by type and slide. */
  questions: PublicQuestion[];
  /** Where to resume: the first question the student hasn't answered yet, or 0 once all are. */
  startAt: number;
  /** Questions a guest can't open until they sign up: counted, never sent. */
  locked: number;
};

type StudyRow = {
  id: string;
  type: QuestionType;
  title: string;
  payload: unknown;
  image_path: string | null;
  source_ref: string;
};

/**
 * One of the user's documents with its ready questions, as the browser may see them before
 * answering. Null when the id is malformed or the document isn't theirs.
 */
export async function getStudyDeck(user: SessionUser, documentId: string): Promise<StudyDeck | null> {
  if (!Id.safeParse(documentId).success) return null;

  const supabase = await createClient();
  let query = supabase
    .from("documents")
    .select("filename, status, questions(id, type, title, payload, image_path, source_ref, attempts(id))")
    .eq("id", documentId)
    .eq("questions.status", "ready")
    // Whether a question has been answered, not every attempt at it.
    .limit(1, { referencedTable: "questions.attempts" });
  for (const column of STUDY_ORDER) query = query.order(column, { referencedTable: "questions" });
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;

  // A guest gets the first few; the rest never leave the server, images included.
  const rows = user.isGuest ? data.questions.slice(0, FREE_QUESTIONS) : data.questions;
  const locked = data.questions.length - rows.length;

  // The one image a question is asked with is its blanked render.
  const imagePaths = rows.flatMap((row) => (row.image_path ? [row.image_path] : []));
  const diagramIds = rows.flatMap((row) => (row.type === "diagram_blank" ? [row.id] : []));
  const [imageUrls, boxes] = await Promise.all([
    signRenders(user.id, imagePaths, QUESTION_IMAGE_TTL_SECONDS),
    markerBoxesFor(user, diagramIds),
  ]);

  const questions = rows.flatMap((row) => {
    const question = toPublicQuestion(row, imageUrls, boxes.get(row.id));
    if (!question) console.error(`Question ${row.id} (${row.type}) can't be shown: bad payload or image`);
    return question ? [question] : [];
  });

  const answered = new Set(rows.flatMap((row) => (row.attempts.length > 0 ? [row.id] : [])));
  const unanswered = questions.findIndex((question) => !answered.has(question.id));
  // A guest who has answered every free question resumes at the sign-up card after them.
  const startAt = unanswered >= 0 ? unanswered : locked > 0 ? questions.length : 0;

  return { filename: data.filename, status: data.status, questions, startAt, locked };
}

/** Whether a guest may open this question: one of the first few of its deck, in study order. */
async function isFreeQuestion(user: SessionUser, documentId: string, questionId: string): Promise<boolean> {
  let query = createAdminClient()
    .from("questions")
    .select("id")
    .eq("document_id", documentId)
    .eq("user_id", user.id)
    .eq("status", "ready");
  for (const column of STUDY_ORDER) query = query.order(column);
  const { data, error } = await query.limit(FREE_QUESTIONS);
  if (error) throw error;
  return data.some((row) => row.id === questionId);
}

/**
 * Where each blank sits, per diagram question, for the type-on fields. The position of blank n is
 * the box of label `label_index` in the diagram's asset: both live in service-only tables, so this
 * reads them with the service role and lets positions out alone, never a label's text.
 */
async function markerBoxesFor(
  user: SessionUser,
  questionIds: string[],
): Promise<Map<string, Map<number, MarkerBox>>> {
  const boxes = new Map<string, Map<number, MarkerBox>>();
  if (questionIds.length === 0) return boxes;

  const { data, error } = await createAdminClient()
    .from("questions")
    .select("id, question_keys(answer_key), assets(payload)")
    .in("id", questionIds)
    .eq("user_id", user.id);
  if (error) throw error;

  for (const row of data) {
    boxes.set(row.id, markerBoxes(row.question_keys?.answer_key, row.assets?.payload));
  }
  return boxes;
}

/**
 * Blank number → its box, from a diagram's answer key and its asset's labels. Empty when either
 * doesn't parse, and then the card asks for the answers in a list instead.
 */
export function markerBoxes(answerKey: unknown, assetPayload: unknown): Map<number, MarkerBox> {
  const boxes = new Map<number, MarkerBox>();
  const key = AnswerKeys.diagram_blank.safeParse(answerKey);
  const payload = AssetPayloads.labeled_diagram.safeParse(assetPayload);
  if (!key.success || !payload.success) return boxes;

  for (const blank of key.data.blanks) {
    const label = payload.data.labels[blank.label_index];
    if (label) boxes.set(blank.number, { x: label.x, y: label.y, w: label.w, h: label.h });
  }
  return boxes;
}

/**
 * A row as PublicQuestion, built field by field from the strictly parsed payload, so nothing
 * else a row holds can reach the browser. Null when the payload doesn't parse or a diagram's
 * blanked image couldn't be signed.
 */
function toPublicQuestion(
  row: StudyRow,
  imageUrls: Map<string, string>,
  boxes: Map<number, MarkerBox> | undefined,
): PublicQuestion | null {
  const base = { id: row.id, title: row.title, sourceRef: row.source_ref };

  switch (row.type) {
    case "diagram_blank": {
      const payload = QuestionPayloads.diagram_blank.safeParse(row.payload);
      const image = row.image_path ? imageUrls.get(row.image_path) : undefined;
      if (!payload.success || !image) return null;
      const { prompt, numbers } = payload.data;
      const markers = numbers.map((number) => ({ number, box: boxes?.get(number) ?? null }));
      return { ...base, type: "diagram", typeLabel: TYPE_LABEL.diagram, prompt, image, markers };
    }
    case "mcq": {
      const payload = QuestionPayloads.mcq.safeParse(row.payload);
      if (!payload.success) return null;
      const { prompt, options } = payload.data;
      return { ...base, type: "mcq", typeLabel: TYPE_LABEL.mcq, prompt, options };
    }
    case "short_answer": {
      const payload = QuestionPayloads.short_answer.safeParse(row.payload);
      if (!payload.success) return null;
      const { prompt } = payload.data;
      return { ...base, type: "short_answer", typeLabel: TYPE_LABEL.short_answer, prompt };
    }
    case "flashcard": {
      const payload = QuestionPayloads.flashcard.safeParse(row.payload);
      if (!payload.success) return null;
      const { front, back } = payload.data;
      return { ...base, type: "flashcard", typeLabel: TYPE_LABEL.flashcard, front, back };
    }
    case "table_blank": {
      const payload = QuestionPayloads.table_blank.safeParse(row.payload);
      if (!payload.success) return null;
      const { prompt, header_rows: headerRows, rows } = payload.data;
      return { ...base, type: "table", typeLabel: TYPE_LABEL.table, prompt, headerRows, rows };
    }
    case "essay": {
      const payload = QuestionPayloads.essay.safeParse(row.payload);
      if (!payload.success) return null;
      return { ...base, type: "essay", typeLabel: TYPE_LABEL.essay, prompt: payload.data.prompt, lockedReason: null };
    }
  }
}

// Grading

export type QuestionToGrade = {
  id: string;
  /** The page render answering unlocks, and the file name it downloads as. */
  slide: { path: string; filename: string };
} & (
  | {
      type: "diagram_blank";
      key: z.infer<typeof AnswerKeys.diagram_blank>;
      /** The unblanked crop the blanks were drawn on. */
      revealPath: string;
    }
  | { type: "mcq"; key: z.infer<typeof AnswerKeys.mcq>; optionCount: number }
  | { type: "short_answer"; key: z.infer<typeof AnswerKeys.short_answer> }
  | { type: "flashcard" }
  | { type: "table_blank"; key: z.infer<typeof AnswerKeys.table_blank> }
  | {
      type: "essay";
      key: z.infer<typeof AnswerKeys.essay>;
      prompt: string;
      /** For `llm_requests`: marking is logged against the deck, like generation. */
      documentId: string;
    }
);

/**
 * One of the user's ready questions with everything grading needs, answer key included. Null
 * when the id is malformed, or the question isn't theirs or isn't ready. A ready question whose
 * key doesn't parse is a bug, so that throws.
 */
export async function getQuestionToGrade(
  user: SessionUser,
  questionId: string,
): Promise<QuestionToGrade | null> {
  if (!Id.safeParse(questionId).success) return null;

  const { data, error } = await createAdminClient()
    .from("questions")
    .select(
      "id, type, payload, document_id, source_page, question_keys(answer_key), assets(image_path), documents(filename, mime)",
    )
    .eq("id", questionId)
    .eq("user_id", user.id)
    .eq("status", "ready")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // The paywall holds on the server: a guest's locked question grades as unknown.
  if (user.isGuest && !(await isFreeQuestion(user, data.document_id, data.id))) return null;

  const common = {
    id: data.id,
    slide: {
      path: objectKeys.pageRender(user.id, data.document_id, data.source_page),
      filename: slideFilename(data.documents.filename, pageName(data.documents.mime), data.source_page),
    },
  };
  const answerKey = data.question_keys?.answer_key;

  switch (data.type) {
    case "diagram_blank": {
      const revealPath = data.assets?.image_path;
      if (!revealPath) throw new Error(`Diagram question ${data.id} has no unblanked image`);
      return { ...common, type: data.type, key: AnswerKeys.diagram_blank.parse(answerKey), revealPath };
    }
    case "mcq":
      return {
        ...common,
        type: data.type,
        key: AnswerKeys.mcq.parse(answerKey),
        optionCount: QuestionPayloads.mcq.parse(data.payload).options.length,
      };
    case "short_answer":
      return { ...common, type: data.type, key: AnswerKeys.short_answer.parse(answerKey) };
    case "flashcard":
      return { ...common, type: data.type };
    case "table_blank":
      return { ...common, type: data.type, key: AnswerKeys.table_blank.parse(answerKey) };
    case "essay":
      return {
        ...common,
        type: data.type,
        key: AnswerKeys.essay.parse(answerKey),
        prompt: QuestionPayloads.essay.parse(data.payload).prompt,
        documentId: data.document_id,
      };
  }
}

/**
 * "Brain Anatomy.pptx", slide 3 → "Brain-Anatomy-slide-3.png", and a PDF's page 3 → "…-page-3.png":
 * safe in a Content-Disposition header.
 */
function slideFilename(deckFilename: string, name: PageName, page: number): string {
  const stem = deckFilename
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return stem ? `${stem}-${name}-${page}.png` : `${name}-${page}.png`;
}

/**
 * What the student gave, as `attempts.response` stores it. Grading again against the stored key
 * reproduces every per-blank result, so only the answer itself is kept.
 */
export type AttemptResponse =
  /** Diagram: the text typed for each blank, keyed by its marker number. */
  | { blanks: Record<string, string> }
  /** Multiple choice: the index of the option picked, in the stored (shuffled) order. */
  | { choice: number }
  /** Fill in the blank, or a written answer. */
  | { text: string }
  /** Flashcard: the student's own rating. */
  | { known: boolean }
  /** Table: the text typed for each blanked cell, keyed by its number. */
  | { cells: Record<string, string> };

/**
 * Stores an attempt with the service role. The composite foreign key on `attempts` refuses a
 * question that isn't the user's. A written answer keeps how it was marked.
 */
export async function recordAttempt(
  user: SessionUser,
  questionId: string,
  response: AttemptResponse,
  correct: boolean,
  marking?: EssayMarking,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("attempts")
    .insert({ user_id: user.id, question_id: questionId, response, correct, marking });
  if (error) throw error;
}
