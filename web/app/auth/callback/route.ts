import {
  authCallbackUrl,
  LOGIN_ERRORS,
  loginErrorPath,
  requestOrigin,
  safeNext,
  type LoginError,
} from "@/lib/auth-redirects";
import { createClient } from "@/lib/supabase/server";

/**
 * Google sign-in ends here (AUTH_CALLBACK_PATH in lib/auth-redirects.ts). Supabase Auth redirects
 * back with a one-time `code`, or with `error`, `error_code` and `error_description` when sign-in
 * was refused. Exchanging the code, with the PKCE verifier `signInWithGoogle` left in a cookie,
 * sets the session cookies; then the student goes on to `next`.
 *
 * A guest's Google account is linked to the guest, so that their deck stays theirs. When that
 * account turns out to have FigureQuiz already, the guest is signed in to it instead, as anyone
 * else choosing it would be.
 *
 * Every failure goes to /login with a message from LOGIN_ERRORS, never the provider's own words:
 * anyone can put words in this URL.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const next = safeNext(params.get("next"));

  if (params.get("error_code") === "identity_already_exists") {
    const signIn = await signInInstead(request, next);
    if (signIn) return seeOther(signIn);
  }
  if (params.has("error") || params.has("error_code")) {
    console.warn("Google sign-in was refused", {
      error: params.get("error"),
      code: params.get("error_code"),
      description: params.get("error_description"),
    });
    return seeOther(loginErrorPath(failure(params.get("error_code"), params.get("error")), next));
  }

  const code = params.get("code");
  if (!code) return seeOther(loginErrorPath(LOGIN_ERRORS.failed, next));

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("Google sign-in: the code exchange failed", error);
    return seeOther(loginErrorPath(failure(error.code), next));
  }

  return seeOther(next);
}

/**
 * Google again, to sign in to the account a guest's Google account already belongs to. The guest's
 * deck stays with the guest. Null when this isn't a guest (so it can't loop) or sign-in can't start.
 */
async function signInInstead(request: Request, next: string): Promise<string | null> {
  const origin = requestOrigin(request.headers);
  if (!origin) return null;
  const supabase = await createClient();
  const { data: session } = await supabase.auth.getClaims();
  if (session?.claims.is_anonymous !== true) return null;

  // PKCE again: this stores a new code verifier in a cookie for the next exchange.
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: authCallbackUrl(origin, next) },
  });
  if (error || !data.url) {
    console.error("Google sign-in: a guest's account exists, but signing in to it couldn't start", error);
    return null;
  }
  console.info("Google sign-in: a guest chose a Google account that has FigureQuiz; signing in to it");
  return data.url;
}

/**
 * A relative Location, which browsers resolve against this URL, so the redirect stays on whichever
 * host the callback came in on. The session cookies set by the exchange ride along, and no cache
 * may keep them.
 */
function seeOther(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { location, "cache-control": "no-store" },
  });
}

/** Supabase Auth's error code (or Google's bare `error`), as something a student can act on. */
function failure(code: string | null | undefined, error?: string | null): LoginError {
  switch (code) {
    case "signup_disabled":
      return LOGIN_ERRORS.signupsClosed;
    // A guest's Google account that has FigureQuiz, when signing in to it instead couldn't start.
    case "identity_already_exists":
      return LOGIN_ERRORS.identityTaken;
    // The code is single-use and short-lived, and its verifier lives in this browser's cookies.
    case "flow_state_expired":
    case "flow_state_not_found":
    case "bad_code_verifier":
    case "pkce_code_verifier_not_found":
      return LOGIN_ERRORS.expired;
  }
  // What Google says when the student backs out of its consent screen, passed on with no code.
  if (!code && error === "access_denied") return LOGIN_ERRORS.cancelled;
  return LOGIN_ERRORS.failed;
}
