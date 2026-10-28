import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { gradeBlank } from "./grading";
import { originalImage, questions, toPublic, type Question } from "./questions";

/**
 * Invariants over the real question data, not over hand-written fixtures.
 *
 * These catch the mistakes that are easy to make while authoring questions by hand and that
 * type-checking cannot see: a confusable that is actually a correct answer, an answer the
 * grader rejects, a missing image, or an answer key leaking through `toPublic`.
 */

const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));
const DEMO_DIR = fileURLToPath(new URL("../data/demo", import.meta.url));

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

function digest(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function gradeableKeys(question: Question) {
  if (question.type === "diagram") return question.blanks;
  if (question.type === "short_answer") {
    return [
      {
        number: 1,
        answer: question.answer,
        synonyms: question.synonyms,
        confusables: question.confusables,
      },
    ];
  }
  return [];
}

describe("question data", () => {
  it("has unique ids", () => {
    const ids = questions.map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // lib/demo/media.ts statically imports these files, so the build fails if one is missing; this
  // catches a slide the data cites that was never rendered.
  it("cites a source slide that exists on disk", () => {
    for (const question of questions) {
      expect(question.sourceSlide, question.id).toBeGreaterThan(0);
      const slide = join(DEMO_DIR, "slides", `slide-${question.sourceSlide}.png`);
      expect(existsSync(slide), question.id).toBe(true);
    }
  });

  it("serves the blanked diagram publicly and keeps the revealed one private", () => {
    for (const question of questions) {
      if (question.type !== "diagram") continue;
      const pub = toPublic(question);
      const image = pub.type === "diagram" ? pub.image : "";
      expect(existsSync(join(PUBLIC_DIR, image)), image).toBe(true);
      expect(existsSync(join(DEMO_DIR, originalImage(question))), question.id).toBe(true);
    }
  });
});

/*
 * Everything under public/ is served at a predictable URL, so an un-blanked diagram or a source
 * slide there hands out answers to anyone who never answered — the prototype's leak. Those images
 * belong in data/demo/, where only the grading actions serve them. This trips on a copy under any
 * name, and on the names `ingest` gives such renders.
 */
describe("public/", () => {
  it("holds no image that shows answers", () => {
    const secrets = new Set(
      filesUnder(DEMO_DIR)
        .filter((file) => file.endsWith(".png"))
        .map(digest),
    );
    for (const file of filesUnder(PUBLIC_DIR)) {
      expect(secrets.has(digest(file)), `${file} is a copy of an image in data/demo/`).toBe(false);
      expect(basename(file), file).not.toMatch(/-original\.|^slide-\d+\./);
    }
  });
});

/*
 * The same leak in words: a page or component that spells out a demo diagram's answer, even as
 * decoration or as an example, gives it away to anyone about to try the sample question.
 */
describe("pages and components", () => {
  it("never spell out a demo diagram's answer", () => {
    const answers = questions.flatMap((question) =>
      question.type === "diagram"
        ? question.blanks.flatMap((blank) => [blank.answer, ...(blank.synonyms ?? [])])
        : [],
    );
    const sources = ["../app", "../components"]
      .flatMap((dir) => filesUnder(fileURLToPath(new URL(dir, import.meta.url))))
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));
    for (const file of sources) {
      const text = readFileSync(file, "utf8").toLowerCase();
      for (const answer of answers) {
        expect(text.includes(answer.toLowerCase()), `${file} spells out "${answer}"`).toBe(false);
      }
    }
  });
});

describe("answer keys grade as intended", () => {
  it("accepts the answer itself", () => {
    for (const question of questions) {
      for (const key of gradeableKeys(question)) {
        const result = gradeBlank(key.answer, key);
        expect(result.correct, `${question.id} #${key.number}: ${key.answer}`).toBe(true);
      }
    }
  });

  it("accepts every listed synonym", () => {
    for (const question of questions) {
      for (const key of gradeableKeys(question)) {
        for (const synonym of key.synonyms ?? []) {
          const result = gradeBlank(synonym, key);
          expect(result.correct, `${question.id} #${key.number}: ${synonym}`).toBe(true);
        }
      }
    }
  });

  // The whole reason confusables exist: a 0.85 fuzzy ratio otherwise accepts domain opposites.
  it("rejects every listed confusable", () => {
    for (const question of questions) {
      const keys = gradeableKeys(question);
      for (const key of keys) {
        for (const confusable of key.confusables ?? []) {
          const result = gradeBlank(confusable, key, keys);
          expect(result.correct, `${question.id} #${key.number}: ${confusable}`).toBe(false);
        }
      }
    }
  });

  it("never lists another blank's answer as a synonym of this one", () => {
    for (const question of questions) {
      if (question.type !== "diagram") continue;
      for (const key of question.blanks) {
        const others = question.blanks.filter((other) => other.number !== key.number);
        for (const other of others) {
          expect(
            (key.synonyms ?? []).map((s) => s.toLowerCase()),
            `${question.id} #${key.number}`,
          ).not.toContain(other.answer.toLowerCase());
        }
      }
    }
  });
});

describe("multiple choice", () => {
  it("has an in-range answer and no duplicate options", () => {
    for (const question of questions) {
      if (question.type !== "mcq") continue;
      expect(question.answerIndex, question.id).toBeGreaterThanOrEqual(0);
      expect(question.answerIndex, question.id).toBeLessThan(question.options.length);
      expect(new Set(question.options).size, question.id).toBe(question.options.length);
    }
  });

  // Every option set came back from generation with the answer first; if they all stayed there
  // the quiz would be trivially guessable.
  it("does not always put the answer in the same position", () => {
    const positions = questions
      .filter((question) => question.type === "mcq")
      .map((question) => question.answerIndex);
    expect(new Set(positions).size).toBeGreaterThan(1);
  });
});

describe("toPublic", () => {
  // Structural, not string matching: a confusable such as "neurons" legitimately appears in its
  // own question's prompt, so scanning for those words reports leaks that are not leaks. What
  // must hold is that no answer-bearing field survives the projection. The two images count:
  // the un-blanked diagram and the source slide both show the answer.
  const ANSWER_FIELDS = [
    "answer",
    "answerIndex",
    "blanks",
    "synonyms",
    "confusables",
    "revealImage",
    "slideImage",
  ];

  it("drops every answer-bearing field", () => {
    for (const question of questions) {
      const keys = Object.keys(toPublic(question));
      for (const field of ANSWER_FIELDS) {
        expect(keys, `${question.id} kept ${field}`).not.toContain(field);
      }
    }
  });

  // File names, unlike answer words, cannot turn up in a prompt by accident, so a string scan is
  // safe here and catches the images under any field name.
  it("references no un-blanked diagram or source slide", () => {
    for (const question of questions) {
      const serialized = JSON.stringify(toPublic(question));
      expect(serialized, question.id).not.toMatch(/-original\.|slide-\d+\./);
    }
  });

  /*
   * The id travels in the URL, so a graded question whose id contains its own answer gives it
   * away to anyone who reads the address bar — `/questions/blank-cerebrum` for an answer of
   * "cerebrum". Multiple-choice is exempt: every option is on screen by design, and which one
   * is correct is carried by `answerIndex`, covered by the structural test above.
   */
  it("does not serialize the correct answer of a graded question, including in its id", () => {
    for (const question of questions) {
      const serialized = JSON.stringify(toPublic(question));
      for (const key of gradeableKeys(question)) {
        expect(
          serialized.toLowerCase(),
          `${question.id} leaked its answer "${key.answer}"`,
        ).not.toContain(key.answer.toLowerCase());
      }
    }
  });

  it("keeps flashcard backs, which are self-rated rather than graded", () => {
    for (const question of questions) {
      if (question.type !== "flashcard") continue;
      const pub = toPublic(question);
      expect(pub.type === "flashcard" && pub.back).toBe(question.back);
    }
  });
});
