import { describe, expect, it } from "vitest";

import type { CreateQuestionArgs } from "@/lib/contracts";
import type { RouteName } from "@/lib/llm/routes";

import {
  LIMITS,
  essayJob,
  generate,
  pagesOf,
  planJobs,
  type Deps,
  type Job,
  type JobResult,
  type Source,
} from "./run";

/*
 * The orchestration with a fake `callStructured`, a stand-in picture and a fake save: no model,
 * no database. The deck is the sample deck as extraction sees it; slide 3 has both its text and
 * its diagram.
 */

const USER_ID = "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f";
const DOCUMENT_ID = "0b7e3c1a-2d4f-4e6a-9b8c-7d6e5f4a3b2c";
const DIAGRAM_ID = "8a9b0c1d-2e3f-5a4b-9c5d-6e7f8a9b0c1d";
const TABLE_ID = "5c6d7e8f-9a0b-5c1d-8e2f-3a4b5c6d7e8f";

const assetId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const SLIDE_2_TEXT = [
  "•  Together with the spinal cord, forms the central nervous system (CNS)",
  "•  Contains blood vessels and nerves, including neurons and glial cells",
].join("\n");

const LOBES = ["Human Brain Anatomy", "Frontal lobe", "Parietal lobe", "Occipital lobe", "Cerebellum"];

function textAsset(id: string, page: number, title: string | null, text: string) {
  return { id, page, tier: 1, kind: "text_block" as const, payload: { title, text } };
}

function diagramAsset(id: string, page: number, labels: string[]) {
  return {
    id,
    page,
    tier: 2,
    kind: "labeled_diagram" as const,
    payload: {
      labels: labels.map((text, index) => ({ text, x: 0.1, y: 0.1 * index, w: 0.2, h: 0.04, confidence: 95 })),
      image_width: 995,
      image_height: 765,
    },
    imagePath: `${USER_ID}/${DOCUMENT_ID}/assets/${id}.png` as string | null,
  };
}

const LOBE_TABLE = [
  ["Lobe", "Location", "Main functions"],
  ["Frontal", "Front of the head", "Personality, decision-making, movement, speech (Broca's area)"],
  ["Parietal", "Middle of the brain", "Object identification, spatial relationships, pain and touch"],
  ["Temporal", "Sides of the brain", "Short-term memory, speech, musical rhythm, smell recognition"],
  ["Occipital", "Back of the brain", "Vision"],
];

function tableAsset(id: string, page: number, rows: string[][]) {
  return { id, page, tier: 1, kind: "table" as const, payload: { rows, header_rows: 1 as const } };
}

function deck(overrides: Partial<Source> = {}): Source {
  return {
    documentId: DOCUMENT_ID,
    userId: USER_ID,
    filename: "Brain_Anatomy_Sample.pptx",
    pageName: "slide",
    assets: [
      textAsset(assetId(1), 1, "Anatomy of the Brain", "Structure, lobes and main functions"),
      textAsset(assetId(2), 2, "What Is the Brain?", SLIDE_2_TEXT),
      textAsset(assetId(3), 3, "Lobes of the Brain", "Each hemisphere of the cerebrum is divided into four lobes."),
      diagramAsset(DIAGRAM_ID, 3, LOBES),
      textAsset(assetId(4), 4, "Lobe Functions", ""),
      tableAsset(TABLE_ID, 4, LOBE_TABLE),
    ],
    covered: new Set(),
    existingQuestions: 0,
    hasEssays: false,
    ...overrides,
  };
}

const DIAGRAM_REPLY = {
  title: "Lobes of the brain",
  blanks: [
    { label_index: 1, answer: "Frontal lobe", synonyms: ["frontal"], confusables: [] },
    { label_index: 2, answer: "Parietal lobe", synonyms: ["parietal"], confusables: [] },
    { label_index: 4, answer: "Cerebellum", synonyms: [], confusables: ["cerebrum"] },
  ],
};

const TABLE_REPLY = {
  title: "What each lobe does",
  blanks: [
    { row: 1, col: 1, answer: "Front of the head", synonyms: ["front of the brain"], confusables: [] },
    { row: 3, col: 0, answer: "Temporal", synonyms: ["temporal lobe"], confusables: [] },
    { row: 4, col: 2, answer: "Vision", synonyms: ["sight"], confusables: [] },
  ],
};

// Grounded in slide 2 only, so the other slides' replies are dropped as ungrounded.
const TEXT_REPLY = {
  mcqs: [
    {
      title: "The central nervous system",
      question: "Together with which structure does the brain form the central nervous system?",
      correct: "The spinal cord",
      distractors: ["The cerebellum", "The occipital lobe", "Glial cells"],
      evidence: "Together with the spinal cord, forms the central nervous system (CNS)",
    },
  ],
  fill_ins: [
    {
      title: "What the brain contains",
      sentence: "The brain contains blood vessels and nerves, including neurons and ____.",
      answer: "glial cells",
      synonyms: ["glia"],
      confusables: ["neurons"],
      evidence: "Contains blood vessels and nerves, including neurons and glial cells",
    },
  ],
  flashcards: [],
};

const LABELLED = { reason: "A drawing of the brain with its lobes named.", kind: "labelled_diagram" };

const REPLIES = {
  image_check: LABELLED,
  diagram_labels: DIAGRAM_REPLY,
  table_cells: TABLE_REPLY,
  text_questions: TEXT_REPLY,
};

type Asked = { route: RouteName; content: string; image: boolean };

/** Answers each route with a fixed reply, recording what it was asked and which pictures it kept. */
function fakeDeps(replies: Partial<Record<RouteName, unknown>>, asked: Asked[] = [], noted: string[][] = []): Deps {
  return {
    call: async (request) => {
      asked.push({ route: request.route, content: request.content, image: request.image !== undefined });
      return { ok: true, output: request.schema.parse(replies[request.route]), costUsd: 0.002 };
    },
    loadPicture: async () => ({ mediaType: "image/png", data: "iVBORw0KGgo=" }),
    notePicture: async (assetId, kind) => {
      noted.push([assetId, kind]);
    },
  };
}

function job(name: string, run: (signal: AbortSignal) => Promise<JobResult>, page = 1): Job {
  return { name, page, run };
}

const done = (questions: CreateQuestionArgs[] = [], costUsd = 0): JobResult => ({ costUsd, questions });

const FLASHCARD: CreateQuestionArgs = {
  type: "flashcard",
  document_id: DOCUMENT_ID,
  title: "Cells in the brain",
  source_page: 2,
  payload: { front: "Which two cell types does the brain contain?", back: "Neurons and glial cells." },
};

const options = (overrides: Partial<Parameters<typeof generate>[1]> = {}) => ({
  deadline: Date.now() + 240_000,
  budgetUsd: 1,
  save: async () => "saved" as const,
  ...overrides,
});

describe("planJobs", () => {
  const names = (source: Source) =>
    planJobs(source, fakeDeps({ image_check: {}, diagram_labels: {}, table_cells: {}, text_questions: {} })).map(
      (planned) => planned.name,
    );

  it("puts diagrams first, then tables, then every slide with text", () => {
    expect(names(deck())).toEqual([
      "slide 3 picture",
      "slide 4 table",
      "slide 1 text",
      "slide 2 text",
      "slide 3 text",
    ]);
  });

  it("gives each job the page its credit pays for", () => {
    const jobs = planJobs(deck(), fakeDeps(REPLIES));
    expect(jobs.map((planned) => [planned.name, planned.page])).toContainEqual(["slide 4 table", 4]);
    // Slide 3 has text and a diagram: one page, one credit.
    expect(pagesOf(jobs)).toEqual([1, 2, 3, 4]);
  });

  it("skips assets an earlier run already wrote questions for", () => {
    const covered = new Set([DIAGRAM_ID, assetId(2)]);
    expect(names(deck({ covered }))).toEqual(["slide 4 table", "slide 1 text", "slide 3 text"]);
  });

  it("starts a diagram with a look at its picture, or with its labels when it has none", () => {
    const pictureless = deck({ assets: [{ ...diagramAsset(DIAGRAM_ID, 3, LOBES), imagePath: null }] });
    expect(names(pictureless)).toEqual(["slide 3 diagram"]);
  });

  it(`plans at most ${LIMITS.diagrams} diagrams, ${LIMITS.tables} tables and ${LIMITS.textSlides} text slides`, () => {
    const assets = Array.from({ length: 20 }, (_, index) => [
      textAsset(assetId(100 + index), index + 1, null, "Some text"),
      diagramAsset(assetId(200 + index), index + 1, LOBES),
      tableAsset(assetId(300 + index), index + 1, LOBE_TABLE),
    ]).flat();
    const planned = names(deck({ assets }));
    expect(planned.filter((name) => name.endsWith("picture"))).toHaveLength(LIMITS.diagrams);
    expect(planned.filter((name) => name.endsWith("table"))).toHaveLength(LIMITS.tables);
    expect(planned.filter((name) => name.endsWith("text"))).toHaveLength(LIMITS.textSlides);
  });
});

describe("generate", () => {
  it("turns the sample deck into diagram, table and text questions", async () => {
    const asked: Asked[] = [];
    const saved: CreateQuestionArgs[] = [];
    const jobs = planJobs(deck(), fakeDeps(REPLIES, asked));

    const outcome = await generate(jobs, options({ save: async (question) => (saved.push(question), "saved") }));
    const routes = (route: RouteName) => asked.filter((call) => call.route === route);

    // Haiku looks at the diagram's picture before Sonnet judges its labels.
    expect(routes("image_check")).toEqual([
      {
        route: "image_check",
        content: expect.stringContaining('read by text recognition (OCR):\n"Human Brain Anatomy", "Frontal lobe"'),
        image: true,
      },
    ]);
    const [labels] = routes("diagram_labels");
    expect(labels.content).toContain('Labels on the diagram, read by text recognition (OCR):\n0. "Human Brain Anatomy"');
    expect(labels.content).toContain("Slide title: Lobes of the Brain");
    expect(labels.content).toContain("Source: Brain_Anatomy_Sample.pptx, slide 3");
    expect(labels.image).toBe(false);
    const [table] = routes("table_cells");
    expect(table.content).toContain('Table, 5 rows by 3 columns, row 0 is headings:\nRow 0: [0] "Lobe" | [1] "Location"');
    expect(table.content).toContain("Slide title: Lobe Functions");
    expect(routes("text_questions")).toHaveLength(3);
    expect(saved.map((question) => question.type).sort()).toEqual(["diagram_blank", "mcq", "short_answer", "table_blank"]);
    const savedAs = (type: string) => saved.find((question) => question.type === type);
    expect(savedAs("diagram_blank")).toMatchObject({ asset_id: DIAGRAM_ID, model_used: "anthropic/claude-sonnet-5.5" });
    expect(savedAs("table_blank")).toMatchObject({ asset_id: TABLE_ID, source_page: 4, model_used: "anthropic/claude-sonnet-5.5" });
    expect(savedAs("mcq")).toMatchObject({ asset_id: assetId(2), model_used: "anthropic/claude-haiku-5.5" });
    // The picture's look and its label judgement are a call each.
    expect(outcome).toEqual({ saved: 4, calls: 6, refusals: 0, errors: 0, stoppedBy: null });
  });

  it("cites a PDF's pages as pages, as create_question will", async () => {
    const asked: Asked[] = [];
    const pdf = deck({ filename: "Week 4 notes.pdf", pageName: "page" });
    const [picture, , text] = planJobs(pdf, fakeDeps(REPLIES, asked));

    await (await picture.run(AbortSignal.timeout(1000))).next?.run(AbortSignal.timeout(1000));
    await text.run(AbortSignal.timeout(1000));

    expect(asked.map((call) => [call.route, call.content.split("\n")[0]])).toEqual([
      ["image_check", "Source: Week 4 notes.pdf, page 3"],
      ["diagram_labels", "Source: Week 4 notes.pdf, page 3"],
      ["text_questions", "Source: Week 4 notes.pdf, page 1"],
    ]);
  });

  it("skips a picture that isn't a labelled diagram, paying only for the look", async () => {
    const asked: Asked[] = [];
    const noted: string[][] = [];
    const screenshot = { reason: "A BIOS setup screen with its menu tabs.", kind: "screenshot" };
    const [picture] = planJobs(deck(), fakeDeps({ ...REPLIES, image_check: screenshot }, asked, noted));

    expect(await picture.run(AbortSignal.timeout(1000))).toEqual({ costUsd: 0.002, questions: [] });
    expect(asked.map((call) => call.route)).toEqual(["image_check"]);
    // Kept for the deck page, which names the pictures it skipped.
    expect(noted).toEqual([[DIAGRAM_ID, "screenshot"]]);
  });

  it("keeps a passed picture's verdict, and still writes its question when keeping it fails", async () => {
    const noted: string[][] = [];
    const [kept] = planJobs(deck(), fakeDeps(REPLIES, [], noted));
    expect((await kept.run(AbortSignal.timeout(1000))).next?.name).toBe("slide 3 diagram");
    expect(noted).toEqual([[DIAGRAM_ID, "labelled_diagram"]]);

    const unkept = { ...fakeDeps(REPLIES), notePicture: () => Promise.reject(new Error("connection reset")) };
    const [picture] = planJobs(deck(), unkept);
    const looked = await picture.run(AbortSignal.timeout(1000));
    const labelled = await looked.next?.run(AbortSignal.timeout(1000));
    expect(labelled?.questions.map((question) => question.type)).toEqual(["diagram_blank"]);
  });

  it("judges the labels anyway when the picture can't be checked", async () => {
    const asked: Asked[] = [];
    const fine = fakeDeps(REPLIES, asked);
    const unchecked: [string, Source, Deps][] = [
      ["a failed download", deck(), { ...fine, loadPicture: () => Promise.reject(new Error("object not found")) }],
      ["a refusal", deck(), {
        ...fine,
        call: (request) =>
          request.route === "image_check"
            ? Promise.resolve({ ok: false, failure: "refusal", detail: "general_harms", costUsd: 0.001 })
            : fine.call(request),
      }],
      ["a reply off the schema", deck(), fakeDeps({ ...REPLIES, image_check: { kind: "painting" } }, asked)],
    ];
    for (const [why, source, deps] of unchecked) {
      const [picture] = planJobs(source, deps);
      const looked = await picture.run(AbortSignal.timeout(1000));
      expect(looked.next?.name, why).toBe("slide 3 diagram");
      const labelled = await looked.next?.run(AbortSignal.timeout(1000));
      expect(labelled?.questions.map((question) => question.type), why).toEqual(["diagram_blank"]);
    }
  });

  it("warms the label judgement's cache with a diagram that passed its look", async () => {
    const events: string[] = [];
    const assets = [3, 5, 6].map((page) => diagramAsset(assetId(400 + page), page, LOBES));
    const deps: Deps = {
      loadPicture: async () => ({ mediaType: "image/png", data: "iVBORw0KGgo=" }),
      notePicture: async () => {},
      call: async (request) => {
        const page = /slide (\d+)/.exec(request.content)?.[1];
        events.push(`start ${request.route} ${page}`);
        await new Promise((resolve) => setTimeout(resolve, request.route === "diagram_labels" ? 20 : 2));
        events.push(`end ${request.route} ${page}`);
        const screenshot = { reason: "A BIOS setup screen.", kind: "screenshot" };
        const reply = request.route === "image_check" ? (page === "3" ? screenshot : LABELLED) : DIAGRAM_REPLY;
        return { ok: true, output: request.schema.parse(reply), costUsd: 0.001 };
      },
    };

    expect(await generate(planJobs(deck({ assets }), deps), options())).toMatchObject({ saved: 2, calls: 5 });

    // Slide 3 is a screenshot, so slide 5's labels warm the cache that slide 6's then read.
    const at = (event: string) => events.indexOf(event);
    expect(events).not.toContain("start diagram_labels 3");
    const [first, second] = [5, 6].sort((a, b) => at(`start diagram_labels ${a}`) - at(`start diagram_labels ${b}`));
    expect(at(`start diagram_labels ${second}`)).toBeGreaterThan(at(`end diagram_labels ${first}`));
  });

  it(`runs at most ${LIMITS.concurrentCalls} calls at a time, starting them in order`, async () => {
    let running = 0;
    let peak = 0;
    const started: string[] = [];
    const jobs = Array.from({ length: 10 }, (_, index) =>
      job(`job ${index}`, async () => {
        started.push(`job ${index}`);
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return done();
      }),
    );

    const outcome = await generate(jobs, options());

    expect(peak).toBe(LIMITS.concurrentCalls);
    expect(started).toEqual(jobs.map((planned) => planned.name));
    expect(outcome.calls).toBe(10);
  });

  it("runs each route's first job alone, taking other routes' jobs meanwhile", async () => {
    const events: string[] = [];
    const timed = (name: string, route: RouteName, ms: number): Job => ({
      name,
      page: 1,
      route,
      async run() {
        events.push(`start ${name}`);
        await new Promise((resolve) => setTimeout(resolve, ms));
        events.push(`end ${name}`);
        return done();
      },
    });
    const jobs = [
      timed("diagram 1", "diagram_labels", 40),
      timed("diagram 2", "diagram_labels", 5),
      timed("diagram 3", "diagram_labels", 5),
      timed("text 1", "text_questions", 5),
      timed("text 2", "text_questions", 5),
    ];

    expect(await generate(jobs, options())).toMatchObject({ calls: 5, stoppedBy: null });

    const at = (event: string) => events.indexOf(event);
    // Diagrams 2 and 3 read the cache diagram 1 wrote; the text slides don't wait for it.
    expect(at("start diagram 2")).toBeGreaterThan(at("end diagram 1"));
    expect(at("start diagram 3")).toBeGreaterThan(at("end diagram 1"));
    expect(at("start text 1")).toBeLessThan(at("end diagram 1"));
    expect(at("start text 2")).toBeGreaterThan(at("end text 1"));
    expect(at("end text 2")).toBeLessThan(at("end diagram 1"));
  });

  it(`starts no call within ${LIMITS.lastCallMs / 1000} s of the deadline`, async () => {
    let clock = 0;
    const jobs = Array.from({ length: 5 }, (_, index) =>
      job(`job ${index}`, async () => {
        clock += 100_000;
        return done();
      }),
    );

    const outcome = await generate(jobs, options({ deadline: 240_000, now: () => clock }));

    // Started at 0 s and 100 s; at 200 s only 40 s were left.
    expect(outcome).toMatchObject({ calls: 2, stoppedBy: "deadline" });
  });

  it("stops starting calls once the day's budget is spent; calls in flight finish", async () => {
    const jobs = Array.from({ length: 6 }, (_, index) => job(`job ${index}`, async () => done([], 0.003)));

    expect(await generate(jobs, options({ budgetUsd: 0.005 }))).toMatchObject({
      calls: LIMITS.concurrentCalls,
      stoppedBy: "budget",
    });
    expect(await generate(jobs, options({ budgetUsd: 0 }))).toMatchObject({ calls: 0, stoppedBy: "budget" });
  });

  it(`saves at most ${LIMITS.questions} questions`, async () => {
    const jobs = Array.from({ length: 4 }, (_, index) => job(`job ${index}`, async () => done(Array(25).fill(FLASHCARD))));
    expect(await generate(jobs, options())).toMatchObject({ saved: LIMITS.questions, stoppedBy: "questions" });
  });

  it("carries on past a refused slide or a failed call", async () => {
    const jobs = [
      job("refused", async () => ({ costUsd: 0.001, failure: "refusal", questions: [] })),
      job("broken", async () => {
        throw new Error("OpenRouter is down");
      }),
      job("fine", async () => done([FLASHCARD])),
    ];
    expect(await generate(jobs, options())).toEqual({
      saved: 1,
      calls: 3,
      refusals: 1,
      errors: 1,
      stoppedBy: null,
    });
  });

  it("stops saving once the document is gone", async () => {
    let saves = 0;
    const jobs = [job("first", async () => done([FLASHCARD, FLASHCARD, FLASHCARD]))];
    const outcome = await generate(
      jobs,
      options({
        save: async () => {
          saves += 1;
          return "document_gone";
        },
      }),
    );
    expect(saves).toBe(1);
    expect(outcome).toMatchObject({ saved: 0, stoppedBy: "document_gone" });
  });
});

describe("essayJob", () => {
  // Four slides with enough text to explain at length.
  const notes = (page: number) =>
    textAsset(assetId(500 + page), page, `Topic ${page}`, `A paragraph about topic ${page}. `.repeat(6));
  const lecture = (overrides: Partial<Source> = {}) => deck({ assets: [1, 2, 3, 4].map(notes), ...overrides });
  const ESSAYS = {
    essays: [
      {
        title: "Topics two and three",
        prompt: "Explain how topic two leads to topic three.",
        source_page: 2,
        rubric: [
          { criterion: "Describes topic two", points: 2 },
          { criterion: "Links it to topic three", points: 2 },
        ],
        model_answer: "Topic two sets up topic three.",
      },
      { ...{ title: "Topic four", prompt: "Explain topic four.", source_page: 4 }, rubric: [], model_answer: "" },
    ],
  };

  it("writes the deck's essays in one call, from the pages its credits covered", async () => {
    const asked: Asked[] = [];
    const job = essayJob(lecture(), new Set([1, 2, 3]), fakeDeps({ essay_questions: ESSAYS }, asked).call);
    if (!job) throw new Error("expected an essay job");

    const result = await job.run(AbortSignal.timeout(1000));

    expect(job).toMatchObject({ page: 1, route: "essay_questions" });
    expect(asked[0].content).toContain("Source: Brain_Anatomy_Sample.pptx\n\nSlide 1: Topic 1\nA paragraph");
    expect(asked[0].content).not.toContain("Slide 4:");
    // Page 4 wasn't covered, so its essay goes with it.
    expect(result.questions).toEqual([expect.objectContaining({ type: "essay", source_page: 2 })]);
  });

  it("writes none for a deck with too little text, or one that already has its essays", () => {
    const call = fakeDeps({}).call;
    expect(essayJob(deck(), new Set([1, 2, 3, 4]), call)).toBeNull();
    expect(essayJob(lecture(), new Set([1, 2]), call)).toBeNull();
    expect(essayJob(lecture({ hasEssays: true }), new Set([1, 2, 3, 4]), call)).toBeNull();
  });
});
