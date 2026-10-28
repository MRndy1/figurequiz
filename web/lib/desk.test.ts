import { describe, expect, it } from "vitest";

import { PDF_MIME, PPTX_MIME } from "@/lib/contracts";
import type { Desk } from "@/lib/dal/documents";
import { deskLine, deskScene, deskSteps, firstUp, foundTag, justFinished } from "@/lib/desk";

const EMPTY: Desk = { found: [], written: 0, latest: null, types: {} };

/** The forensics chapter from the mockups: a 9-page PDF of 0.7 MB. */
const pdf = (status: Parameters<typeof deskScene>[0], pageCount: number | null = 9) => ({
  status,
  mime: PDF_MIME,
  page_count: pageCount,
  size_bytes: 734_003,
});

const steps = (deck: ReturnType<typeof pdf>, written = 0) =>
  deskSteps(deck, written).map(({ label, detail, state }) => `${label} | ${detail} | ${state}`);

describe("deskScene", () => {
  it("reads until the first question is saved, since what the pages hold is known only then", () => {
    expect(deskScene("queued", 0)).toBe("waiting");
    expect(deskScene("processing", 0)).toBe("reading");
    expect(deskScene("extracted", 0)).toBe("reading");
    expect(deskScene("generating", 0)).toBe("reading");
    expect(deskScene("generating", 1)).toBe("writing");
    expect(deskScene("ready", 15)).toBe("ready");
  });
});

describe("deskSteps", () => {
  it("says what is known of each step so far", () => {
    expect(steps(pdf("queued", null))).toEqual([
      "Uploaded | 0.7 MB | done",
      "Reading the pages | in line | now",
      "Writing questions |  | next",
      "Ready to study |  | next",
    ]);
    expect(steps(pdf("processing", null))[1]).toBe("Reading the pages |  | now");
    expect(steps(pdf("extracted")).slice(1, 3)).toEqual(["Read the pages | 9 pages | done", "Writing questions |  | now"]);
    expect(steps(pdf("generating"), 5)[2]).toBe("Writing questions | 5 so far | now");
    expect(steps(pdf("ready"), 15).slice(2)).toEqual(["Wrote the questions | 15 | done", "Ready to study |  | done"]);
  });

  it("calls a deck's pages slides", () => {
    const deck = { ...pdf("processing", null), mime: PPTX_MIME };
    expect(deskSteps(deck, 0)[1].label).toBe("Reading the slides");
    expect(deskSteps({ ...deck, status: "generating", page_count: 4 }, 0)[1].detail).toBe("4 slides");
  });
});

describe("deskLine", () => {
  it("says what is happening now, from what has been saved", () => {
    expect(deskLine(pdf("queued", null), EMPTY)).toBe("finding a free reader");
    expect(deskLine(pdf("processing", null), EMPTY)).toBe("reading every page");
    expect(deskLine(pdf("extracted", 1), EMPTY)).toBe("1 page read, questions are next");
    expect(deskLine(pdf("generating"), EMPTY)).toBe("deciding what to ask");

    const pictures: Desk = { ...EMPTY, found: [{ page: 8, kind: "diagram", verdict: null }] };
    expect(deskLine(pdf("generating"), pictures)).toBe("looking closely at the pictures");

    const latest = { id: "q", title: "Components of a hard disk drive", type: "diagram_blank" as const };
    expect(deskLine(pdf("generating"), { ...pictures, written: 3, latest })).toBe(
      "writing “Components of a hard disk drive”",
    );
  });

  it("counts the questions once they are ready", () => {
    expect(deskLine(pdf("ready"), { ...EMPTY, written: 15 })).toBe("all 15 questions are ready");
    expect(deskLine(pdf("ready"), { ...EMPTY, written: 1 })).toBe("your question is ready");
  });
});

describe("foundTag", () => {
  it("names a picture by what its check made of it, and says when it was skipped", () => {
    expect(foundTag({ page: 8, kind: "diagram", verdict: null }, PDF_MIME)).toEqual({
      text: "p.8 picture",
      short: "p.8 picture",
      skipped: false,
    });
    expect(foundTag({ page: 8, kind: "diagram", verdict: "labelled_diagram" }, PDF_MIME)).toEqual({
      text: "p.8 labelled diagram",
      short: "p.8 diagram",
      skipped: false,
    });
    expect(foundTag({ page: 6, kind: "diagram", verdict: "screenshot" }, PDF_MIME)).toEqual({
      text: "p.6 screenshot, skipped",
      short: "p.6 skipped",
      skipped: true,
    });
    expect(foundTag({ page: 2, kind: "diagram", verdict: "text" }, PDF_MIME).text).toBe(
      "p.2 picture of text, skipped",
    );
  });

  it("names tables, and a deck's slides", () => {
    expect(foundTag({ page: 4, kind: "table", verdict: null }, PPTX_MIME)).toEqual({
      text: "slide 4 table",
      short: "slide 4 table",
      skipped: false,
    });
  });
});

describe("firstUp", () => {
  it("says what studying starts with, when it isn't the text questions", () => {
    expect(firstUp({ mcq: 3, diagram_blank: 1, table_blank: 1 })).toBe("The diagrams come first.");
    expect(firstUp({ mcq: 3, table_blank: 1 })).toBe("The tables come first.");
    expect(firstUp({ mcq: 3, flashcard: 2 })).toBeNull();
  });
});

describe("justFinished", () => {
  const finishedAt = "2026-10-26T12:00:00Z";
  const progress = { questions: 15, answered: 0, lastAnsweredAt: null, types: { mcq: 15 }, coverUrl: null };
  const deck = { status: "ready" as const, updated_at: finishedAt, progress };
  const after = (seconds: number) => new Date(Date.parse(finishedAt) + seconds * 1000);

  it("celebrates a deck for the two minutes after it is ready, until it is studied", () => {
    expect(justFinished(deck, after(5))).toBe(true);
    expect(justFinished(deck, after(119))).toBe(true);
    expect(justFinished(deck, after(121))).toBe(false);
    expect(justFinished({ ...deck, progress: { ...progress, answered: 1 } }, after(5))).toBe(false);
  });

  it("never celebrates a deck with nothing to study, or one not ready", () => {
    expect(justFinished({ ...deck, progress: { ...progress, questions: 0 } }, after(5))).toBe(false);
    expect(justFinished({ ...deck, progress: null }, after(5))).toBe(false);
    expect(justFinished({ ...deck, status: "generating" }, after(5))).toBe(false);
  });
});
