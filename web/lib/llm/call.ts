import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

import { llmClient } from "./client";
import { ROUTES, type RouteName } from "./routes";

/**
 * One structured call to Claude: the route's frozen system prompt, one user turn, and a JSON reply
 * checked against a Zod schema (CLAUDE.md: structured outputs, no prompt-only JSON).
 *
 * The SDK's `messages.parse` would throw on a refused or cut-off reply before its usage could be
 * logged, so this sends the same Zod-derived format through `messages.create`, logs the call, and
 * only then reads the reply. Every response is logged to `llm_requests` with OpenRouter's own
 * dollar cost (build plan, D-7), whatever became of it.
 */

export type StructuredRequest<T> = {
  route: RouteName;
  /** The route's frozen system prompt: the cached prefix, identical on every call. */
  system: string;
  /** What varies (one slide's input), after the cache breakpoint. */
  content: string;
  /** A picture to look at, sent before `content`: base64, as the Messages API takes it. */
  image?: Picture;
  /** Sent as the output format, and checked again on the way back. */
  schema: z.ZodType<T>;
  /** The document's owner and the document, for `llm_requests`. */
  userId: string;
  documentId: string;
  /** Aborts the call, retries included: generation's deadline. */
  signal?: AbortSignal;
};

export type Picture = { mediaType: Anthropic.Base64ImageSource["media_type"]; data: string };

/** Why a reply produced nothing: Claude declined, ran out of tokens, or broke the schema. */
export type CallFailure = "refusal" | "max_tokens" | "invalid";

type Reply<T> = { ok: true; output: T } | { ok: false; failure: CallFailure; detail: string };

export type StructuredResult<T> = Reply<T> & { costUsd: number };

export type CallStructured = <T>(request: StructuredRequest<T>) => Promise<StructuredResult<T>>;

/**
 * OpenRouter's provider routing, which the SDK forwards like any other field: Anthropic only, so
 * cache hits and request semantics stay the same from one call to the next (CLAUDE.md).
 */
type OpenRouterParams = Anthropic.MessageCreateParamsNonStreaming & {
  provider: { only: string[]; allow_fallbacks: boolean };
};

export const callStructured: CallStructured = async (request) => {
  const route = ROUTES[request.route];
  const params: OpenRouterParams = {
    model: route.model,
    max_tokens: route.maxTokens,
    system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent(request) }],
    output_config: { effort: route.effort, format: zodOutputFormat(request.schema) },
    provider: { only: ["anthropic"], allow_fallbacks: false },
  };
  const message = await llmClient().messages.create(params, { signal: request.signal });
  const costUsd = await logRequest(request, message);
  const reply = readReply(message, request.schema);
  if (!reply.ok) {
    console.warn(`llm: ${request.route} response ${message.id}: ${reply.failure} (${reply.detail})`);
  }
  return { ...reply, costUsd };
};

/** The user turn: the text alone, or the picture first and then the text. Exported for tests. */
export function userContent(
  request: Pick<StructuredRequest<unknown>, "content" | "image">,
): string | Anthropic.ContentBlockParam[] {
  if (!request.image) return request.content;
  return [
    { type: "image", source: { type: "base64", media_type: request.image.mediaType, data: request.image.data } },
    { type: "text", text: request.content },
  ];
}

/** A finished response's reply, checked against the schema. Exported for tests. */
export function readReply<T>(
  message: Pick<Anthropic.Message, "stop_reason" | "stop_details" | "content">,
  schema: z.ZodType<T>,
): Reply<T> {
  if (message.stop_reason === "refusal") {
    return { ok: false, failure: "refusal", detail: message.stop_details?.category ?? "uncategorized" };
  }
  if (message.stop_reason === "max_tokens") {
    return { ok: false, failure: "max_tokens", detail: "the reply was cut off" };
  }
  const text = message.content.find((block): block is Anthropic.TextBlock => block.type === "text");
  if (message.stop_reason !== "end_turn" || !text) {
    return { ok: false, failure: "invalid", detail: `stopped on ${message.stop_reason}` };
  }

  let json: unknown;
  try {
    json = JSON.parse(text.text);
  } catch {
    return { ok: false, failure: "invalid", detail: "the reply is not JSON" };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, failure: "invalid", detail: `${issue.path.join(".")}: ${issue.message}` };
  }
  return { ok: true, output: parsed.data };
}

/** OpenRouter adds what the call cost, in US dollars, to the usage it returns. */
const OpenRouterUsage = z.object({ cost: z.number().min(0) });

/** A response's cost, or null when OpenRouter sent none. Exported for tests. */
export function reportedCost(usage: unknown): number | null {
  const parsed = OpenRouterUsage.safeParse(usage);
  return parsed.success ? parsed.data.cost : null;
}

/**
 * One `llm_requests` row per response. `input_tokens` is the uncached remainder: the whole prompt
 * is input + cache read + cache write tokens. A failed insert costs the row, never the questions.
 */
async function logRequest(
  request: Pick<StructuredRequest<unknown>, "route" | "userId" | "documentId">,
  message: Anthropic.Message,
): Promise<number> {
  const { usage } = message;
  const cost = reportedCost(usage);
  if (cost === null) console.error(`llm: response ${message.id} carried no usage.cost; logged as 0`);

  const { error } = await createAdminClient()
    .from("llm_requests")
    .insert({
      user_id: request.userId,
      document_id: request.documentId,
      route: request.route,
      model: ROUTES[request.route].model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_tokens: usage.cache_read_input_tokens ?? 0,
      cache_write_tokens: usage.cache_creation_input_tokens ?? 0,
      cost_usd: cost ?? 0,
      stop_reason: message.stop_reason,
      provider_request_id: message.id,
    });
  if (error) console.error(`llm: could not log response ${message.id}: ${error.message}`);
  return cost ?? 0;
}
