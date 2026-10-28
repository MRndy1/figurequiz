import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export type SessionUser = {
  id: string;
  email: string | null;
  /** A guest trying FigureQuiz without an account (a Supabase anonymous user). */
  isGuest: boolean;
};

/**
 * The signed-in user, or a redirect to /login.
 *
 * `getClaims()` verifies the session token's signature (locally, against the project's
 * published signing keys), so unlike `getSession()` a forged cookie can't pass. Cached for the
 * request, so a layout, its page and their actions can all call it.
 */
export const requireUser = cache(async (): Promise<SessionUser> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims) redirect("/login");

  return {
    id: claims.sub,
    email: typeof claims.email === "string" && claims.email ? claims.email : null,
    isGuest: claims.is_anonymous === true,
  };
});
