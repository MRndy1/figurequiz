import { createBrowserClient } from "@supabase/ssr";

import { supabaseEnv } from "@/lib/env";

import type { Database } from "./database.types";

/**
 * Supabase in the browser, with the publishable key and the user's session cookies. RLS lets
 * it read the user's own rows and nothing else; in practice the browser uses it only for auth
 * and for uploading to a signed upload URL a Server Action created.
 */
export function createClient() {
  const { url, publishableKey } = supabaseEnv();
  return createBrowserClient<Database>(url, publishableKey);
}
