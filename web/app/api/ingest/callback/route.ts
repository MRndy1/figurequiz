import { createHash, timingSafeEqual } from "node:crypto";

import { after } from "next/server";

import { IngestCallbackBody } from "@/lib/contracts";
import { ingestCallbackSecret } from "@/lib/env";
import { GENERATION_MS, runGeneration } from "@/lib/generation/run";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The ingest worker calls this once `complete_extract` has stored a document's assets
 * (INGEST_CALLBACK_PATH in web/lib/contracts.ts). It claims the document for generation and
 * answers at once; the questions are written after the response, so the worker never waits on
 * the model.
 *
 *   401  the bearer token is not INGEST_CALLBACK_SECRET
 *   400  the body is not {document_id}
 *   404  there is no such document
 *   409  the document hasn't been extracted yet
 *   202  claimed: generation starts now
 *   200  claimed earlier (generating, ready or failed): a repeated callback changes nothing
 */

/** Vercel Hobby's ceiling; generation stops itself well inside it (build plan, D-5). */
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const receivedAt = Date.now();
  if (!fromWorker(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "the body must be JSON" }, { status: 400 });
  }
  const parsed = IngestCallbackBody.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "the body must be {document_id}" }, { status: 400 });
  }
  const documentId = parsed.data.document_id;

  // One conditional update, so two callbacks racing for a document can't both claim it.
  const db = createAdminClient();
  const claim = await db
    .from("documents")
    .update({ status: "generating", error: null })
    .eq("id", documentId)
    .eq("status", "extracted")
    .select("id")
    .maybeSingle();
  if (claim.error) throw new Error(`could not claim document ${documentId}: ${claim.error.message}`);
  if (claim.data) {
    after(() => runGeneration(documentId, receivedAt + GENERATION_MS));
    return Response.json({ status: "generating" }, { status: 202 });
  }

  const current = await db.from("documents").select("status").eq("id", documentId).maybeSingle();
  if (current.error) throw new Error(`could not read document ${documentId}: ${current.error.message}`);
  if (!current.data) return Response.json({ error: "no such document" }, { status: 404 });
  const { status } = current.data;
  if (status === "generating" || status === "ready" || status === "failed") {
    return Response.json({ status }, { status: 200 });
  }
  return Response.json({ error: "the document hasn't been extracted yet", status }, { status: 409 });
}

/**
 * Compares SHA-256 digests rather than the strings: `timingSafeEqual` needs equal lengths, and
 * the digests are, so neither the secret's content nor its length leaks through timing.
 */
function fromWorker(authorization: string | null): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(authorization ?? ""), digest(`Bearer ${ingestCallbackSecret()}`));
}
