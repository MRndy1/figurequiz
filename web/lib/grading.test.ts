import { describe, expect, it } from "vitest";

import { editDistance, gradeBlank, gradeBlanks, normalize, similarity } from "./grading";

const nucleus = { number: 1, answer: "Nucleus", synonyms: ["cell nucleus"], confusables: ["nucleolus"] };
const membrane = { number: 2, answer: "Cell membrane", synonyms: ["plasma membrane"] };

describe("normalize", () => {
  it("lowercases, strips punctuation and collapses spaces", () => {
    expect(normalize("  The   Nucleus, ")).toBe("nucleus");
  });

  it("drops only a leading article", () => {
    expect(normalize("a cell membrane")).toBe("cell membrane");
    expect(normalize("antibody")).toBe("antibody");
  });
});

describe("similarity", () => {
  it("scores identical strings 1", () => {
    expect(similarity("nucleus", "nucleus")).toBe(1);
  });

  it("computes edit distance", () => {
    expect(editDistance("mitocondria", "mitochondria")).toBe(1);
  });
});

describe("gradeBlank", () => {
  it("accepts the exact answer", () => {
    expect(gradeBlank("Nucleus", nucleus)).toMatchObject({ correct: true, matched: "exact" });
  });

  it("accepts a stored synonym", () => {
    expect(gradeBlank("cell nucleus", nucleus)).toMatchObject({ correct: true, matched: "synonym" });
  });

  it("accepts a typo through fuzzy matching", () => {
    expect(gradeBlank("nucleas", nucleus)).toMatchObject({ correct: true, matched: "fuzzy" });
  });

  it("rejects a stored confusable even though it is close", () => {
    const result = gradeBlank("nucleolus", nucleus);
    expect(result).toMatchObject({ correct: false, rejectedAs: "confusable" });
  });

  it("rejects domain opposites that fuzzy matching would let through", () => {
    // Each of these scores above the 0.85 threshold against its pair.
    const pairs = [
      { answer: "afferent", wrong: "efferent" },
      { answer: "abduction", wrong: "adduction" },
      { answer: "hyperthyroidism", wrong: "hypothyroidism" },
    ];
    for (const { answer, wrong } of pairs) {
      expect(similarity(normalize(answer), normalize(wrong))).toBeGreaterThan(0.85);
      const result = gradeBlank(wrong, { number: 1, answer, confusables: [wrong] });
      expect(result).toMatchObject({ correct: false, rejectedAs: "confusable" });
    }
  });

  it("rejects another blank's answer from the same diagram", () => {
    const result = gradeBlank("Cell membrane", nucleus, [nucleus, membrane]);
    expect(result).toMatchObject({ correct: false, rejectedAs: "other-blank" });
  });

  it("rejects an empty response", () => {
    expect(gradeBlank("   ", nucleus)).toMatchObject({ correct: false, rejectedAs: "empty" });
  });

  it("rejects an unrelated word", () => {
    expect(gradeBlank("ribosome", nucleus)).toMatchObject({ correct: false, matched: null });
  });
});

describe("gradeBlanks", () => {
  it("grades every blank and treats a missing response as empty", () => {
    const results = gradeBlanks({ 1: "the nucleus" }, [nucleus, membrane]);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ correct: true, matched: "exact" });
    expect(results[1]).toMatchObject({ correct: false, rejectedAs: "empty" });
  });
});
