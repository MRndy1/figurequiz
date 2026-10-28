import "server-only";

import type { z } from "zod";

import {
  AssetPayloads,
  pageName,
  type CreateQuestionArgs,
  type LabeledDiagramPayload,
  type PageName,
  type TablePayload,
  type TextBlockPayload,
} from "@/lib/contracts";
import { dailyBudgetUsd } from "@/lib/env";
import { spentTodayUsd } from "@/lib/llm/budget";
import {
  callStructured,
  type CallFailure,
  type CallStructured,
  type Picture,
  type StructuredResult,
} from "@/lib/llm/call";
import { ROUTES, type RouteName } from "@/lib/llm/routes";
import { DIAGRAM_LABELS_SYSTEM, diagramLabelsInput } from "@/lib/prompts/diagram-labels";
import { ESSAY_QUESTIONS_SYSTEM, essayQuestionsInput } from "@/lib/prompts/essay-questions";
import { IMAGE_CHECK_SYSTEM, imageCheckInput } from "@/lib/prompts/image-check";
import { TABLE_CELLS_SYSTEM, tableCellsInput } from "@/lib/prompts/table-cells";
import { TEXT_QUESTIONS_SYSTEM, textQuestionsInput } from "@/lib/prompts/text-questions";
import {
  DiagramLabelsOutput,
  EssayQuestionsOutput,
  ImageCheckOutput,
  TableCellsOutput,
  TextQuestionsOutput,
} from "@/lib/schemas/generation";
import { createAdminClient } from "@/lib/supabase/admin";

import { diagramQuestion, essayQuestions, tableQuestion, textQuestions } from "./validate";

/**
 * Question generation for one document: run by the ingest callback once it has claimed the
 * document (`extracted` → `generating`) and responded (build plan, D-5).
 *
 * Diagrams go first, then tables: they are the hero feature, and their slower Sonnet calls should
 * not queue behind text slides. Haiku looks at each diagram's picture before Sonnet judges its
 * labels, so screenshots, charts and photos cost a glance, not a judgement. Each run is paid for
 * in credits (docs/credits-plan.md): it holds one per page that could get questions, plans only
 * the pages the balance covers, and gives back what the pages that got nothing didn't use.
 *
 * Calls run four at a time under per-document caps and the daily budget, each route's first call
 * alone so the rest read its cached prompt, and none starts within 45 s of the deadline, so there
 * is always time left to record how the run ended. Assets that already have questions are
 * skipped, so running again for the same document only fills in what an interrupted or failed
 * run left out.
 */

/** How long generation may run, from when it was started, before it stops starting calls. */
export const GENERATION_MS = 240_000;

export const LIMITS = {
  diagrams: 8,
  tables: 6,
  textSlides: 15,
  questions: 60,
  concurrentCalls: 4,
  /** No call starts this close to the deadline: one slow call must not outlive the function. */
  lastCallMs: 45_000,
};

/** Shown to students as is (`documents.error`), so each says what happened and what to do. */
export const FAILURES = {
  nothing: "This file has no slide text, labelled diagrams or tables to write questions from.",
  budget: "Question writing has paused for today. Try again tomorrow.",
  refused: "Questions couldn't be written about this file's content.",
  unavailable: "Writing questions failed. Try again in a few minutes.",
  none: "No questions could be written from this file. Slides with more text or labelled diagrams work best.",
  credits: "You're out of credits, so no questions were written yet. Finish this deck once you have more.",
};

type Db = ReturnType<typeof createAdminClient>;

type Asset = { id: string; page: number; tier: number } & (
  | { kind: "labeled_diagram"; payload: z.infer<typeof LabeledDiagramPayload>; imagePath: string | null }
  | { kind: "table"; payload: z.infer<typeof TablePayload> }
  | { kind: "text_block"; payload: z.infer<typeof TextBlockPayload> }
);
type DiagramAsset = Extract<Asset, { kind: "labeled_diagram" }>;
type TableAsset = Extract<Asset, { kind: "table" }>;
type TextAsset = Extract<Asset, { kind: "text_block" }>;

/** A claimed document and everything extraction found in it. */
export type Source = {
  documentId: string;
  userId: string;
  filename: string;
  /** What its pages are called: a deck's are slides. */
  pageName: PageName;
  /** In page order. */
  assets: Asset[];
  /** Assets an earlier run already wrote questions for. */
  covered: Set<string>;
  existingQuestions: number;
  /** Whether an earlier run already wrote the deck's essays. */
  hasEssays: boolean;
};

/** One model call for one asset. */
export type Job = {
  /** For logs, such as "slide 3 diagram". */
  name: string;
  /** The page it writes questions for: what its credit pays for. */
  page: number;
  /**
   * The route whose cached system prompt its main call reads. A route's first job runs before
   * the rest of that route start, so they read the cache it wrote instead of each writing it.
   */
  route?: RouteName;
  run(signal: AbortSignal): Promise<JobResult>;
};

/**
 * What jobs call out to: the model, the bucket a diagram's picture is read from, and the asset a
 * picture check's verdict is kept on.
 */
export type Deps = {
  call: CallStructured;
  loadPicture: (path: string) => Promise<Picture>;
  notePicture: (assetId: string, kind: ImageCheckOutput["kind"]) => Promise<void>;
};

const LIVE_DEPS: Deps = { call: callStructured, loadPicture: loadRender, notePicture: savePictureKind };

export type JobResult = {
  costUsd: number;
  failure?: CallFailure;
  questions: CreateQuestionArgs[];
  /** A job to run next, such as a diagram's label judgement once its picture passed the check. */
  next?: Job;
};

type SaveResult = "saved" | "skipped" | "document_gone";

export type Outcome = {
  /** Questions this run saved. */
  saved: number;
  calls: number;
  refusals: number;
  /** Calls that threw: the network, OpenRouter, or the deadline's abort. */
  errors: number;
  /** Why jobs were left unstarted, or why saving stopped; null when every job ran. */
  stoppedBy: "deadline" | "budget" | "questions" | "document_gone" | null;
};

/** Generates and saves the document's questions, then marks it `ready` or `failed`. Never throws. */
export async function runGeneration(documentId: string, deadline: number): Promise<void> {
  const db = createAdminClient();
  let holdId: string | null = null;
  try {
    const source = await loadSource(db, documentId);
    if (!source) return;

    let jobs = planJobs(source);
    const pages = pagesOf(jobs);
    let waiting = 0;
    if (pages.length > 0) {
      const hold = await holdCredits(db, documentId, pages.length);
      if (hold.held === 0) {
        console.info(`generation: document ${documentId}: out of credits for ${pages.length} pages`);
        return setStatus(db, documentId, {
          status: "failed",
          error: FAILURES.credits,
          pages_waiting: pages.length,
        });
      }
      holdId = hold.holdId;
      const covered = new Set(pages.slice(0, hold.held));
      jobs = jobs.filter((job) => covered.has(job.page));
      waiting = pages.length - covered.size;
      // The essays come from the pages the credits covered, and start before the text slides.
      const essays = essayJob(source, covered);
      const textStart = jobs.findIndex((job) => job.route === "text_questions");
      if (essays) jobs.splice(textStart === -1 ? jobs.length : textStart, 0, essays);
    }

    const outcome = await generate(jobs, {
      deadline,
      budgetUsd: dailyBudgetUsd() - (await spentTodayUsd(db)),
      save: (question) => saveQuestion(db, question),
    });
    const charged = holdId ? await releaseCredits(db, holdId) : 0;
    holdId = null;
    console.info(
      `generation: document ${documentId}: ${outcome.saved} questions from ${outcome.calls} calls` +
        ` (${outcome.refusals} refused, ${outcome.errors} failed), ${charged} credits` +
        (waiting ? `, ${waiting} pages waiting for credits` : "") +
        (outcome.stoppedBy ? `, stopped by ${outcome.stoppedBy}` : ""),
    );
    await finish(db, source, jobs.length, outcome, waiting);
  } catch (error) {
    console.error(`generation: document ${documentId} failed`, error);
    try {
      // Pages that got questions before the failure are paid for; the rest go back.
      if (holdId) await releaseCredits(db, holdId);
      await setStatus(db, documentId, { status: "failed", error: FAILURES.unavailable });
    } catch (statusError) {
      console.error(`generation: could not mark document ${documentId} failed`, statusError);
    }
  }
}

/** The pages jobs write questions for, in page order. */
export function pagesOf(jobs: Job[]): number[] {
  return [...new Set(jobs.map((job) => job.page))].sort((a, b) => a - b);
}

/**
 * The calls to make, diagrams first and then tables, within the per-document caps. A diagram
 * with a picture starts with the look at it, which hands on to its label judgement.
 */
export function planJobs(source: Source, deps: Deps = LIVE_DEPS): Job[] {
  const { call } = deps;
  const todo = source.assets.filter((asset) => !source.covered.has(asset.id));
  const slides = new Map(source.assets.filter(isText).map((asset) => [asset.page, asset.payload]));
  return [
    ...todo
      .filter(isDiagram)
      .slice(0, LIMITS.diagrams)
      .map((asset) => {
        const slide = slides.get(asset.page) ?? null;
        const labels = diagramJob(source, asset, slide, call);
        return asset.imagePath ? pictureJob(source, asset, asset.imagePath, slide, deps, labels) : labels;
      }),
    ...todo
      .filter(isTable)
      .slice(0, LIMITS.tables)
      .map((asset) => tableJob(source, asset, slides.get(asset.page) ?? null, call)),
    ...todo
      .filter(isText)
      .filter((asset) => asset.payload.text.trim() !== "")
      .slice(0, LIMITS.textSlides)
      .map((asset) => textJob(source, asset, call)),
  ];
}

/** Below this much text, a deck has nothing worth explaining at length. */
const ESSAY_MIN = { pages: 3, characters: 400 };

/**
 * One call for the whole deck's written-answer questions, from the text of `pages`. None for a
 * deck with too little text there, or one an earlier run already wrote essays for.
 */
export function essayJob(source: Source, pages: Set<number>, call: CallStructured = callStructured): Job | null {
  if (source.hasEssays) return null;
  const texts = source.assets
    .filter(isText)
    .filter((asset) => pages.has(asset.page) && asset.payload.text.trim() !== "");
  const characters = texts.reduce((sum, asset) => sum + asset.payload.text.trim().length, 0);
  if (texts.length < ESSAY_MIN.pages || characters < ESSAY_MIN.characters) return null;

  const route = "essay_questions";
  return {
    name: "deck essays",
    page: texts[0].page,
    route,
    async run(signal) {
      const result = await call({
        route,
        system: ESSAY_QUESTIONS_SYSTEM,
        content: essayQuestionsInput({
          filename: source.filename,
          pageName: source.pageName === "slide" ? "Slide" : "Page",
          pages: texts.map((asset) => ({ page: asset.page, ...asset.payload })),
        }),
        schema: EssayQuestionsOutput,
        userId: source.userId,
        documentId: source.documentId,
        signal,
      });
      if (!result.ok) return { costUsd: result.costUsd, failure: result.failure, questions: [] };
      const questions = essayQuestions(
        { documentId: source.documentId, pages: texts.map((asset) => asset.page), model: ROUTES[route].model },
        result.output,
      );
      return { costUsd: result.costUsd, questions };
    },
  };
}

/** Runs the jobs four at a time and saves what they return, until a limit says stop. */
export async function generate(
  jobs: Job[],
  options: {
    deadline: number;
    /**
     * What may still be spent today, in US dollars. Checked before each call starts, so calls
     * already in flight finish and a run can overshoot by up to three calls' cost.
     */
    budgetUsd: number;
    save: (question: CreateQuestionArgs) => Promise<SaveResult>;
    now?: () => number;
  },
): Promise<Outcome> {
  const now = options.now ?? Date.now;
  const outcome: Outcome = { saved: 0, calls: 0, refusals: 0, errors: 0, stoppedBy: null };
  const queue = [...jobs];
  let spentUsd = 0;
  const stop = (reason: NonNullable<Outcome["stoppedBy"]>) => {
    outcome.stoppedBy ??= reason;
  };

  async function runJob(job: Job) {
    if (outcome.stoppedBy) return;
    const remaining = options.deadline - now();
    if (remaining <= LIMITS.lastCallMs) return stop("deadline");
    if (spentUsd >= options.budgetUsd) return stop("budget");
    if (outcome.saved >= LIMITS.questions) return stop("questions");

    outcome.calls += 1;
    const signal = AbortSignal.timeout(remaining);
    let result: JobResult;
    try {
      result = await job.run(signal);
    } catch (error) {
      outcome.errors += 1;
      if (signal.aborted) stop("deadline");
      console.error(`generation: ${job.name} failed`, error);
      return;
    }
    spentUsd += result.costUsd;
    if (result.failure === "refusal") outcome.refusals += 1;
    // Ahead of the slides still waiting, as the job it follows was.
    if (result.next) queue.unshift(result.next);

    for (const question of result.questions) {
      if (outcome.stoppedBy === "document_gone") return;
      if (outcome.saved >= LIMITS.questions) return stop("questions");
      // Counted before the save is awaited, so lanes saving at once can't overshoot the cap.
      outcome.saved += 1;
      const saved = await options.save(question);
      if (saved !== "saved") outcome.saved -= 1;
      // Nothing more can be saved, so this outranks any earlier reason.
      if (saved === "document_gone") outcome.stoppedBy = "document_gone";
    }
  }

  // A system prompt is cached by the first call that sends it, from when that call is answered:
  // calls sent alongside it would each pay to write the same cache. So each route's first job
  // runs alone, and until it ends the lanes take the next job of a route that's ready.
  const started = new Set<RouteName>();
  const warming = new Map<RouteName, Promise<void>>();
  const lane = async () => {
    while (queue.length > 0) {
      const index = queue.findIndex((job) => !job.route || !warming.has(job.route));
      if (index === -1) {
        await Promise.race(warming.values());
        continue;
      }
      const [job] = queue.splice(index, 1);
      const { route } = job;
      if (!route || started.has(route)) {
        await runJob(job);
        continue;
      }
      started.add(route);
      const first = runJob(job).finally(() => warming.delete(route));
      warming.set(route, first.catch(() => undefined));
      await first;
    }
  };
  await Promise.all(Array.from({ length: Math.min(LIMITS.concurrentCalls, jobs.length) }, lane));
  return outcome;
}

function diagramJob(
  source: Source,
  asset: DiagramAsset,
  slide: TextAsset["payload"] | null,
  call: CallStructured,
): Job {
  const route = "diagram_labels";
  return {
    name: `slide ${asset.page} diagram`,
    page: asset.page,
    route,
    async run(signal) {
      const result = await call({
        route,
        system: DIAGRAM_LABELS_SYSTEM,
        content: diagramLabelsInput({
          source: sourceRef(source, asset.page),
          slideTitle: slide?.title ?? null,
          slideText: slide?.text ?? "",
          tier: asset.tier,
          labels: asset.payload.labels,
        }),
        schema: DiagramLabelsOutput,
        userId: source.userId,
        documentId: source.documentId,
        signal,
      });
      if (!result.ok) return { costUsd: result.costUsd, failure: result.failure, questions: [] };
      const question = diagramQuestion(
        {
          documentId: source.documentId,
          assetId: asset.id,
          page: asset.page,
          slideTitle: slide?.title ?? null,
          labels: asset.payload.labels,
          model: ROUTES[route].model,
        },
        result.output,
      );
      return { costUsd: result.costUsd, questions: question ? [question] : [] };
    },
  };
}

/**
 * Haiku's look at a diagram's picture before Sonnet judges its labels: a labelled diagram goes on
 * to `labels`, and a screenshot, chart or photo stops here, for the price of the look. When the
 * check can't be made (a failed download or call, an unusable reply) the diagram goes on too: the
 * label judgement's own screenshot rule is the backstop.
 */
function pictureJob(
  source: Source,
  asset: DiagramAsset,
  imagePath: string,
  slide: TextAsset["payload"] | null,
  deps: Deps,
  labels: Job,
): Job {
  const route = "image_check";
  return {
    name: `slide ${asset.page} picture`,
    page: asset.page,
    route,
    async run(signal) {
      let result: StructuredResult<ImageCheckOutput>;
      try {
        result = await deps.call({
          route,
          system: IMAGE_CHECK_SYSTEM,
          content: imageCheckInput({
            source: sourceRef(source, asset.page),
            slideTitle: slide?.title ?? null,
            tier: asset.tier,
            labels: asset.payload.labels,
          }),
          image: await deps.loadPicture(imagePath),
          schema: ImageCheckOutput,
          userId: source.userId,
          documentId: source.documentId,
          signal,
        });
      } catch (error) {
        // Out of time is the run's to handle; anything else only costs the check.
        if (signal.aborted) throw error;
        console.warn(`generation: couldn't look at the picture on ${source.pageName} ${asset.page}`, error);
        return { costUsd: 0, questions: [], next: labels };
      }
      if (result.ok) {
        // Kept so the deck page can say which pictures were skipped, and why.
        await deps.notePicture(asset.id, result.output.kind).catch((error: unknown) => {
          console.error(`generation: couldn't note the picture on ${source.pageName} ${asset.page}`, error);
        });
      }
      if (result.ok && result.output.kind !== "labelled_diagram") {
        console.info(`generation: ${labels.name} skipped, a ${result.output.kind}: ${result.output.reason}`);
        return { costUsd: result.costUsd, questions: [] };
      }
      return { costUsd: result.costUsd, questions: [], next: labels };
    },
  };
}

function tableJob(
  source: Source,
  asset: TableAsset,
  slide: TextAsset["payload"] | null,
  call: CallStructured,
): Job {
  const route = "table_cells";
  return {
    name: `slide ${asset.page} table`,
    page: asset.page,
    route,
    async run(signal) {
      const result = await call({
        route,
        system: TABLE_CELLS_SYSTEM,
        content: tableCellsInput({
          source: sourceRef(source, asset.page),
          slideTitle: slide?.title ?? null,
          slideText: slide?.text ?? "",
          rows: asset.payload.rows,
          headerRows: asset.payload.header_rows,
        }),
        schema: TableCellsOutput,
        userId: source.userId,
        documentId: source.documentId,
        signal,
      });
      if (!result.ok) return { costUsd: result.costUsd, failure: result.failure, questions: [] };
      const question = tableQuestion(
        {
          documentId: source.documentId,
          assetId: asset.id,
          page: asset.page,
          slideTitle: slide?.title ?? null,
          rows: asset.payload.rows,
          headerRows: asset.payload.header_rows,
          model: ROUTES[route].model,
        },
        result.output,
      );
      return { costUsd: result.costUsd, questions: question ? [question] : [] };
    },
  };
}

function textJob(source: Source, asset: TextAsset, call: CallStructured): Job {
  const route = "text_questions";
  return {
    name: `slide ${asset.page} text`,
    page: asset.page,
    route,
    async run(signal) {
      const result = await call({
        route,
        system: TEXT_QUESTIONS_SYSTEM,
        content: textQuestionsInput({
          source: sourceRef(source, asset.page),
          title: asset.payload.title,
          text: asset.payload.text,
        }),
        schema: TextQuestionsOutput,
        userId: source.userId,
        documentId: source.documentId,
        signal,
      });
      if (!result.ok) return { costUsd: result.costUsd, failure: result.failure, questions: [] };
      const questions = textQuestions(
        {
          documentId: source.documentId,
          assetId: asset.id,
          page: asset.page,
          title: asset.payload.title,
          text: asset.payload.text,
          pageName: source.pageName,
          model: ROUTES[route].model,
        },
        result.output,
      );
      return { costUsd: result.costUsd, questions };
    },
  };
}

/** As `create_question` will cite it: "lecture-04.pptx, slide 14", "notes.pdf, page 3". */
function sourceRef(source: Source, page: number): string {
  return `${source.filename}, ${source.pageName} ${page}`;
}

function isDiagram(asset: Asset): asset is DiagramAsset {
  return asset.kind === "labeled_diagram";
}

function isTable(asset: Asset): asset is TableAsset {
  return asset.kind === "table";
}

function isText(asset: Asset): asset is TextAsset {
  return asset.kind === "text_block";
}

/** The document if this run claimed it; null if it is gone or no longer `generating`. */
async function loadSource(db: Db, documentId: string): Promise<Source | null> {
  const { data: document, error } = await db
    .from("documents")
    .select("id, user_id, filename, mime, status")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error(`could not read document ${documentId}: ${error.message}`);
  if (document?.status !== "generating") return null;

  const [assets, questions] = await Promise.all([
    db
      .from("assets")
      .select("id, page, kind, tier, payload, image_path")
      .eq("document_id", documentId)
      .order("page")
      .order("id"),
    db.from("questions").select("asset_id, type").eq("document_id", documentId),
  ]);
  if (assets.error) throw new Error(`could not read assets of ${documentId}: ${assets.error.message}`);
  if (questions.error) {
    throw new Error(`could not read questions of ${documentId}: ${questions.error.message}`);
  }

  return {
    documentId,
    userId: document.user_id,
    filename: document.filename,
    pageName: pageName(document.mime),
    assets: assets.data.flatMap((row): Asset[] => {
      const base = { id: row.id, page: row.page, tier: row.tier };
      if (row.kind === "labeled_diagram") {
        const payload = AssetPayloads.labeled_diagram.safeParse(row.payload);
        if (payload.success) {
          return [{ ...base, kind: row.kind, payload: payload.data, imagePath: row.image_path }];
        }
      } else if (row.kind === "table") {
        const payload = AssetPayloads.table.safeParse(row.payload);
        if (payload.success) return [{ ...base, kind: row.kind, payload: payload.data }];
      } else {
        const payload = AssetPayloads.text_block.safeParse(row.payload);
        if (payload.success) return [{ ...base, kind: row.kind, payload: payload.data }];
      }
      console.warn(`generation: asset ${row.id} has a payload the contract refuses; skipped`);
      return [];
    }),
    covered: new Set(questions.data.flatMap((question) => question.asset_id ?? [])),
    existingQuestions: questions.data.length,
    hasEssays: questions.data.some((question) => question.type === "essay"),
  };
}

/** A diagram's picture: the crop extraction stored in `renders`, always a PNG. */
async function loadRender(path: string): Promise<Picture> {
  const { data, error } = await createAdminClient().storage.from("renders").download(path);
  if (error) throw new Error(`could not download ${path}: ${error.message}`);
  return { mediaType: "image/png", data: Buffer.from(await data.arrayBuffer()).toString("base64") };
}

/** Keeps what the picture check made of a diagram candidate on its asset. */
async function savePictureKind(assetId: string, kind: ImageCheckOutput["kind"]): Promise<void> {
  const { error } = await createAdminClient().from("assets").update({ picture_kind: kind }).eq("id", assetId);
  if (error) throw new Error(`could not note the picture kind of ${assetId}: ${error.message}`);
}

/** Holds a credit for each of up to `pages` pages; fewer, or none, when the balance runs short. */
async function holdCredits(
  db: Db,
  documentId: string,
  pages: number,
): Promise<{ holdId: string | null; held: number }> {
  const { data, error } = await db.rpc("hold_credits", { document_id: documentId, pages });
  if (error) throw new Error(`could not hold credits for ${documentId}: ${error.message}`);
  const [hold] = data;
  return { holdId: hold?.hold_id ?? null, held: hold?.held ?? 0 };
}

/** Keeps a credit for each page that got questions, gives the rest back, and returns those kept. */
async function releaseCredits(db: Db, holdId: string): Promise<number> {
  const { data, error } = await db.rpc("release_credits", { hold_id: holdId });
  if (error) throw new Error(`could not release hold ${holdId}: ${error.message}`);
  return data;
}

async function saveQuestion(db: Db, question: CreateQuestionArgs): Promise<SaveResult> {
  const { error } = await db.rpc("create_question", question);
  if (!error) return "saved";
  // create_question raises P0002 when the document, and so its assets, no longer exist.
  if (error.code === "P0002") return "document_gone";
  console.error(`generation: create_question refused a ${question.type} question: ${error.message}`);
  return "skipped";
}

/**
 * Ends the run as `ready` or `failed`. `waiting` counts the pages the credits didn't cover:
 * "Finish this deck" writes them later.
 */
async function finish(
  db: Db,
  source: Source,
  planned: number,
  outcome: Outcome,
  waiting: number,
): Promise<void> {
  if (outcome.stoppedBy === "document_gone") return;
  if (source.existingQuestions + outcome.saved > 0) {
    return setStatus(db, source.documentId, { status: "ready", error: null, pages_waiting: waiting });
  }
  let reason = FAILURES.none;
  if (planned === 0) reason = FAILURES.nothing;
  else if (outcome.calls === 0 && outcome.stoppedBy === "budget") reason = FAILURES.budget;
  else if (outcome.errors > 0 || outcome.stoppedBy === "deadline") reason = FAILURES.unavailable;
  else if (outcome.calls > 0 && outcome.refusals === outcome.calls) reason = FAILURES.refused;
  return setStatus(db, source.documentId, { status: "failed", error: reason, pages_waiting: waiting });
}

/** Ends the run's claim. Only a `generating` document moves, so a stale run can't overwrite. */
async function setStatus(
  db: Db,
  documentId: string,
  update: { status: "ready" | "failed"; error: string | null; pages_waiting?: number },
): Promise<void> {
  const { error } = await db
    .from("documents")
    .update(update)
    .eq("id", documentId)
    .eq("status", "generating");
  if (error) throw new Error(`could not mark document ${documentId} ${update.status}: ${error.message}`);
}
