import { pageName, type DocumentStatus, type QuestionType } from "@/lib/contracts";
import type { Deck, Desk, Found } from "@/lib/dal/documents";
import { megabytes, pageCount } from "@/lib/format";

/*
 * What the deck page's study desk says while a deck is made: which scene is on the desk, the
 * steps beside it, the handwritten line under them and the tags in its tray. Every word comes
 * from what has really been saved; nothing is staged.
 */

export type Scene = "waiting" | "reading" | "writing" | "ready";

/** How long a deck's page celebrates it being ready, for the student who watched it made. */
const FRESH_FOR_MS = 2 * 60 * 1000;

/**
 * Whether a deck became ready moments ago and hasn't been studied: its page then shows the desk's
 * fanned-out deck instead of the usual card. A ready deck's `updated_at` is when it became ready.
 */
export function justFinished(deck: Pick<Deck, "status" | "updated_at" | "progress">, now: Date): boolean {
  return (
    deck.status === "ready" &&
    (deck.progress?.questions ?? 0) > 0 &&
    deck.progress?.answered === 0 &&
    now.getTime() - Date.parse(deck.updated_at) < FRESH_FOR_MS
  );
}

/**
 * Waiting in the queue, reading (until the first question is saved, since what the pages hold is
 * known only once they are all read), writing, or just finished.
 */
export function deskScene(status: DocumentStatus, written: number): Scene {
  if (status === "queued") return "waiting";
  if (status === "ready") return "ready";
  return status === "generating" && written > 0 ? "writing" : "reading";
}

export type Step = { label: string; detail: string; state: "done" | "now" | "next" };

type DeckFacts = Pick<Deck, "status" | "mime" | "page_count" | "size_bytes">;

/** Uploaded, reading, writing, ready: each with what is known of it so far. */
export function deskSteps(deck: DeckFacts, written: number): Step[] {
  const pages = `${pageName(deck.mime)}s`;
  const reading = deck.status === "queued" || deck.status === "processing";
  const ready = deck.status === "ready";
  return [
    { label: "Uploaded", detail: megabytes(deck.size_bytes), state: "done" },
    reading
      ? { label: `Reading the ${pages}`, detail: deck.status === "queued" ? "in line" : "", state: "now" }
      : {
          label: `Read the ${pages}`,
          detail: deck.page_count === null ? "" : pageCount(deck.page_count, deck.mime),
          state: "done",
        },
    ready
      ? { label: "Wrote the questions", detail: String(written), state: "done" }
      : { label: "Writing questions", detail: written > 0 ? `${written} so far` : "", state: reading ? "next" : "now" },
    { label: "Ready to study", detail: "", state: ready ? "done" : "next" },
  ];
}

/** The handwritten line under the steps: what is happening right now. */
export function deskLine(deck: DeckFacts, desk: Desk): string {
  switch (deck.status) {
    case "queued":
      return "finding a free reader";
    case "processing":
      return `reading every ${pageName(deck.mime)}`;
    case "extracted":
      return `${deck.page_count === null ? "all" : pageCount(deck.page_count, deck.mime)} read, questions are next`;
    case "generating":
      if (desk.latest) return `writing “${desk.latest.title}”`;
      return desk.found.some((found) => found.kind === "diagram")
        ? "looking closely at the pictures"
        : "deciding what to ask";
    case "ready":
      return desk.written === 1 ? "your question is ready" : `all ${desk.written} questions are ready`;
    default:
      return "";
  }
}

/** What the picture check calls a picture it won't make a diagram question from. */
const SKIPPED: Record<Exclude<Found["verdict"], "labelled_diagram" | null>, string> = {
  screenshot: "screenshot",
  chart: "chart",
  photo: "photo",
  text: "picture of text",
  decoration: "decoration",
  plain_figure: "plain figure",
};

export type Tag = { text: string; short: string; skipped: boolean };

/**
 * A tag in the desk's tray: "p.8 labelled diagram", "slide 6 screenshot, skipped". `short` is the
 * phone's. A picture reads "picture" until its check says what it is.
 */
export function foundTag(found: Found, mime: string): Tag {
  const at = pageName(mime) === "slide" ? `slide ${found.page}` : `p.${found.page}`;
  if (found.kind === "table") return { text: `${at} table`, short: `${at} table`, skipped: false };
  if (found.verdict === null) return { text: `${at} picture`, short: `${at} picture`, skipped: false };
  if (found.verdict === "labelled_diagram") {
    return { text: `${at} labelled diagram`, short: `${at} diagram`, skipped: false };
  }
  return { text: `${at} ${SKIPPED[found.verdict]}, skipped`, short: `${at} skipped`, skipped: true };
}

/** The kind of question on the card being written. */
export const QUESTION_KIND: Record<QuestionType, string> = {
  diagram_blank: "Diagram",
  table_blank: "Table",
  mcq: "Multiple choice",
  short_answer: "Fill in the blank",
  flashcard: "Flashcard",
  essay: "Written answer",
};

/** Under "Start studying": studying asks diagrams, then tables, before anything else. */
export function firstUp(types: Desk["types"]): string | null {
  if (types.diagram_blank) return "The diagrams come first.";
  if (types.table_blank) return "The tables come first.";
  return null;
}
