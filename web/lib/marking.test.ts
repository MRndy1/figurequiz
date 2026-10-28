import { beforeEach, describe, expect, it, vi } from "vitest";

import { recordAttempt } from "@/lib/dal/questions";
import type { CallStructured } from "@/lib/llm/call";

import { MARKING_FAILURES, markEssayAnswer, toMarking } from "./marking";

/* Marking with a fake model and a fake database: what is spent, refunded and stored. */

vi.mock("@/lib/dal/questions", () => ({ recordAttempt: vi.fn(async () => undefined) }));
vi.mock("@/lib/llm/budget", () => ({ spentTodayUsd: vi.fn(async () => 0) }));
vi.mock("@/lib/env", () => ({ dailyBudgetUsd: () => 1 }));

const USER = { id: "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f", email: "student@example.com", isGuest: false };
const SPEND = "5e551011-0000-4000-8000-000000000000";

const QUESTION = {
  id: "c4d5e6f7-0819-4a2b-8c3d-4e5f60718293",
  type: "essay" as const,
  prompt: "Explain how the cerebrum divides its work between its lobes.",
  documentId: "0b7e3c1a-2d4f-4e6a-9b8c-7d6e5f4a3b2c",
  slide: { path: "u/d/pages/4.png", filename: "deck-slide-4.png" },
  key: {
    rubric: [
      { criterion: "Names three lobes", points: 2 },
      { criterion: "Gives each lobe's job", points: 3 },
    ],
    model_answer: "The frontal lobe decides, the parietal lobe feels, the occipital lobe sees.",
  },
};

const MARKED = {
  criteria: [
    { feedback: "All three named.", points: 2 },
    { feedback: "Two jobs right; the parietal lobe handles touch.", points: 2 },
  ],
  comment: "Nearly there.",
};

/** A database whose credit functions answer as told, recording each call. */
function fakeDb(spend: string | null) {
  const calls: [string, unknown][] = [];
  const db = {
    rpc: async (name: string, args: unknown) => {
      calls.push([name, args]);
      return { data: name === "spend_marking" ? spend : null, error: null };
    },
  };
  return { calls, db: db as unknown as NonNullable<Parameters<typeof markEssayAnswer>[3]>["db"] };
}

/** A model that marks every answer with `output`. */
const replying =
  (output: unknown): CallStructured =>
  async (request) => ({ ok: true, output: request.schema.parse(output), costUsd: 0.01 });

beforeEach(() => {
  vi.mocked(recordAttempt).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("markEssayAnswer", () => {
  it("spends the credits, marks the answer and stores how", async () => {
    const { calls, db } = fakeDb(SPEND);
    const call = replying(MARKED);

    const marked = await markEssayAnswer(USER, QUESTION, "The frontal lobe decides.", { call, db });

    expect(marked).toEqual({ ok: true, marking: expect.objectContaining({ points: 4, outOf: 5 }) });
    expect(calls).toEqual([["spend_marking", { question_id: QUESTION.id, amount: 2 }]]);
    // Four of five points is more than half: answered right.
    expect(recordAttempt).toHaveBeenCalledWith(
      USER,
      QUESTION.id,
      { text: "The frontal lobe decides." },
      true,
      expect.objectContaining({ points: 4, comment: "Nearly there." }),
    );
  });

  it("says so when the credits don't cover marking, and asks nothing", async () => {
    const { db } = fakeDb(null);
    let asked = false;
    const call: CallStructured = (request) => {
      asked = true;
      return replying(MARKED)(request);
    };

    expect(await markEssayAnswer(USER, QUESTION, "An answer.", { call, db })).toEqual({
      ok: false,
      error: MARKING_FAILURES.credits,
      topUp: true,
    });
    expect(asked).toBe(false);
  });

  it("gives the credits back whenever the answer isn't marked", async () => {
    const failures: [string, CallStructured][] = [
      ["a refusal", async () => ({ ok: false, failure: "refusal", detail: "general_harms", costUsd: 0.001 })],
      ["a reply that doesn't fit the rubric", replying({ criteria: [], comment: "" })],
      ["a failed call", () => Promise.reject(new Error("OpenRouter is down"))],
    ];
    for (const [why, call] of failures) {
      const { calls, db } = fakeDb(SPEND);
      expect(await markEssayAnswer(USER, QUESTION, "An answer.", { call, db }), why).toEqual({
        ok: false,
        error: MARKING_FAILURES.failed,
      });
      expect(calls.map(([name]) => name), why).toEqual(["spend_marking", "refund_marking"]);
      expect(calls[1][1], why).toEqual({ spend_id: SPEND });
    }
    expect(recordAttempt).not.toHaveBeenCalled();
  });
});

describe("toMarking", () => {
  it("holds each criterion's points to what it is worth", () => {
    const marking = toMarking(QUESTION.key.rubric, {
      criteria: [
        { feedback: "Generous.", points: 5 },
        { feedback: "Odd.", points: -1 },
      ],
      comment: " Fine. ",
    });
    expect(marking).toEqual({
      criteria: [
        { criterion: "Names three lobes", points: 2, outOf: 2, feedback: "Generous." },
        { criterion: "Gives each lobe's job", points: 0, outOf: 3, feedback: "Odd." },
      ],
      points: 2,
      outOf: 5,
      comment: "Fine.",
    });
  });
});
