/**
 * The shapes web and the ingest worker exchange, and where their files live in Storage.
 *
 * Postgres is where the two services meet: the worker reads queue messages and hands back
 * assets through the job functions (supabase/migrations), and web writes questions and reads
 * everything back. So these schemas describe jsonb — snake_case keys, the database's own enum
 * values — and each has an example in contracts/examples.json that this file's test and the
 * worker's tests both parse. Change a shape here, in that file and in the worker together.
 *
 * Objects are strict: an unexpected key is an error rather than silently dropped. That catches
 * drift between the services early, and keeps anything answer-like out of a public payload.
 */

import { z } from "zod";

import { Constants } from "@/lib/supabase/database.types";

const Enums = Constants.public.Enums;

export const DocumentStatus = z.enum(Enums.document_status);
export const QuestionStatus = z.enum(Enums.question_status);
export const QuestionType = z.enum(Enums.question_type);
export const AssetKind = z.enum(Enums.asset_kind);
export type DocumentStatus = z.infer<typeof DocumentStatus>;
export type QuestionStatus = z.infer<typeof QuestionStatus>;
export type QuestionType = z.infer<typeof QuestionType>;
export type AssetKind = z.infer<typeof AssetKind>;

/** Any id Postgres `uuid` accepts. The worker's asset ids are deterministic (UUIDv5). */
const Id = z.guid();
/** 1-based, as people number slides. */
const PageNumber = z.int().min(1);
const Text = z.string().regex(/\S/, "must not be blank");
/** A key inside a bucket: it starts with the owner's user id and never names the bucket. */
const ObjectKey = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/\S+$/i,
    "must be an object key that starts with the owner's user id",
  );

/*
 * Boxes are 0-1 fractions of the stored image they are drawn on — the crop in `renders`, never
 * the slide — so nothing downstream needs to know EMU, points or render zoom.
 */

const boxShape = {
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
};
type Box = { x: number; y: number; w: number; h: number };
/** Coordinates are rounded to 4 places, which can push a box touching the edge just past it. */
const EDGE_TOLERANCE = 1e-3;
const insideImage = (box: Box) =>
  box.x + box.w <= 1 + EDGE_TOLERANCE && box.y + box.h <= 1 + EDGE_TOLERANCE;
const INSIDE_IMAGE = { message: "the box must lie inside the image" };

// Asset payloads (`assets.payload`), written by the worker.

export const DiagramLabel = z
  .strictObject({
    text: Text,
    ...boxShape,
    /** Tesseract's 0-100 confidence, on Tier 2 labels only. */
    confidence: z.number().min(0).max(100).optional(),
  })
  .refine(insideImage, INSIDE_IMAGE);

/**
 * Every label extraction found on one diagram. A label's index in `labels` is the
 * `label_index` an answer key refers to, so the order never changes once written.
 */
export const LabeledDiagramPayload = z.strictObject({
  labels: z.array(DiagramLabel).min(1),
  image_width: z.int().positive(),
  image_height: z.int().positive(),
});

/**
 * A slide's or PDF page's visible text. Speaker notes stay out: every question links back to its
 * slide, so whatever it tests has to be checkable there.
 */
export const TextBlockPayload = z.strictObject({
  title: Text.nullable(),
  /** One paragraph per line, in reading order. */
  text: z.string(),
});

/** Rows of cells, every row as long as the first: a table, not a list of lists. */
const rectangular = (table: { rows: unknown[][] }) =>
  table.rows.every((row) => row.length === table.rows[0]?.length);
const RECTANGULAR = { message: "every row must have the same number of cells" };

/** Tables have one heading row or none; heading cells are never blanked. */
const HeaderRows = z.union([z.literal(0), z.literal(1)]);

/**
 * A table's cells as text, row by row. A merged cell's text is in its first cell and the cells it
 * covers are empty, so every row has the same number of cells. A cell's position is the `row` and
 * `col` an answer key refers to, so the cells never move once written.
 */
export const TablePayload = z
  .strictObject({
    rows: z.array(z.array(z.string()).min(2)).min(2),
    header_rows: HeaderRows,
  })
  .refine(rectangular, RECTANGULAR);

export const AssetPayloads = {
  text_block: TextBlockPayload,
  labeled_diagram: LabeledDiagramPayload,
  table: TablePayload,
} as const satisfies Record<AssetKind, z.ZodType>;

const Tier = z.union([z.literal(1), z.literal(2)]);

/** One asset as the worker hands it to `complete_extract`; owner and document come from the job. */
export const ExtractedAsset = z.discriminatedUnion("kind", [
  z.strictObject({
    id: Id,
    page: PageNumber,
    kind: z.literal("text_block"),
    tier: Tier,
    payload: TextBlockPayload,
    image_path: z.null(),
  }),
  z.strictObject({
    id: Id,
    page: PageNumber,
    kind: z.literal("labeled_diagram"),
    tier: Tier,
    payload: LabeledDiagramPayload,
    /** The unblanked crop in `renders` that the payload's boxes are fractions of. */
    image_path: ObjectKey,
  }),
  z.strictObject({
    id: Id,
    page: PageNumber,
    kind: z.literal("table"),
    /** Read from the file's own structure: a table is never OCR'd. */
    tier: z.literal(1),
    payload: TablePayload,
    image_path: z.null(),
  }),
]);

export const CompleteExtractArgs = z.strictObject({
  msg_id: z.int(),
  page_count: z.int().min(0),
  assets: z.array(ExtractedAsset),
});

// Queue messages, built by the job functions and read by the worker.

/** Built by `enqueue_extract`. */
export const ExtractMessage = z.strictObject({
  document_id: Id,
  user_id: Id,
  /** In `uploads`. */
  storage_path: ObjectKey,
});

/** One gap to draw: its marker number and the box of the label it covers. */
export const BlankBox = z
  .strictObject({ number: z.int().positive(), ...boxShape })
  .refine(insideImage, INSIDE_IMAGE);

/**
 * Built by `create_question` from a diagram question's answer key and its asset, so it holds
 * exactly the blanks the key grades, at the boxes extraction found — and no label text.
 */
export const BlankMessage = z.strictObject({
  question_id: Id,
  document_id: Id,
  user_id: Id,
  asset_id: Id,
  /** The unblanked crop to draw on, in `renders`. Never modified: the blanked copy is new. */
  image_path: ObjectKey,
  blanks: z.array(BlankBox).min(1),
});

/** A row of `claim_next_job`. */
export const ClaimedJob = z.discriminatedUnion("queue_name", [
  z.strictObject({
    queue_name: z.literal("extract"),
    msg_id: z.int(),
    read_ct: z.int().positive(),
    message: ExtractMessage,
  }),
  z.strictObject({
    queue_name: z.literal("blank"),
    msg_id: z.int(),
    read_ct: z.int().positive(),
    message: BlankMessage,
  }),
]);

export const CompleteBlankArgs = z.strictObject({
  msg_id: z.int(),
  /** The blanked image the worker stored, in `renders`. */
  image_path: ObjectKey,
});

// Questions: the public payload (`questions.payload`, readable by its owner) and the answer key
// (`question_keys.answer_key`, readable by the service role only).

/** Shown with the blanked image: one answer box per marker number, in this order. */
export const DiagramBlankPayload = z.strictObject({
  prompt: Text,
  numbers: z.array(z.int().positive()).min(1),
});

/** Options are stored already shuffled; the key holds the correct one's index. */
export const McqPayload = z.strictObject({
  prompt: Text,
  options: z.array(Text).min(2).max(6),
});

/** The gap a student fills in, written as four underscores. */
export const GAP = "____";

export const ShortAnswerPayload = z.strictObject({
  prompt: Text.refine((prompt) => prompt.split(GAP).length === 2, {
    message: `the prompt needs exactly one ${GAP} gap`,
  }),
});

/** Self-rated, so the back is not an answer key and may reach the browser. */
export const FlashcardPayload = z.strictObject({ front: Text, back: Text });

/** A cell the student fills in: its number, never its text. */
const BlankCell = z.strictObject({ blank: z.int().positive() });

/**
 * The extracted table with each blanked cell replaced by its number. `create_question` checks it
 * is exactly that, so no cell the key grades reaches the browser.
 */
export const TableBlankPayload = z
  .strictObject({
    prompt: Text,
    header_rows: HeaderRows,
    rows: z.array(z.array(z.union([z.string(), BlankCell])).min(2)).min(2),
  })
  .refine(rectangular, RECTANGULAR);

/** A question answered in writing and marked by Claude against the key's rubric. */
export const EssayPayload = z.strictObject({ prompt: Text });

export const QuestionPayloads = {
  diagram_blank: DiagramBlankPayload,
  mcq: McqPayload,
  short_answer: ShortAnswerPayload,
  flashcard: FlashcardPayload,
  table_blank: TableBlankPayload,
  essay: EssayPayload,
} as const satisfies Record<QuestionType, z.ZodType>;

/** The answer, other answers to accept, and near-misses to mark wrong (CLAUDE.md, Grading). */
const answerShape = {
  answer: Text,
  synonyms: z.array(Text),
  confusables: z.array(Text),
};

export const DiagramBlankKey = z
  .strictObject({
    blanks: z
      .array(
        z.strictObject({
          number: z.int().positive(),
          /** Index into the asset's `payload.labels`: the box comes from extraction, never the model. */
          label_index: z.int().min(0),
          ...answerShape,
        }),
      )
      .min(1),
  })
  .superRefine((key, ctx) => {
    const numbers = key.blanks.map((blank) => blank.number);
    if (new Set(numbers).size !== numbers.length) {
      ctx.addIssue({ code: "custom", message: "blank numbers must be unique", path: ["blanks"] });
    }
    const labels = key.blanks.map((blank) => blank.label_index);
    if (new Set(labels).size !== labels.length) {
      ctx.addIssue({ code: "custom", message: "a label can be blanked once", path: ["blanks"] });
    }
  });

/** Graded like a diagram's blanks, cell by cell. */
export const TableBlankKey = z
  .strictObject({
    blanks: z
      .array(
        z.strictObject({
          number: z.int().positive(),
          /** The cell's position in the asset's `payload.rows`, counting the heading row. */
          row: z.int().min(0),
          col: z.int().min(0),
          ...answerShape,
        }),
      )
      .min(1),
  })
  .superRefine((key, ctx) => {
    const numbers = key.blanks.map((blank) => blank.number);
    if (new Set(numbers).size !== numbers.length) {
      ctx.addIssue({ code: "custom", message: "blank numbers must be unique", path: ["blanks"] });
    }
    const cells = key.blanks.map((blank) => `${blank.row}:${blank.col}`);
    if (new Set(cells).size !== cells.length) {
      ctx.addIssue({ code: "custom", message: "a cell can be blanked once", path: ["blanks"] });
    }
  });

export const McqKey = z.strictObject({ answer_index: z.int().min(0) });

export const ShortAnswerKey = z.strictObject(answerShape);

/** What a written answer is marked against: points per criterion, and an answer that earns them all. */
export const EssayKey = z.strictObject({
  rubric: z.array(z.strictObject({ criterion: Text, points: z.int().min(1).max(5) })).min(2).max(5),
  model_answer: Text,
});

/** Flashcards are self-rated and have no key. */
export const AnswerKeys = {
  diagram_blank: DiagramBlankKey,
  mcq: McqKey,
  short_answer: ShortAnswerKey,
  table_blank: TableBlankKey,
  essay: EssayKey,
} as const satisfies Record<Exclude<QuestionType, "flashcard">, z.ZodType>;

const questionArgs = {
  document_id: Id,
  title: Text,
  /** The slide the question is about; must be its asset's page when it has one. */
  source_page: PageNumber,
  model_used: Text.optional(),
};

/** What generation passes to `create_question`; `source_ref` is derived there. */
export const CreateQuestionArgs = z
  .discriminatedUnion("type", [
    z.strictObject({
      ...questionArgs,
      type: z.literal("diagram_blank"),
      asset_id: Id,
      payload: DiagramBlankPayload,
      answer_key: DiagramBlankKey,
    }),
    z.strictObject({
      ...questionArgs,
      type: z.literal("mcq"),
      asset_id: Id.optional(),
      payload: McqPayload,
      answer_key: McqKey,
    }),
    z.strictObject({
      ...questionArgs,
      type: z.literal("short_answer"),
      asset_id: Id.optional(),
      payload: ShortAnswerPayload,
      answer_key: ShortAnswerKey,
    }),
    z.strictObject({
      ...questionArgs,
      type: z.literal("flashcard"),
      asset_id: Id.optional(),
      payload: FlashcardPayload,
    }),
    z.strictObject({
      ...questionArgs,
      type: z.literal("table_blank"),
      asset_id: Id,
      payload: TableBlankPayload,
      answer_key: TableBlankKey,
    }),
    // Written from several pages of the deck, so no one asset is its own.
    z.strictObject({
      ...questionArgs,
      type: z.literal("essay"),
      payload: EssayPayload,
      answer_key: EssayKey,
    }),
  ])
  .superRefine((question, ctx) => {
    if (question.type === "diagram_blank") {
      const keyNumbers = question.answer_key.blanks.map((blank) => blank.number);
      if (keyNumbers.join() !== question.payload.numbers.join()) {
        ctx.addIssue({
          code: "custom",
          message: "payload.numbers must list the key's blank numbers, in order",
          path: ["payload", "numbers"],
        });
      }
    }
    if (question.type === "table_blank") {
      // The cells the payload hides are exactly the key's, each under its own number.
      const hidden = question.payload.rows.flatMap((row, r) =>
        row.flatMap((cell, c) => (typeof cell === "string" ? [] : [`${r}:${c}:${cell.blank}`])),
      );
      const keyed = question.answer_key.blanks.map((blank) => `${blank.row}:${blank.col}:${blank.number}`);
      if (hidden.sort().join() !== keyed.sort().join()) {
        ctx.addIssue({
          code: "custom",
          message: "payload.rows must blank exactly the key's cells, under their numbers",
          path: ["payload", "rows"],
        });
      }
    }
    if (question.type === "mcq" && question.answer_key.answer_index >= question.payload.options.length) {
      ctx.addIssue({
        code: "custom",
        message: "answer_index must point at an option",
        path: ["answer_key", "answer_index"],
      });
    }
  });

export type CreateQuestionArgs = z.infer<typeof CreateQuestionArgs>;

// The ingest callback: the worker POSTs this after `complete_extract` succeeds, with
// `Authorization: Bearer <INGEST_CALLBACK_SECRET>`. Any 2xx response means accepted.

export const INGEST_CALLBACK_PATH = "/api/ingest/callback";

export const IngestCallbackBody = z.strictObject({ document_id: Id });

// Storage. Both buckets are private: browsers upload through a signed upload URL and see
// images only through short-lived signed URLs. The worker builds the `renders` keys it writes;
// web reads asset and question images from their rows' `image_path`.

export const UPLOADS_BUCKET = "uploads";
export const RENDERS_BUCKET = "renders";

export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const PDF_MIME = "application/pdf";
/** The `uploads` bucket's own limit: checking it first gives a legible error instead of Storage's. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * What students can upload. The `uploads` bucket accepts only these MIME types, and an upload's
 * object key ends in its extension, which is how the worker knows what it is reading.
 */
export const UPLOAD_TYPES = [
  { extension: "pptx", mime: PPTX_MIME },
  { extension: "pdf", mime: PDF_MIME },
] as const;
export type UploadType = (typeof UPLOAD_TYPES)[number];

export type PageName = "slide" | "page";

/** What a document's pages are called where a question cites one, as `create_question` names them. */
export function pageName(mime: string): PageName {
  return mime === PPTX_MIME ? "slide" : "page";
}

export const objectKeys = {
  /** The uploaded file, in `uploads`, named for its type: `{user}/{document}.pptx` or `.pdf`. */
  upload: (userId: string, documentId: string, mime: string) => {
    const type = UPLOAD_TYPES.find((candidate) => candidate.mime === mime);
    if (!type) throw new Error(`${mime} is not a type students can upload`);
    return `${Id.parse(userId)}/${Id.parse(documentId)}.${type.extension}`;
  },

  /** A page's full render in `renders`: the source slide every question links back to. */
  pageRender: (userId: string, documentId: string, page: number) =>
    `${Id.parse(userId)}/${Id.parse(documentId)}/pages/${String(PageNumber.parse(page)).padStart(3, "0")}.png`,

  /**
   * The folders in `renders` holding a document's files, as the worker writes them
   * (ingest/app/contracts.py): page renders, diagram crops and blanked question images.
   */
  renderFolders: (userId: string, documentId: string) =>
    ["pages", "assets", "questions"].map((folder) => `${Id.parse(userId)}/${Id.parse(documentId)}/${folder}`),
};

/** `usage_counters.period_start` for a moment: the first day of its UTC month, as SQL counts it. */
export function usagePeriodStart(at: Date): string {
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  return `${at.getUTCFullYear()}-${month}-01`;
}
