"use server";

import type { AuthError } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  authCallbackUrl,
  LOGIN_ERRORS,
  loginErrorPath,
  requestOrigin,
  safeNext,
} from "@/lib/auth-redirects";
import { signupsEnabled, supabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/** What the sign-in and sign-up forms show after a submit. The email is kept; never the password. */
export type AuthFormState = { email?: string; error?: string; notice?: string };

const SIGNUPS_CLOSED = "New accounts can't be created right now.";

const Credentials = z.object({
  email: z.string().trim().pipe(z.email()),
  password: z.string().min(1),
});

/** Supabase's own minimum (supabase/config.toml) is 8 too; this says so before asking it. */
const NewAccount = Credentials.extend({ password: z.string().min(8) });

export async function signIn(_state: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = String(form.get("email") ?? "");
  const parsed = Credentials.safeParse({ email, password: form.get("password") });
  if (!parsed.success) return { email, error: "Enter your email address and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { email, error: describe(error) };

  redirect("/dashboard");
}

export async function signUp(_state: AuthFormState, form: FormData): Promise<AuthFormState> {
  if (!signupsEnabled()) return { error: SIGNUPS_CLOSED };
  const next = safeNext(form.get("next"));

  const email = String(form.get("email") ?? "");
  const parsed = NewAccount.safeParse({ email, password: form.get("password") });
  if (!parsed.success) {
    const badEmail = parsed.error.issues.some((issue) => issue.path[0] === "email");
    return {
      email,
      error: badEmail
        ? "That email address doesn't look right."
        : "Choose a password of at least 8 characters.",
    };
  }

  const supabase = await createClient();

  // A guest signs up by giving their own user an email and password, so their deck stays theirs.
  // The database tops their credits up to 100 when the guest becomes an account.
  if (await isGuest(supabase)) {
    const { data, error } = await supabase.auth.updateUser(parsed.data);
    if (error) return { email, error: describe(error) };
    if (data.user.is_anonymous) {
      return { email, notice: "Check your inbox: confirm your email address to keep your deck." };
    }
    // The session's token still says guest until it's replaced, which keeps their deck locked.
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error) console.error("A guest signed up, but their session didn't refresh", refreshed.error);
    redirect(next);
  }

  const { data, error } = await supabase.auth.signUp(parsed.data);
  if (error) return { email, error: describe(error) };
  // No session means the project asks new users to confirm their email first.
  if (!data.session) {
    return { email, notice: "Check your inbox: confirm your email address, then sign in." };
  }

  redirect(next);
}

/** Whether this session is a guest trying FigureQuiz (a Supabase anonymous user). */
async function isGuest(supabase: Awaited<ReturnType<typeof createClient>>): Promise<boolean> {
  const { data } = await supabase.auth.getClaims();
  return data?.claims.is_anonymous === true;
}

/**
 * "Continue with Google": sends the browser to Google through Supabase Auth, which brings it back
 * to /auth/callback on the host it started from (the redirect allow-list names each one). Every
 * failure comes back to /login with a message from LOGIN_ERRORS.
 */
export async function signInWithGoogle(form: FormData): Promise<void> {
  const next = safeNext(form.get("next"));
  const origin = requestOrigin(await headers());
  if (!origin) {
    console.error("Google sign-in: the request names no usable host");
    redirect(loginErrorPath(LOGIN_ERRORS.failed, next));
  }
  // Supabase answers a switched-off provider with bare JSON on its own domain, so ask first.
  if ((await googleProviderEnabled()) === false) {
    redirect(loginErrorPath(LOGIN_ERRORS.unavailable, next));
  }

  // PKCE: this also stores the code verifier in a cookie, which the callback needs to finish.
  // A guest links Google to their own user instead, so their deck stays theirs; a Google account
  // that already has FigureQuiz comes back to the callback as `identity_already_exists`, and the
  // callback signs in to it.
  const supabase = await createClient();
  const options = { redirectTo: authCallbackUrl(origin, next) };
  const { data, error } = (await isGuest(supabase))
    ? await supabase.auth.linkIdentity({ provider: "google", options })
    : await supabase.auth.signInWithOAuth({ provider: "google", options });
  if (error || !data.url) {
    console.error("Google sign-in could not start", error);
    redirect(loginErrorPath(LOGIN_ERRORS.failed, next));
  }

  redirect(data.url);
}

const AuthSettings = z.object({ external: z.object({ google: z.boolean() }) });

/**
 * Whether the Supabase project has Google switched on, from Auth's public settings; null when
 * that can't be told, and then sign-in goes ahead, because this check only improves the message.
 */
async function googleProviderEnabled(): Promise<boolean | null> {
  const { url, publishableKey } = supabaseEnv();
  try {
    const response = await fetch(new URL("auth/v1/settings", `${url.replace(/\/+$/, "")}/`), {
      headers: { apikey: publishableKey },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const settings = AuthSettings.safeParse(await response.json());
    return settings.success ? settings.data.external.google : null;
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  // This device only: signing out on a lab computer shouldn't sign you out of your phone.
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) console.error("Sign-out failed", error);
  redirect("/login");
}

/** Supabase Auth's error, in words a student can act on. */
function describe(error: AuthError): string {
  switch (error.code) {
    case "invalid_credentials":
      return "Wrong email or password.";
    case "email_not_confirmed":
      return "Confirm your email address first, using the link we sent you.";
    case "user_already_exists":
    case "email_exists":
      return "There's already an account with this email. Sign in instead.";
    case "weak_password":
      return error.message;
    case "email_address_invalid":
      return "That email address doesn't look right.";
    case "signup_disabled":
      return SIGNUPS_CLOSED;
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Too many attempts. Wait a few minutes, then try again.";
    default:
      console.error("Supabase Auth error", error);
      return "Something went wrong. Try again in a minute.";
  }
}
