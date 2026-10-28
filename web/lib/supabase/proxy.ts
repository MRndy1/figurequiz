import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { supabaseEnv } from "@/lib/env";

/**
 * Refreshes the Supabase session before the route renders, for proxy.ts.
 *
 * Server Components can't set cookies, so an access token that expires mid-visit can only be
 * refreshed here; without it the rotated refresh token is never saved and the user is signed
 * out at random. This only refreshes: redirects to /login come from `requireUser()`, next to
 * the data it protects.
 */
export async function updateSession(request: NextRequest) {
  const { url, publishableKey } = supabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // On the request, so the page rendered after this sees the new session; on the
        // response, so the browser keeps it; and with the no-store headers Supabase sends, so
        // no cache serves one user's session to another.
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
      },
    },
  });

  // Nothing may run between creating the client and this call (Supabase's SSR guide): it is
  // what refreshes an expired token, and the response returned must be the one setAll built.
  await supabase.auth.getClaims();

  return response;
}
