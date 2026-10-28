import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { supabaseEnv } from "@/lib/env";

import type { Database } from "./database.types";

/**
 * Supabase as the signed-in user, for Server Components, Server Actions and route handlers.
 * The session comes from the request's cookies and every query runs under RLS, so this client
 * can read the user's own rows and write nothing. Writes go through `createAdminClient`.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = supabaseEnv();

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // A Server Component can't set cookies. proxy.ts refreshes the session instead.
        }
      },
    },
  });
}
