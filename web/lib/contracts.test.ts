import { readFileSync } from "node:fs";

import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import {
  AnswerKeys,
  AssetPayloads,
  BlankMessage,
  ClaimedJob,
  CompleteBlankArgs,
  CompleteExtractArgs,
  CreateQuestionArgs,
  DiagramBlankKey,
  DiagramLabel,
  INGEST_CALLBACK_PATH,
  IngestCallbackBody,
  McqPayload,
  PDF_MIME,
  PPTX_MIME,
  QuestionPayloads,
  QuestionType,
  RENDERS_BUCKET,
  ShortAnswerPayload,
  UPLOADS_BUCKET,
  objectKeys,
  pageName,
  usagePeriodStart,
} from "@/lib/contracts";
import { Constants, type Database } from "@/lib/supabase/database.types";

/** contracts/examples.json, which the worker's tests parse too. */
const Examples = z.object({
  enums: z.record(z.string(), z.array(z.string())),
  storage_paths: z.object({
    user_id: z.string(),
    document_id: z.string(),
    asset_id: z.string(),
    question_id: z.string(),
    page: z.number(),
    upload: z.object({ bucket: z.string(), key: z.string() }),
    pdf_upload: z.object({ bucket: z.string(), key: z.string() }),
    page_render: z.object({ bucket: z.string(), key: z.string() }),
    asset_image: z.object({ bucket: z.string(), key: z.string() }),
    question_image: z.object({ bucket: z.string(), key: z.string() }),
  }),
  claimed_jobs: z.array(z.unknown()),
  complete_extract: z.unknown(),
  complete_blank: z.unknown(),
  ingest_callback: z.object({ method: z.string(), path: z.string(), body: z.unknown() }),
  create_question: z.array(z.unknown()),
});

const examples = Examples.parse(
  JSON.parse(readFileSync(new URL("../../contracts/examples.json", import.meta.url), "utf8")),
);

const jobs = examples.claimed_jobs.map((job) => ClaimedJob.parse(job));
const extract = CompleteExtractArgs.parse(examples.complete_extract);
const questions = examples.create_question.map((question) => CreateQuestionArgs.parse(question));

function blankJob() {
  const job = jobs.find((candidate) => candidate.queue_name === "blank");
  if (job?.queue_name !== "blank") throw new Error("examples need a blank job");
  return job;
}

function question<T extends CreateQuestionArgs["type"]>(type: T) {
  const found = questions.find((candidate) => candidate.type === type);
  if (found?.type !== type) throw new Error(`examples need a ${type} question`);
  return found as Extract<CreateQuestionArgs, { type: T }>;
}

type Functions = Database["public"]["Functions"];

describe("contracts/examples.json", () => {
  it("lists the database's enum values", () => {
    expect(examples.enums).toEqual({
      document_status: [...Constants.public.Enums.document_status],
      question_status: [...Constants.public.Enums.question_status],
      question_type: [...Constants.public.Enums.question_type],
      asset_kind: [...Constants.public.Enums.asset_kind],
    });
  });

  it("has a claimed job for each queue", () => {
    expect(jobs.map((job) => job.queue_name).sort()).toEqual(["blank", "extract"]);
  });

  it("has an extracted asset of every kind, each payload valid for its kind", () => {
    expect(extract.assets.map((asset) => asset.kind).sort()).toEqual(
      [...Constants.public.Enums.asset_kind].sort(),
    );
    for (const asset of extract.assets) {
      expect(() => AssetPayloads[asset.kind].parse(asset.payload)).not.toThrow();
    }
  });

  it("has a question of every type, each with the key its type needs", () => {
    expect(questions.map((question) => question.type)).toEqual(QuestionType.options);
    for (const question of questions) {
      expect(() => QuestionPayloads[question.type].parse(question.payload)).not.toThrow();
      if (question.type !== "flashcard") {
        expect(() => AnswerKeys[question.type].parse(question.answer_key)).not.toThrow();
      }
    }
  });

  it("has a blank job that draws the diagram key's blanks at the asset's boxes", () => {
    const diagram = question("diagram_blank");
    const { message } = blankJob();
    const asset = extract.assets.find((candidate) => candidate.id === diagram.asset_id);
    if (asset?.kind !== "labeled_diagram") throw new Error("the diagram's asset must be a diagram");

    // What create_question builds in SQL.
    const expected = diagram.answer_key.blanks.map((blank) => {
      const { x, y, w, h } = asset.payload.labels[blank.label_index];
      return { number: blank.number, x, y, w, h };
    });
    expect(message.blanks).toEqual(expected);
    expect(message.question_id).toBe(examples.storage_paths.question_id);
    expect(message.asset_id).toBe(asset.id);
    expect(message.image_path).toBe(asset.image_path);
    expect(CompleteBlankArgs.parse(examples.complete_blank).image_path).toBe(
      examples.storage_paths.question_image.key,
    );
  });

  it("names object keys the way both services build them", () => {
    const paths = examples.storage_paths;
    const prefix = `${paths.user_id}/${paths.document_id}`;

    // An upload's extension is its type, which is how the worker knows what it is reading.
    expect(paths.upload).toEqual({
      bucket: UPLOADS_BUCKET,
      key: objectKeys.upload(paths.user_id, paths.document_id, PPTX_MIME),
    });
    expect(paths.pdf_upload).toEqual({
      bucket: UPLOADS_BUCKET,
      key: objectKeys.upload(paths.user_id, paths.document_id, PDF_MIME),
    });
    expect(paths.page_render).toEqual({
      bucket: RENDERS_BUCKET,
      key: objectKeys.pageRender(paths.user_id, paths.document_id, paths.page),
    });
    // Built by the worker only; listed so its tests check the same keys.
    expect(paths.asset_image).toEqual({
      bucket: RENDERS_BUCKET,
      key: `${prefix}/assets/${paths.asset_id}.png`,
    });
    expect(paths.question_image).toEqual({
      bucket: RENDERS_BUCKET,
      key: `${prefix}/questions/${paths.question_id}.png`,
    });
  });

  it("has an ingest callback the web route accepts", () => {
    expect(examples.ingest_callback.method).toBe("POST");
    expect(examples.ingest_callback.path).toBe(INGEST_CALLBACK_PATH);
    expect(() => IngestCallbackBody.parse(examples.ingest_callback.body)).not.toThrow();
  });
});

describe("contract rules", () => {
  it("refuses an answer field in a public payload", () => {
    expect(
      McqPayload.safeParse({ prompt: "Which lobe?", options: ["Frontal", "Parietal"], answer_index: 0 })
        .success,
    ).toBe(false);
  });

  it("refuses a flashcard with an answer key", () => {
    expect(CreateQuestionArgs.safeParse({ ...question("flashcard"), answer_key: {} }).success).toBe(false);
  });

  it("refuses a diagram key that numbers two blanks alike or blanks one label twice", () => {
    const blank = { answer: "Frontal lobe", synonyms: [], confusables: [] };
    expect(
      DiagramBlankKey.safeParse({
        blanks: [
          { ...blank, number: 1, label_index: 0 },
          { ...blank, number: 1, label_index: 1 },
        ],
      }).success,
    ).toBe(false);
    expect(
      DiagramBlankKey.safeParse({
        blanks: [
          { ...blank, number: 1, label_index: 0 },
          { ...blank, number: 2, label_index: 0 },
        ],
      }).success,
    ).toBe(false);
  });

  it("refuses diagram numbers that don't match the key's", () => {
    const shown = { ...question("diagram_blank"), payload: { prompt: "Name them.", numbers: [1, 2, 3] } };
    expect(CreateQuestionArgs.safeParse(shown).success).toBe(false);
  });

  it("refuses an MCQ key that points past the options", () => {
    const mcq = { ...question("mcq"), answer_key: { answer_index: 4 } };
    expect(CreateQuestionArgs.safeParse(mcq).success).toBe(false);
  });

  it("needs exactly one gap in a fill-in-the-blank prompt", () => {
    expect(ShortAnswerPayload.safeParse({ prompt: "The brain has four lobes." }).success).toBe(false);
    expect(ShortAnswerPayload.safeParse({ prompt: "The ____ and the ____." }).success).toBe(false);
  });

  it("refuses a box that runs off the image", () => {
    expect(DiagramLabel.safeParse({ text: "Pons", x: 0.9, y: 0.5, w: 0.2, h: 0.05 }).success).toBe(false);
    expect(DiagramLabel.safeParse({ text: "Pons", x: 0.8, y: 0.5, w: 0.2001, h: 0.05 }).success).toBe(true);
  });

  it("refuses an object key that names its bucket", () => {
    const { message } = blankJob();
    expect(BlankMessage.safeParse({ ...message, image_path: `renders/${message.image_path}` }).success).toBe(
      false,
    );
  });

  it("refuses to build an object key from something that isn't an id or an upload type", () => {
    const { user_id, document_id } = examples.storage_paths;
    expect(() => objectKeys.upload("../other-user", document_id, PPTX_MIME)).toThrow();
    expect(() => objectKeys.upload(user_id, document_id, "text/html")).toThrow();
    expect(() =>
      objectKeys.pageRender(examples.storage_paths.user_id, examples.storage_paths.document_id, 0),
    ).toThrow();
  });

  it("calls a deck's pages slides, as create_question cites them", () => {
    expect(pageName(PPTX_MIME)).toBe("slide");
    expect(pageName(PDF_MIME)).toBe("page");
  });

  it("counts usage by UTC month", () => {
    expect(usagePeriodStart(new Date("2026-10-31T13:30:00Z"))).toBe("2026-10-01");
    // Already 1 November in Sydney, still October in UTC.
    expect(usagePeriodStart(new Date("2026-11-01T05:00:00+11:00"))).toBe("2026-10-01");
    expect(usagePeriodStart(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11-01");
  });
});

describe("contracts match the database functions", () => {
  it("passes create_question, complete_extract and complete_blank the arguments they take", () => {
    expectTypeOf<z.infer<typeof CreateQuestionArgs>>().toExtend<Functions["create_question"]["Args"]>();
    expectTypeOf<z.infer<typeof CompleteExtractArgs>>().toExtend<Functions["complete_extract"]["Args"]>();
    expectTypeOf<z.infer<typeof CompleteBlankArgs>>().toExtend<Functions["complete_blank"]["Args"]>();
  });

  it("reads claim_next_job's row", () => {
    type Row = Functions["claim_next_job"]["Returns"][number];
    expectTypeOf<z.infer<typeof ClaimedJob>>().toExtend<Row>();
  });
});
