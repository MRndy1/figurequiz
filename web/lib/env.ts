/**
 * Environment variables, read when first needed and checked with Zod.
 *
 * Nothing runs at import time, so `next build`, the tests and `/demo` need no env at all; a
 * missing or malformed variable fails only the request that needs it, naming the variable.
 * Each getter checks only its own variables. web/.env.example lists them all.
 *
 * Only `NEXT_PUBLIC_*` values may reach the browser. Next inlines those where the full name is
 * written out, which is why `supabaseEnv` spells each one; every other getter reads a value the
 * browser never receives, so calling it there fails instead of leaking.
 */

import { z } from "zod";

function memo<T>(read: () => T): () => T {
  let value: { current: T } | undefined;
  return () => (value ??= { current: read() }).current;
}

function parse<T>(schema: z.ZodType<T>, name: string, raw: string | undefined): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(`${name} ${raw ? "is invalid" : "is not set"}: see web/.env.example`);
  }
  return result.data;
}

/** The project URL and publishable key: public, and the only Supabase config the browser gets. */
export const supabaseEnv = memo(() => ({
  url: parse(z.url(), "NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  publishableKey: parse(
    z.string().startsWith("sb_publishable_"),
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ),
}));

/** Bypasses RLS. Server-only, through `createAdminClient`. */
export const supabaseSecretKey = memo(() =>
  parse(z.string().startsWith("sb_secret_"), "SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY),
);

export const openRouterApiKey = memo(() =>
  parse(z.string().min(1), "OPENROUTER_API_KEY", process.env.OPENROUTER_API_KEY),
);

/** Shared with the ingest worker, which sends it as a bearer token on every callback. */
export const ingestCallbackSecret = memo(() =>
  parse(z.string().min(32), "INGEST_CALLBACK_SECRET", process.env.INGEST_CALLBACK_SECRET),
);

/** New accounts are refused unless this is exactly "true". */
export const signupsEnabled = memo(() => process.env.SIGNUPS_ENABLED === "true");

/**
 * Cloudflare Turnstile's secret, which checks a visitor is human before a guest deck starts.
 * Optional: without it (or its site key, NEXT_PUBLIC_TURNSTILE_SITE_KEY) guest decks are off.
 */
export const turnstileSecretKey = memo(() => process.env.TURNSTILE_SECRET_KEY || null);

/** Generation starts no new model call once today's (UTC) spend reaches this many US dollars. */
export const dailyBudgetUsd = memo(() =>
  parse(z.coerce.number().positive(), "DAILY_BUDGET_USD", process.env.DAILY_BUDGET_USD),
);
