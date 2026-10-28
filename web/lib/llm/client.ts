import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { openRouterApiKey } from "@/lib/env";

/** OpenRouter's Anthropic-compatible Messages API; the SDK appends `/v1/messages`. */
const OPENROUTER_BASE_URL = "https://openrouter.ai/api";

let client: Anthropic | undefined;

/**
 * The Anthropic SDK pointed at OpenRouter: the same request shape, with OpenRouter's key and
 * model slugs. Built on first use, so importing this needs no env. Timeout and retries apply to
 * each attempt; callers bound the whole call, retries included, with an abort signal.
 */
export function llmClient(): Anthropic {
  client ??= new Anthropic({
    baseURL: OPENROUTER_BASE_URL,
    apiKey: openRouterApiKey(),
    authToken: null,
    timeout: 120_000,
    maxRetries: 2,
  });
  return client;
}
