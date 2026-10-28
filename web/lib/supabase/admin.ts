import "server-only";

import { createClient } from "@supabase/supabase-js";

import { supabaseEnv, supabaseSecretKey } from "@/lib/env";

import type { Database } from "./database.types";

/**
 * Supabase with the secret key: it bypasses RLS, reads answer keys and assets, signs Storage
 * URLs and calls the job functions. Nothing here checks who the user is, so call it only after
 * `requireUser()` and an explicit ownership check — or from the ingest callback, which has
 * checked the worker's secret.
 */
export function createAdminClient() {
  return createClient<Database>(supabaseEnv().url, supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
