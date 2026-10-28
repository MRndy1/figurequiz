import { describe, expect, it } from "vitest";

import { CreateQuestionArgs, GAP } from "@/lib/contracts";
import { gradeBlank, type BlankKey } from "@/lib/grading";
import type {
  DiagramLabelsOutput,
  EssayQuestionsOutput,
  TableCellsOutput,
  TextQuestionsOutput,
} from "@/lib/schemas/generation";

import {
  BLANKS,
  DIAGRAM_PROMPT,
  ESSAYS_PER_DECK,
  PER_SLIDE,
  TABLE_PROMPT,
  diagramQuestion,
  essayQuestions,
  tableQuestion,
  textQuestions,
  type DiagramSource,
  type TableSource,
  type TextSource,
} from "./validate";

/*
 * Fixtures are the sample deck as extraction sees it: slide 3's labels as Tesseract read them
 * (the figure's own title first), and slide 2's bullets verbatim.
 */

const DOCUMENT_ID = "0b7e3c1a-2d4f-4e6a-9b8c-7d6e5f4a3b2c";
const ASSET_ID = "8a9b0c1d-2e3f-5a4b-9c5d-6e7f8a9b0c1d";

const LOBES = [
  "Human Brain Anatomy",
  "Frontal lobe",
  "Parietal lobe",
  "Occipital lobe",
  "Cerebellum",
  "Temporal lobe",
  "Spinal Cord",
];

function diagram(labels: string[] = LOBES, slideTitle: string | null = "Lobes of the Brain"): DiagramSource {
  return {
    documentId: DOCUMENT_ID,
    assetId: ASSET_ID,
    page: 3,
    slideTitle,
    labels: labels.map((text) => ({ text })),
    model: "anthropic/claude-sonnet-5.5",
  };
}

type ProposedBlank = DiagramLabelsOutput["blanks"][number];

function blank(
  label_index: number,
  answer: string,
  synonyms: string[] = [],
  confusables: string[] = [],
): ProposedBlank {
  return { label_index, answer, synonyms, confusables };
}

const LOBE_BLANKS = [
  blank(1, "Frontal lobe", ["frontal"], ["parietal lobe"]),
  blank(2, "Parietal lobe", ["parietal"], []),
  blank(3, "Occipital lobe", ["occipital"], []),
  blank(4, "Cerebellum", [], ["cerebrum"]),
  blank(5, "Temporal lobe", ["temporal"], []),
  blank(6, "Spinal cord", [], []),
];

function keyOf(question: CreateQuestionArgs) {
  if (question.type !== "diagram_blank") throw new Error(`expected a diagram, got ${question.type}`);
  return question.answer_key.blanks;
}

function build(output: DiagramLabelsOutput, source = diagram()) {
  const question = diagramQuestion(source, output);
  if (!question) throw new Error("expected a diagram question");
  return question;
}

describe("diagramQuestion", () => {
  it("builds a question create_question accepts, numbered in label order", () => {
    const question = build({ title: "Lobes of the brain", blanks: [...LOBE_BLANKS].reverse() });

    expect(CreateQuestionArgs.safeParse(question).success).toBe(true);
    expect(question).toMatchObject({
      type: "diagram_blank",
      document_id: DOCUMENT_ID,
      asset_id: ASSET_ID,
      source_page: 3,
      title: "Lobes of the brain",
      payload: { prompt: DIAGRAM_PROMPT, numbers: [1, 2, 3, 4, 5, 6] },
      model_used: "anthropic/claude-sonnet-5.5",
    });
    expect(keyOf(question).map((key) => [key.number, key.label_index])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
      [6, 6],
    ]);
  });

  it("produces a key that grades the printed labels correct and every confusable wrong", () => {
    const question = build({ title: "", blanks: LOBE_BLANKS });
    const keys: BlankKey[] = keyOf(question);
    for (const key of keyOf(question)) {
      expect(gradeBlank(LOBES[key.label_index], key, keys).correct, key.answer).toBe(true);
      for (const synonym of key.synonyms) {
        expect(gradeBlank(synonym, key, keys).correct, synonym).toBe(true);
      }
      for (const confusable of key.confusables) {
        expect(gradeBlank(confusable, key, keys).correct, confusable).toBe(false);
      }
    }
  });

  it("drops a blank whose answer belongs to a different label", () => {
    const question = build({
      title: "",
      blanks: [blank(1, "Cerebellum"), blank(2, "Parietal lobe"), blank(3, "Occipital lobe")],
    });
    expect(keyOf(question).map((key) => key.answer)).toEqual(["Parietal lobe", "Occipital lobe"]);
  });

  it("corrects a recognition error only as far as the grader forgives a typo", () => {
    const labels = ["Fr0ntal lobe", "Parietal lobe", "Occipita1"];
    const question = build(
      { title: "", blanks: [blank(0, "Frontal lobe"), blank(1, "Parietal lobe"), blank(2, "Temporal lobe")] },
      diagram(labels),
    );
    expect(keyOf(question).map((key) => key.answer)).toEqual(["Frontal lobe", "Parietal lobe"]);
  });

  it("accepts an answer that is most of its label, and then the printed label too", () => {
    const labels = ["Cell body (soma)", "Axon", "Frontal lobe"];
    const question = build(
      { title: "", blanks: [blank(0, "Cell body", ["soma"]), blank(1, "Axon"), blank(2, "lobe")] },
      diagram(labels),
    );
    const [cellBody, axon] = keyOf(question);
    expect(keyOf(question)).toHaveLength(2);
    expect(cellBody.synonyms).toEqual(["soma", "Cell body (soma)"]);
    expect(axon.answer).toBe("Axon");
  });

  it("drops a confusable the grader would accept as right", () => {
    const question = build({
      title: "",
      blanks: [
        blank(1, "Frontal lobe", ["frontal"], ["Frontal", "the frontal lobe", "parietal lobe"]),
        blank(2, "Parietal lobe"),
      ],
    });
    expect(keyOf(question)[0].confusables).toEqual(["parietal lobe"]);
  });

  it("drops a synonym two blanks share from both", () => {
    const question = build({
      title: "",
      blanks: [
        blank(1, "Frontal lobe", ["frontal", "cortex"]),
        blank(2, "Parietal lobe", ["parietal", "cortex", "frontal lobe"]),
      ],
    });
    expect(keyOf(question).map((key) => key.synonyms)).toEqual([["frontal"], ["parietal"]]);
  });

  it("drops a blank whose answer another label still shows", () => {
    const labels = ["Neuron", "Axon", "Neuron", "Dendrite"];
    const question = build(
      { title: "", blanks: [blank(0, "Neuron"), blank(1, "Axon"), blank(3, "Dendrite")] },
      diagram(labels),
    );
    expect(keyOf(question).map((key) => key.answer)).toEqual(["Axon", "Dendrite"]);
  });

  it("rejects a visible label spelled almost like the answer", () => {
    const labels = ["Afferent neuron", "Efferent neuron", "Receptor"];
    const question = build(
      { title: "", blanks: [blank(0, "Afferent neuron"), blank(2, "Receptor")] },
      diagram(labels),
    );
    const keys = keyOf(question);
    expect(keys[0].confusables).toEqual(["Efferent neuron"]);
    expect(gradeBlank("Efferent neuron", keys[0], keys).correct).toBe(false);
    expect(gradeBlank("Aferent neuron", keys[0], keys).correct).toBe(true);
  });

  it("skips a repeated label or answer, and labels that don't exist", () => {
    const question = build({
      title: "",
      blanks: [
        blank(1, "Frontal lobe"),
        blank(1, "Frontal lobe"),
        blank(2, "frontal lobe"),
        blank(9, "Insula"),
        blank(3, "Occipital lobe"),
      ],
    });
    expect(keyOf(question).map((key) => key.label_index)).toEqual([1, 3]);
  });

  it(`needs ${BLANKS.min} blanks and keeps at most ${BLANKS.max}`, () => {
    expect(diagramQuestion(diagram(), { title: "", blanks: [blank(1, "Frontal lobe")] })).toBeNull();
    expect(diagramQuestion(diagram(), { title: "", blanks: [] })).toBeNull();

    const labels = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliett"];
    const question = build(
      { title: "", blanks: labels.map((label, index) => blank(index, label)) },
      diagram(labels),
    );
    expect(keyOf(question)).toHaveLength(BLANKS.max);
  });

  it("never titles the question with one of its answers", () => {
    const blanks = LOBE_BLANKS;
    expect(build({ title: "The cerebellum and the lobes", blanks }).title).toBe("Lobes of the Brain");
    expect(build({ title: "", blanks }, diagram(LOBES, "The Cerebellum")).title).toBe("Label the diagram");
    expect(build({ title: "", blanks }, diagram(LOBES, null)).title).toBe("Label the diagram");
  });
});

const SLIDE_2_TEXT = [
  "•  A complex organ controlling thought, memory, emotion, touch, motor skills, vision, breathing, temperature and hunger",
  "•  Together with the spinal cord, forms the central nervous system (CNS)",
  "•  Weighs roughly 3 pounds in an average adult and is about 60% fat",
  "•  Contains blood vessels and nerves, including neurons and glial cells",
  "•  Grey matter is the darker outer portion; white matter is the lighter inner section",
  "•  Grey matter processes and interprets information; white matter transmits it",
].join("\n");

const SLIDE_2: TextSource = {
  documentId: DOCUMENT_ID,
  assetId: "3f2b1c4d-5e6f-5a7b-8c9d-0e1f2a3b4c5d",
  page: 2,
  title: "What Is the Brain?",
  text: SLIDE_2_TEXT,
  pageName: "slide",
  model: "anthropic/claude-haiku-5.5",
};

type Mcq = TextQuestionsOutput["mcqs"][number];
type FillIn = TextQuestionsOutput["fill_ins"][number];
type Flashcard = TextQuestionsOutput["flashcards"][number];

const MCQ: Mcq = {
  title: "The central nervous system",
  question: "Together with which structure does the brain form the central nervous system?",
  correct: "The spinal cord",
  distractors: ["The cerebellum", "The occipital lobe", "Glial cells"],
  evidence: "Together with the spinal cord, forms the central nervous system (CNS)",
};

const FILL_IN: FillIn = {
  title: "What the brain contains",
  sentence: "The brain contains blood vessels and nerves, including neurons and ____.",
  answer: "glial cells",
  synonyms: ["glia", "glial cell"],
  confusables: ["neurons", "white matter"],
  evidence: "Contains blood vessels and nerves, including neurons and glial cells",
};

const FLASHCARD: Flashcard = {
  title: "Grey matter",
  front: "Where in the brain is grey matter found, and how does it look?",
  back: "The darker outer portion of the brain.",
  evidence: "Grey matter is the darker outer portion; white matter is the lighter inner section",
};

function text(output: Partial<TextQuestionsOutput>, source = SLIDE_2) {
  return textQuestions(source, { mcqs: [], fill_ins: [], flashcards: [], ...output });
}

describe("textQuestions", () => {
  it("builds questions create_question accepts", () => {
    const questions = text({ mcqs: [MCQ], fill_ins: [FILL_IN], flashcards: [FLASHCARD] });

    expect(questions.map((question) => question.type)).toEqual(["mcq", "short_answer", "flashcard"]);
    for (const question of questions) {
      expect(CreateQuestionArgs.safeParse(question).success, question.type).toBe(true);
      expect(question).toMatchObject({
        document_id: DOCUMENT_ID,
        asset_id: SLIDE_2.assetId,
        source_page: 2,
        model_used: "anthropic/claude-haiku-5.5",
      });
    }
    expect(questions[1]).toMatchObject({
      payload: { prompt: FILL_IN.sentence },
      answer_key: { answer: "glial cells", synonyms: ["glia", "glial cell"], confusables: ["neurons", "white matter"] },
    });
    expect(questions[2]).toMatchObject({ payload: { front: FLASHCARD.front, back: FLASHCARD.back } });
  });

  it("shuffles the options and points answer_index at the correct one", () => {
    const positions = new Set<number>();
    for (let run = 0; run < 60; run += 1) {
      const [question] = text({ mcqs: [MCQ] });
      if (question.type !== "mcq") throw new Error("expected an mcq");
      expect(question.payload.options[question.answer_key.answer_index]).toBe("The spinal cord");
      expect([...question.payload.options].sort()).toEqual([MCQ.correct, ...MCQ.distractors].sort());
      positions.add(question.answer_key.answer_index);
    }
    expect(positions.size).toBeGreaterThan(1);
  });

  it("drops a question whose evidence isn't on the slide", () => {
    const paraphrased = "The brain and spinal cord make up the CNS";
    expect(text({ mcqs: [{ ...MCQ, evidence: paraphrased }] })).toEqual([]);
    expect(text({ fill_ins: [{ ...FILL_IN, evidence: "glial" }] })).toEqual([]);
    expect(text({ flashcards: [{ ...FLASHCARD, evidence: "" }] })).toEqual([]);
  });

  it("drops a multiple-choice question that gives itself away", () => {
    const leaky = { ...MCQ, question: "Does the spinal cord form the CNS together with the brain?" };
    const catchAll = { ...MCQ, distractors: ["The cerebellum", "All of the above", "None of these"] };
    const duplicates = { ...MCQ, distractors: ["Spinal cord", "the cerebellum", "The cerebellum"] };
    expect(text({ mcqs: [leaky, catchAll, duplicates] })).toEqual([]);

    const [kept] = text({ mcqs: [{ ...MCQ, distractors: [...MCQ.distractors, "Neurons"] }] });
    expect(kept.type === "mcq" && kept.payload.options).toHaveLength(4);
  });

  it("writes the gap as four underscores and needs exactly one", () => {
    const [short] = text({
      fill_ins: [{ ...FILL_IN, sentence: "The brain contains blood vessels and nerves, including neurons and ___." }],
    });
    expect(short.type === "short_answer" && short.payload.prompt).toBe(
      `The brain contains blood vessels and nerves, including neurons and ${GAP}.`,
    );
    expect(text({ fill_ins: [{ ...FILL_IN, sentence: `${GAP} contains ${GAP}.` }] })).toEqual([]);
    expect(text({ fill_ins: [{ ...FILL_IN, sentence: "No gap here." }] })).toEqual([]);
  });

  it("drops a fill-in whose sentence shows the answer, or whose answer isn't the slide's", () => {
    const shows = { ...FILL_IN, sentence: "Glial cells and ____ are found in the brain's nerves." };
    const invented = { ...FILL_IN, answer: "astrocytes", synonyms: [] };
    const tooLong = {
      ...FILL_IN,
      sentence: "____.",
      answer: "blood vessels and nerves including neurons",
      evidence: FILL_IN.evidence,
    };
    expect(text({ fill_ins: [shows, invented, tooLong] })).toEqual([]);
  });

  it("drops confusables the grader would accept as right", () => {
    const [question] = text({
      fill_ins: [{ ...FILL_IN, confusables: ["Glial cells", "glia", "neurons", "neurons"] }],
    });
    expect(question.type === "short_answer" && question.answer_key.confusables).toEqual(["neurons"]);
  });

  it(`keeps at most ${PER_SLIDE.mcqs} MCQs, ${PER_SLIDE.fillIns} fill-ins and ${PER_SLIDE.flashcards} flashcards`, () => {
    const questions = text({
      mcqs: Array(5).fill(MCQ),
      fill_ins: Array(5).fill(FILL_IN),
      flashcards: Array(5).fill(FLASHCARD),
    });
    const count = (type: string) => questions.filter((question) => question.type === type).length;
    expect([count("mcq"), count("short_answer"), count("flashcard")]).toEqual([
      PER_SLIDE.mcqs,
      PER_SLIDE.fillIns,
      PER_SLIDE.flashcards,
    ]);
  });

  it("replaces a title that names the answer", () => {
    const [mcq, fillIn] = text({
      mcqs: [{ ...MCQ, title: "The spinal cord" }],
      fill_ins: [{ ...FILL_IN, title: "Glia" }],
    });
    expect(mcq.title).toBe("What Is the Brain?");
    expect(fillIn.title).toBe("What Is the Brain?");

    const [untitled] = text({ fill_ins: [{ ...FILL_IN, title: "" }] }, { ...SLIDE_2, title: null });
    expect(untitled.title).toBe("From slide 2");
    const fromPdf = { ...SLIDE_2, title: null, pageName: "page" as const };
    const [pdfUntitled] = text({ fill_ins: [{ ...FILL_IN, title: "" }] }, fromPdf);
    expect(pdfUntitled.title).toBe("From page 2");
  });
});

describe("tableQuestion", () => {
  const TABLE_ID = "5c6d7e8f-9a0b-5c1d-8e2f-3a4b5c6d7e8f";
  // Slide 4 of the sample deck, as python-pptx reads it.
  const LOBE_TABLE = [
    ["Lobe", "Location", "Main functions"],
    ["Frontal", "Front of the head", "Personality, decision-making, movement, speech (Broca's area)"],
    ["Parietal", "Middle of the brain", "Object identification, spatial relationships, pain and touch"],
    ["Temporal", "Sides of the brain", "Short-term memory, speech, musical rhythm, smell recognition"],
    ["Occipital", "Back of the brain", "Vision"],
  ];

  function table(rows: string[][] = LOBE_TABLE, slideTitle: string | null = "Lobe Functions"): TableSource {
    return {
      documentId: DOCUMENT_ID,
      assetId: TABLE_ID,
      page: 4,
      slideTitle,
      rows,
      headerRows: 1,
      model: "anthropic/claude-sonnet-5.5",
    };
  }

  type ProposedCell = TableCellsOutput["blanks"][number];
  const cell = (row: number, col: number, answer: string, synonyms: string[] = [], confusables: string[] = []): ProposedCell => ({
    row,
    col,
    answer,
    synonyms,
    confusables,
  });
  const reply = (blanks: ProposedCell[], title = "What each lobe does"): TableCellsOutput => ({ title, blanks });

  it("blanks the chosen cells by number, in reading order, and keys them", () => {
    const question = tableQuestion(
      table(),
      reply([cell(4, 2, "Vision", ["sight"]), cell(1, 1, "Front of the head", ["front of the brain"]), cell(3, 0, "Temporal")]),
    );
    expect(question).not.toBeNull();
    if (question?.type !== "table_blank") throw new Error("expected a table question");
    expect(question).toMatchObject({ asset_id: TABLE_ID, source_page: 4, title: "What each lobe does" });
    expect(question.payload.prompt).toBe(TABLE_PROMPT);
    expect(question.payload.header_rows).toBe(1);
    expect(question.payload.rows[1][1]).toEqual({ blank: 1 });
    expect(question.payload.rows[3][0]).toEqual({ blank: 2 });
    expect(question.payload.rows[4][2]).toEqual({ blank: 3 });
    expect(question.payload.rows[0]).toEqual(LOBE_TABLE[0]);
    expect(question.answer_key.blanks.map(({ number, row, col, answer }) => [number, row, col, answer])).toEqual([
      [1, 1, 1, "Front of the head"],
      [2, 3, 0, "Temporal"],
      [3, 4, 2, "Vision"],
    ]);
    // No blanked cell's text reaches the public payload.
    const shown = JSON.stringify(question.payload).toLowerCase();
    for (const answer of ["front of the head", "temporal", "vision"]) expect(shown).not.toContain(answer);
    expect(CreateQuestionArgs.safeParse(question).success).toBe(true);
  });

  it("never blanks a heading, an empty cell, a cell off the table or a long one", () => {
    const rows = LOBE_TABLE.map((row) => [...row]);
    rows[2][1] = "";
    const question = tableQuestion(
      table(rows),
      reply([
        cell(0, 1, "Location"),
        cell(2, 1, "Middle of the brain"),
        cell(9, 0, "Frontal"),
        cell(2, 2, "Object identification, spatial relationships, pain and touch"),
        cell(1, 1, "Front of the head"),
      ]),
    );
    expect(question).toBeNull();
  });

  it("drops an answer that isn't its cell's, but keeps a tidied one with the cell as printed", () => {
    const rows = LOBE_TABLE.map((row) => [...row]);
    rows[4][2] = "Vision.";
    const question = tableQuestion(
      table(rows),
      reply([cell(1, 1, "Back of the brain"), cell(3, 0, "Temporal"), cell(4, 2, "Vision"), cell(4, 0, "Occipital")]),
    );
    if (question?.type !== "table_blank") throw new Error("expected a table question");
    expect(question.answer_key.blanks.map((blank) => blank.answer)).toEqual(["Temporal", "Occipital", "Vision"]);
  });

  it("drops a blank another visible cell gives away", () => {
    const rows = LOBE_TABLE.map((row) => [...row]);
    rows[2][2] = "Spatial relationships, next to the temporal lobe";
    const question = tableQuestion(
      table(rows),
      reply([cell(3, 0, "Temporal"), cell(1, 1, "Front of the head"), cell(4, 2, "Vision")]),
    );
    if (question?.type !== "table_blank") throw new Error("expected a table question");
    expect(question.answer_key.blanks.map((blank) => blank.answer)).toEqual(["Front of the head", "Vision"]);
  });

  it("keeps a cell of every row visible", () => {
    const rows = [
      ["Gland", "Hormone"],
      ["Thyroid", "Thyroxine"],
      ["Pancreas", "Insulin"],
    ];
    const question = tableQuestion(
      table(rows, null),
      reply([cell(1, 0, "Thyroid"), cell(1, 1, "Thyroxine"), cell(2, 1, "Insulin")], "Glands"),
    );
    if (question?.type !== "table_blank") throw new Error("expected a table question");
    expect(question.answer_key.blanks.map((blank) => blank.answer)).toEqual(["Thyroid", "Insulin"]);
  });

  it("needs two blanks, and keeps every answer out of the title", () => {
    expect(tableQuestion(table(), reply([cell(3, 0, "Temporal")]))).toBeNull();
    const question = tableQuestion(
      table(),
      reply([cell(3, 0, "Temporal"), cell(4, 2, "Vision")], "Temporal lobe and vision"),
    );
    expect(question?.title).toBe("Lobe Functions");
  });

  it("rejects a near-identical cell elsewhere in the table as a confusable", () => {
    const rows = [
      ["Hormone", "Effect"],
      ["Insulin", "Lowers blood glucose"],
      ["Glucagon", "Raises blood glucose"],
      ["Inulin", "A fibre, not a hormone"],
    ];
    const question = tableQuestion(table(rows, null), reply([cell(1, 0, "Insulin"), cell(2, 0, "Glucagon")], "Hormones"));
    if (question?.type !== "table_blank") throw new Error("expected a table question");
    const [insulin] = question.answer_key.blanks;
    expect(insulin.confusables).toContain("Inulin");
    expect(gradeBlank("inulin", insulin).correct).toBe(false);
  });
});

describe("essayQuestions", () => {
  const source = { documentId: DOCUMENT_ID, pages: [2, 3, 4], model: "anthropic/claude-sonnet-5.5" };
  type Essay = EssayQuestionsOutput["essays"][number];
  const essay = (overrides: Partial<Essay> = {}): Essay => ({
    title: "How the lobes share the work",
    prompt: "Explain how the cerebrum divides its work between its lobes. Name three lobes and what each does.",
    source_page: 4,
    rubric: [
      { criterion: " Names three lobes of the cerebrum correctly ", points: 2 },
      { criterion: "Gives a correct main function for each lobe it names", points: 3 },
    ],
    model_answer: "The frontal lobe handles decision-making and movement, the parietal lobe touch and the occipital lobe vision.",
    ...overrides,
  });

  it("keeps an essay with a rubric and a model answer, as create_question takes it", () => {
    const [question] = essayQuestions(source, { essays: [essay()] });
    expect(CreateQuestionArgs.parse(question)).toEqual(question);
    expect(question).toMatchObject({
      type: "essay",
      source_page: 4,
      payload: { prompt: essay().prompt },
      answer_key: { rubric: [{ criterion: "Names three lobes of the cerebrum correctly", points: 2 }, expect.anything()] },
    });
  });

  it("drops an essay citing a page it wasn't written from, or a model answer over the limit", () => {
    const tooLong = Array.from({ length: 251 }, () => "word").join(" ");
    expect(essayQuestions(source, { essays: [essay({ source_page: 9 })] })).toEqual([]);
    expect(essayQuestions(source, { essays: [essay({ model_answer: tooLong })] })).toEqual([]);
  });

  it("drops an essay the contract refuses: one criterion, or a criterion worth too much", () => {
    expect(essayQuestions(source, { essays: [essay({ rubric: [{ criterion: "Says anything", points: 2 }] })] })).toEqual([]);
    const greedy = [
      { criterion: "Names three lobes", points: 9 },
      { criterion: "Gives their jobs", points: 1 },
    ];
    expect(essayQuestions(source, { essays: [essay({ rubric: greedy })] })).toEqual([]);
  });

  it(`keeps at most ${ESSAYS_PER_DECK} essays`, () => {
    expect(essayQuestions(source, { essays: [essay(), essay(), essay()] })).toHaveLength(ESSAYS_PER_DECK);
  });
});
