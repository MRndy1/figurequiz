import "server-only";

import { cache } from "react";
import { z } from "zod";

import {
  MAX_UPLOAD_BYTES,
  UPLOAD_TYPES,
  usagePeriodStart,
  type DocumentStatus,
  type QuestionType,
  type UploadType,
} from "@/lib/contracts";
import { requireUser } from "@/lib/dal/auth";
import { QUESTION_IMAGE_TTL_SECONDS, signRenders } from "@/lib/dal/storage";
import { megabytes } from "@/lib/format";
import { ImageCheckOutput } from "@/lib/schemas/generation";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/**
 * Decks one account may queue per UTC calendar month. `enqueue_extract` counts them in
 * `usage_counters.uploads_used`; generation costs money, so this is the per-user cap.
 */
export const MONTHLY_UPLOAD_LIMIT = 10;

const COLUMNS = "id, filename, mime, status, error, page_count, pages_waiting, size_bytes, updated_at";
const DECK_COLUMNS =
  `${COLUMNS}, deck_progress(questions, answered, last_answered_at, types, cover_image_path)` as const;

/** What the product pages show of a document: never its storage path or owner. */
export type DocumentSummary = Pick<
  Tables<"documents">,
  | "id"
  | "filename"
  | "mime"
  | "status"
  | "error"
  | "page_count"
  | "pages_waiting"
  | "size_bytes"
  | "updated_at"
>;

/** A deck as the product pages show it: the document, and its progress once it has questions. */
export type Deck = DocumentSummary & { progress: DeckProgress | null };

export type DeckProgress = {
  /** Ready questions. */
  questions: number;
  /** Ready questions the student has answered at least once. */
  answered: number;
  lastAnsweredAt: string | null;
  /** Ready questions of each type. */
  types: Partial<Record<QuestionType, number>>;
  /** The blanked image of the deck's first diagram, signed for its card. */
  coverUrl: string | null;
};

/**
 * The signed-in user's decks, newest first, with their progress (the `deck_progress` view).
 * Rows still `uploading` are left out: they are uploads that never finished, and a finished one
 * is `queued` before the form moves on.
 */
export async function listDecks(): Promise<Deck[]> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select(DECK_COLUMNS)
    .eq("user_id", user.id)
    .neq("status", "uploading")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Couldn't list documents: ${error.message}`);
  return withProgress(user.id, data);
}

/**
 * One of the signed-in user's decks, or null if it doesn't exist or isn't theirs, as getDocument
 * reads it. Cached for the request, so a page and its metadata read it once.
 */
export const getDeck = cache(async (id: string): Promise<Deck | null> => {
  const user = await requireUser();
  if (!z.guid().safeParse(id).success) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select(DECK_COLUMNS)
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(`Couldn't read document ${id}: ${error.message}`);
  return data ? ((await withProgress(user.id, [data]))[0] ?? null) : null;
});

type DeckRow = DocumentSummary & {
  deck_progress: Pick<
    Tables<"deck_progress">,
    "questions" | "answered" | "last_answered_at" | "types" | "cover_image_path"
  >[];
};

/** Rows with their `deck_progress` embedded, as Decks, each cover signed. */
async function withProgress(userId: string, data: DeckRow[]): Promise<Deck[]> {
  const covers = data.flatMap(({ deck_progress: [row] }) =>
    row?.cover_image_path ? [row.cover_image_path] : [],
  );
  const coverUrls = await signRenders(userId, covers, QUESTION_IMAGE_TTL_SECONDS);

  return data.map(({ deck_progress: [row], ...document }) => {
    if (!row) return { ...document, progress: null };
    const types: DeckProgress["types"] = {};
    for (const type of row.types ?? []) types[type] = (types[type] ?? 0) + 1;
    return {
      ...document,
      progress: {
        questions: row.questions ?? 0,
        answered: row.answered ?? 0,
        lastAnsweredAt: row.last_answered_at,
        types,
        coverUrl: row.cover_image_path ? (coverUrls.get(row.cover_image_path) ?? null) : null,
      },
    };
  });
}

/** What the deck page shows while a deck is being made, from what has been saved so far. */
export type Desk = {
  /** Diagram candidates and tables the pages held, in page order. Known once they are read. */
  found: Found[];
  /** Questions written so far, ready or still having their diagram blanked. */
  written: number;
  /** The newest of them. */
  latest: { id: string; title: string; type: QuestionType } | null;
  /** Written so far, of each type. */
  types: Partial<Record<QuestionType, number>>;
};

export type Found = {
  page: number;
  kind: "diagram" | "table";
  /** What the picture check made of a diagram candidate: null until it runs, and for tables. */
  verdict: ImageCheckOutput["kind"] | null;
};

/**
 * The desk of one of the signed-in user's decks. Assets are service-only, so they are read with
 * the service role, scoped to the user, and only their page, kind and verdict leave: never a
 * label's text.
 */
export async function getDesk(documentId: string): Promise<Desk> {
  const user = await requireUser();
  const [assets, questions] = await Promise.all([
    createAdminClient()
      .from("assets")
      .select("page, kind, picture_kind")
      .eq("user_id", user.id)
      .eq("document_id", documentId)
      .in("kind", ["labeled_diagram", "table"])
      .order("page"),
    (await createClient())
      .from("questions")
      .select("id, title, type")
      .eq("user_id", user.id)
      .eq("document_id", documentId)
      .neq("status", "failed")
      .order("created_at", { ascending: false }),
  ]);
  if (assets.error) throw new Error(`Couldn't read what document ${documentId} holds: ${assets.error.message}`);
  if (questions.error) throw new Error(`Couldn't read document ${documentId}'s questions: ${questions.error.message}`);
  return toDesk(assets.data, questions.data);
}

/** Rows as a Desk: `questions` newest first. */
export function toDesk(
  assets: Pick<Tables<"assets">, "page" | "kind" | "picture_kind">[],
  questions: Pick<Tables<"questions">, "id" | "title" | "type">[],
): Desk {
  const types: Desk["types"] = {};
  for (const { type } of questions) types[type] = (types[type] ?? 0) + 1;
  return {
    found: assets.flatMap(({ page, kind, picture_kind }): Found[] => {
      if (kind === "table") return [{ page, kind: "table", verdict: null }];
      if (kind !== "labeled_diagram") return [];
      const verdict = ImageCheckOutput.shape.kind.safeParse(picture_kind);
      return [{ page, kind: "diagram", verdict: verdict.success ? verdict.data : null }];
    }),
    written: questions.length,
    latest: questions[0] ?? null,
    types,
  };
}

/**
 * The deck to carry on with: the one studied most recently that still has questions left, else
 * the newest one not started. None when every ready deck is finished.
 */
export function deckToContinue(decks: Deck[]): Deck | undefined {
  const open = decks.filter(
    (deck) => deck.status === "ready" && deck.progress && deck.progress.answered < deck.progress.questions,
  );
  const started = open
    .filter((deck) => deck.progress?.lastAnsweredAt)
    .sort((a, b) => Date.parse(b.progress?.lastAnsweredAt ?? "") - Date.parse(a.progress?.lastAnsweredAt ?? ""));
  return started[0] ?? open[0];
}

/**
 * One of the signed-in user's documents, or null if it doesn't exist or isn't theirs — RLS
 * hides other users' rows, so both are the same 404. Cached for the request, so a page and its
 * metadata read it once.
 */
export const getDocument = cache(async (id: string): Promise<DocumentSummary | null> => {
  const user = await requireUser();
  if (!z.guid().safeParse(id).success) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select(COLUMNS)
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(`Couldn't read document ${id}: ${error.message}`);
  return data;
});

export type UploadQuota = { used: number; limit: number; left: number };

export async function getUploadQuota(): Promise<UploadQuota> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("usage_counters")
    .select("uploads_used")
    .eq("user_id", user.id)
    .eq("period_start", usagePeriodStart(new Date()))
    .maybeSingle();
  if (error) throw new Error(`Couldn't read upload usage: ${error.message}`);

  const used = data?.uploads_used ?? 0;
  return { used, limit: MONTHLY_UPLOAD_LIMIT, left: Math.max(0, MONTHLY_UPLOAD_LIMIT - used) };
}

export type UploadCheck = { ok: true; type: UploadType } | { ok: false; error: string };

/**
 * Whether a file can be uploaded, and as which type, going by its name; if not, why, in words a
 * student can act on. The worker still checks that the file really is what its name says.
 */
export function checkUpload(filename: string, size: number): UploadCheck {
  const extension = /\.([^.]+)$/.exec(filename)?.[1]?.toLowerCase();
  const type = UPLOAD_TYPES.find((candidate) => candidate.extension === extension);
  if (!type) {
    if (extension === "ppt") {
      return refused("That's an older .ppt file. Open it in PowerPoint, save it as .pptx, and upload that.");
    }
    return refused(
      "Only PowerPoint decks (.pptx) and PDFs can be uploaded. Export the file as a PDF, and upload that.",
    );
  }
  if (filename.length > 255) return refused("That file name is too long. Shorten it and try again.");
  if (size <= 0) return refused("That file is empty.");
  if (size > MAX_UPLOAD_BYTES) {
    return refused(`That file is ${megabytes(size)}. Files can be up to ${megabytes(MAX_UPLOAD_BYTES)}.`);
  }
  return { ok: true, type };
}

function refused(error: string): UploadCheck {
  return { ok: false, error };
}

/**
 * Statuses a deck can be deleted in: nothing is reading or writing it. A queued deck's job is
 * dropped when the worker finds the deck gone; one being read or written can't be deleted, since
 * its run holds credits it couldn't give back.
 */
export const DELETABLE = ["uploading", "queued", "ready", "failed"] as const satisfies DocumentStatus[];

export function canDelete(status: DocumentStatus): boolean {
  return (DELETABLE as readonly DocumentStatus[]).includes(status);
}

/*
 * How long a document may sit in one stage before its page says it's stuck. `updated_at`
 * changes with every status change, so it says when the current stage began.
 */
const STALLED_AFTER_SECONDS: Partial<Record<DocumentStatus, number>> = {
  // A running worker claims a job within seconds, so a minute in the queue means none is.
  queued: 60,
  // A claim stays hidden this long; if the worker died, the job is back in the queue by then.
  processing: 600,
  // Generation starts as soon as the worker's callback arrives.
  extracted: 120,
  // Generation stops itself after 240 s.
  generating: 300,
};

export function isStalled(document: Pick<DocumentSummary, "status" | "updated_at">, now: Date) {
  const limit = STALLED_AFTER_SECONDS[document.status];
  return limit !== undefined && now.getTime() - Date.parse(document.updated_at) > limit * 1000;
}
