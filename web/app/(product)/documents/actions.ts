"use server";

import { after } from "next/server";
import { z } from "zod";

import { objectKeys, RENDERS_BUCKET, UPLOADS_BUCKET } from "@/lib/contracts";
import { requireUser } from "@/lib/dal/auth";
import { getBalance, OUT_OF_CREDITS } from "@/lib/dal/credits";
import { checkUpload, DELETABLE, getDocument, getUploadQuota } from "@/lib/dal/documents";
import { GENERATION_MS, runGeneration } from "@/lib/generation/run";
import { GUEST_DECKS } from "@/lib/guests";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * An upload is three steps, so the file goes from the browser straight to Storage and never
 * through a function (Vercel caps request bodies at 4.5 MB): `createUpload` checks the file
 * and signs an upload URL for it, the browser uploads to that URL, and `finalizeUpload` checks
 * the file arrived and queues it for the worker.
 *
 * Expected problems come back as `error`, worded for the student. Anything else throws, and
 * the form shows a generic message.
 */

export type UploadTicket =
  | {
      ok: true;
      documentId: string;
      path: string;
      token: string;
      /** The type to send the file as: the bucket refuses any other. */
      mime: string;
    }
  | { ok: false; error: string };

export type FinalizeResult = { ok: true } | { ok: false; error: string };

/** Every deck goes into one unit until units have a screen of their own. */
const DEFAULT_UNIT_NAME = "My unit";

const UploadRequest = z.object({ filename: z.string().trim(), size: z.number().int() });

export async function createUpload(request: { filename: string; size: number }): Promise<UploadTicket> {
  const user = await requireUser();
  const parsed = UploadRequest.safeParse(request);
  if (!parsed.success) return { ok: false, error: "That file couldn't be read. Choose it again." };
  const { filename, size } = parsed.data;

  const check = checkUpload(filename, size);
  if (!check.ok) return check;
  const problem = await quotaProblem();
  if (problem) return { ok: false, error: problem };
  if ((await getBalance()) < 1) return { ok: false, error: OUT_OF_CREDITS };
  if (user.isGuest && (await deckCount(user.id)) >= GUEST_DECKS) {
    return { ok: false, error: "Sign up free to add another deck. Trying as a guest covers one." };
  }
  const { mime } = check.type;

  const admin = createAdminClient();
  const unit = await admin
    .from("units")
    .upsert({ user_id: user.id, name: DEFAULT_UNIT_NAME }, { onConflict: "user_id,name" })
    .select("id")
    .single();
  if (unit.error) throw new Error(`createUpload: default unit: ${unit.error.message}`);

  const documentId = crypto.randomUUID();
  const path = objectKeys.upload(user.id, documentId, mime);
  const signed = await admin.storage.from(UPLOADS_BUCKET).createSignedUploadUrl(path);
  if (signed.error) throw new Error(`createUpload: signing ${path}: ${signed.error.message}`);

  const inserted = await admin.from("documents").insert({
    id: documentId,
    user_id: user.id,
    unit_id: unit.data.id,
    filename,
    mime,
    storage_path: path,
    size_bytes: size,
  });
  if (inserted.error) throw new Error(`createUpload: document row: ${inserted.error.message}`);

  return { ok: true, documentId, path: signed.data.path, token: signed.data.token, mime };
}

export async function finalizeUpload(documentId: string): Promise<FinalizeResult> {
  const user = await requireUser();
  // Read under RLS, so another user's document id is simply not found.
  const document = await getDocument(documentId);
  if (!document) return { ok: false, error: "That upload wasn't found. Upload the file again." };
  // Already queued, by a double submit or a retry: nothing left to do.
  if (document.status !== "uploading") return { ok: true };

  const admin = createAdminClient();
  const uploaded = await admin.storage
    .from(UPLOADS_BUCKET)
    .exists(objectKeys.upload(user.id, document.id, document.mime));
  if (!uploaded.data) {
    return { ok: false, error: "The file didn't finish uploading. Try again." };
  }

  // Checked again here, because this is what counts the upload: several uploads started
  // under the cap could otherwise all finish over it.
  const problem = await quotaProblem();
  if (problem) return { ok: false, error: problem };
  if ((await getBalance()) < 1) return { ok: false, error: OUT_OF_CREDITS };

  const queued = await admin.rpc("enqueue_extract", {
    document_id: document.id,
    user_id: user.id,
  });
  // P0002: the document is no longer waiting for its file, so a concurrent call queued it.
  if (queued.error && queued.error.code !== "P0002") {
    throw new Error(`finalizeUpload: enqueue_extract: ${queued.error.message}`);
  }
  return { ok: true };
}

async function quotaProblem(): Promise<string | null> {
  const quota = await getUploadQuota();
  return quota.left > 0 ? null : `You've used all ${quota.limit} uploads for this month.`;
}

/**
 * Writes questions for a deck's pages the credits didn't cover, or retries a deck whose
 * questions failed. Only a deck that was read can be: one that failed earlier has no pages to
 * write from, and is uploaded again instead. The run starts after the response, as the ingest
 * callback starts it, so the page's own maxDuration covers it.
 */
export async function finishDeck(documentId: string): Promise<FinalizeResult> {
  const user = await requireUser();
  const document = await getDocument(documentId);
  if (!document) return { ok: false, error: "That deck wasn't found." };
  if (document.page_count === null) {
    return { ok: false, error: "This deck was never read. Upload it again." };
  }
  if (document.status !== "failed" && !(document.status === "ready" && document.pages_waiting > 0)) {
    return { ok: true };
  }
  if ((await getBalance()) < 1) return { ok: false, error: OUT_OF_CREDITS };

  // One conditional update, so a double click can't start two runs.
  const claim = await createAdminClient()
    .from("documents")
    .update({ status: "generating", error: null })
    .eq("id", document.id)
    .eq("user_id", user.id)
    .in("status", ["ready", "failed"])
    .select("id")
    .maybeSingle();
  if (claim.error) throw new Error(`finishDeck: claiming ${document.id}: ${claim.error.message}`);
  if (claim.data) {
    const startedAt = Date.now();
    after(() => runGeneration(document.id, startedAt + GENERATION_MS));
  }
  return { ok: true };
}

/** Decks the user has started, counting uploads that never finished. */
async function deckCount(userId: string): Promise<number> {
  const { count, error } = await createAdminClient()
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error(`deckCount: ${error.message}`);
  return count ?? 0;
}

/**
 * Deletes one of the student's decks, and its questions, answers and files with it. The credits
 * it used and its model calls stay on record (their `document_id` is set null), so balances and
 * costs don't change. A deck being read or written can't be: see DELETABLE.
 */
export async function deleteDeck(documentId: string): Promise<FinalizeResult> {
  const user = await requireUser();
  if (!z.guid().safeParse(documentId).success) return { ok: false, error: "That deck wasn't found." };

  const admin = createAdminClient();
  // One statement, so the worker can't start reading the deck between the check and the delete.
  const deleted = await admin
    .from("documents")
    .delete()
    .eq("id", documentId)
    .eq("user_id", user.id)
    .in("status", DELETABLE)
    .select("storage_path")
    .maybeSingle();
  if (deleted.error) throw new Error(`deleteDeck: ${documentId}: ${deleted.error.message}`);
  if (!deleted.data) {
    // Gone already, by a second click: what the student asked for has happened.
    if (!(await getDocument(documentId))) return { ok: true };
    return { ok: false, error: "This deck is being made right now. Delete it once it's finished." };
  }

  await removeFiles(admin, user.id, documentId, deleted.data.storage_path);
  return { ok: true };
}

/**
 * A deleted deck's upload and renders. The deck is already gone, so a failure here is logged
 * for the operator rather than shown: the files are only orphaned, never reachable.
 */
async function removeFiles(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  documentId: string,
  uploadPath: string,
): Promise<void> {
  const renders = await Promise.all(
    objectKeys.renderFolders(userId, documentId).map(async (folder) => {
      // A deck holds at most 100 pages, and far fewer diagrams and questions than this.
      const { data, error } = await admin.storage.from(RENDERS_BUCKET).list(folder, { limit: 1000 });
      if (error) console.error(`deleteDeck: couldn't list ${folder}`, error);
      return (data ?? []).map((file) => `${folder}/${file.name}`);
    }),
  );
  const removals = [
    admin.storage.from(UPLOADS_BUCKET).remove([uploadPath]),
    ...(renders.flat().length > 0 ? [admin.storage.from(RENDERS_BUCKET).remove(renders.flat())] : []),
  ];
  for (const { error } of await Promise.all(removals)) {
    if (error) console.error(`deleteDeck: couldn't remove the files of ${documentId}`, error);
  }
}
