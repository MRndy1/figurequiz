import { describe, expect, it } from "vitest";

import { MAX_UPLOAD_BYTES, PDF_MIME, PPTX_MIME } from "@/lib/contracts";
import { checkUpload, deckToContinue, isStalled, toDesk, type Deck } from "@/lib/dal/documents";

/** The reason a file is refused, or null when it is accepted. */
const problem = (filename: string, size: number) => {
  const check = checkUpload(filename, size);
  return check.ok ? null : check.error;
};

describe("checkUpload", () => {
  it("accepts a deck or a PDF within the limit, whatever the extension's case", () => {
    expect(checkUpload("Lecture 4.pptx", 180_276)).toEqual({
      ok: true,
      type: { extension: "pptx", mime: PPTX_MIME },
    });
    expect(checkUpload("LECTURE.PPTX", MAX_UPLOAD_BYTES)).toMatchObject({ ok: true });
    expect(checkUpload("Week 4 notes.pdf", 2_400_000)).toEqual({
      ok: true,
      type: { extension: "pdf", mime: PDF_MIME },
    });
    expect(checkUpload("SCAN.PDF", MAX_UPLOAD_BYTES)).toMatchObject({ ok: true, type: { mime: PDF_MIME } });
  });

  it("says what to do with the files students most often have instead", () => {
    expect(problem("old-deck.ppt", 1000)).toMatch(/save it as \.pptx/);
    expect(problem("talk.key", 1000)).toMatch(/Only PowerPoint decks \(\.pptx\) and PDFs/);
    expect(problem("essay.docx", 1000)).toMatch(/Export the file as a PDF/);
    expect(problem("pptx", 1000)).toMatch(/Only PowerPoint decks \(\.pptx\) and PDFs/);
    expect(problem("notes.pdf.zip", 1000)).toMatch(/Only PowerPoint decks \(\.pptx\) and PDFs/);
  });

  it("refuses a file over the bucket's limit, giving both sizes", () => {
    expect(problem("big.pptx", MAX_UPLOAD_BYTES + 1)).toBe("That file is 50 MB. Files can be up to 50 MB.");
    expect(problem("huge.pdf", 51 * 1024 * 1024)).toBe("That file is 51 MB. Files can be up to 50 MB.");
  });

  it("refuses empty files and names the database can't store", () => {
    expect(problem("empty.pptx", 0)).toBe("That file is empty.");
    expect(problem("empty.pdf", 0)).toBe("That file is empty.");
    expect(problem(`${"x".repeat(251)}.pptx`, 1000)).toMatch(/name is too long/);
    expect(problem(`${"x".repeat(252)}.pdf`, 1000)).toMatch(/name is too long/);
  });
});


describe("isStalled", () => {
  const now = new Date("2026-10-26T04:30:00Z");
  const since = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();

  it("flags a deck no worker has claimed after a minute", () => {
    expect(isStalled({ status: "queued", updated_at: since(59) }, now)).toBe(false);
    expect(isStalled({ status: "queued", updated_at: since(61) }, now)).toBe(true);
  });

  it("gives each stage its own allowance", () => {
    expect(isStalled({ status: "processing", updated_at: since(300) }, now)).toBe(false);
    expect(isStalled({ status: "generating", updated_at: since(301) }, now)).toBe(true);
  });

  it("never flags a finished or failed deck", () => {
    expect(isStalled({ status: "ready", updated_at: since(86_400) }, now)).toBe(false);
    expect(isStalled({ status: "failed", updated_at: since(86_400) }, now)).toBe(false);
  });

  it("reads timestamps as PostgREST sends them, with microseconds", () => {
    const queuedAt = "2026-10-26T04:28:00.123456+00:00";
    expect(isStalled({ status: "queued", updated_at: queuedAt }, now)).toBe(true);
  });
});

describe("deckToContinue", () => {
  /** Newest first, as listDecks returns them. */
  const deck = (id: string, status: Deck["status"], answered = 0, lastAnsweredAt: string | null = null): Deck => ({
    id,
    filename: `${id}.pptx`,
    mime: PPTX_MIME,
    status,
    error: null,
    page_count: 4,
    pages_waiting: 0,
    size_bytes: 1000,
    updated_at: "2026-10-26T00:00:00Z",
    progress:
      status === "ready"
        ? { questions: 10, answered, lastAnsweredAt, types: { mcq: 10 }, coverUrl: null }
        : null,
  });

  it("carries on with the deck studied most recently, not the newest", () => {
    const decks = [
      deck("new", "ready"),
      deck("monday", "ready", 3, "2026-10-19T09:00:00Z"),
      deck("friday", "ready", 5, "2026-10-23T09:00:00Z"),
    ];
    expect(deckToContinue(decks)?.id).toBe("friday");
  });

  it("starts the newest deck when none has been studied", () => {
    expect(deckToContinue([deck("newer", "ready"), deck("older", "ready")])?.id).toBe("newer");
  });

  it("passes over finished, failed and still-processing decks", () => {
    const decks = [
      deck("reading", "processing"),
      deck("broken", "failed"),
      deck("finished", "ready", 10, "2026-10-25T09:00:00Z"),
      deck("open", "ready", 2, "2026-10-01T09:00:00Z"),
    ];
    expect(deckToContinue(decks)?.id).toBe("open");
    expect(deckToContinue(decks.slice(0, 3))).toBeUndefined();
  });
});

describe("toDesk", () => {
  it("lists what the pages held in page order, each picture with its check's verdict", () => {
    const desk = toDesk(
      [
        { page: 3, kind: "labeled_diagram", picture_kind: null },
        { page: 4, kind: "table", picture_kind: null },
        { page: 6, kind: "labeled_diagram", picture_kind: "screenshot" },
        // A verdict this code doesn't know reads as not checked yet.
        { page: 7, kind: "labeled_diagram", picture_kind: "painting" },
        { page: 8, kind: "text_block", picture_kind: null },
      ],
      [
        { id: "q3", title: "Components of a hard disk drive", type: "diagram_blank" },
        { id: "q2", title: "Role of a file system", type: "mcq" },
        { id: "q1", title: "Where the bootstrap lives", type: "mcq" },
      ],
    );
    expect(desk).toEqual({
      found: [
        { page: 3, kind: "diagram", verdict: null },
        { page: 4, kind: "table", verdict: null },
        { page: 6, kind: "diagram", verdict: "screenshot" },
        { page: 7, kind: "diagram", verdict: null },
      ],
      written: 3,
      latest: { id: "q3", title: "Components of a hard disk drive", type: "diagram_blank" },
      types: { diagram_blank: 1, mcq: 2 },
    });
  });

  it("is empty before anything is read", () => {
    expect(toDesk([], [])).toEqual({ found: [], written: 0, latest: null, types: {} });
  });
});
