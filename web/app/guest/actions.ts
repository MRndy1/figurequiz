"use server";

import { headers } from "next/headers";

import { signupsEnabled, turnstileSecretKey } from "@/lib/env";
import { GUESTS_PER_DAY, passedTurnstile } from "@/lib/guests";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type GuestStart = { ok: true } | { ok: false; error: string };

const UNAVAILABLE = "Trying FigureQuiz without an account isn't available right now. Sign up to make a deck.";

/**
 * Makes sure the visitor has a session before their first upload: anyone signed in already, as
 * an account or a guest, keeps theirs. Otherwise Turnstile must say they're human, the day's
 * guests must be under the cap, and a guest (Supabase anonymous user) is created and given 25
 * credits. The credits come from here, not from Auth: an anonymous user made straight through
 * Supabase with the public key gets none, so skipping this check buys nothing.
 */
export async function startGuest(turnstileToken: unknown): Promise<GuestStart> {
  const supabase = await createClient();
  // Asked of Auth itself, not just the cookie's signature: a guest deleted since still has a
  // valid-looking cookie, and gets a fresh guest instead.
  const { data } = await supabase.auth.getUser();
  if (data.user) return { ok: true };

  const secret = turnstileSecretKey();
  if (!signupsEnabled() || !secret) return { ok: false, error: UNAVAILABLE };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  if (typeof turnstileToken !== "string" || !(await passedTurnstile(turnstileToken, secret, ip))) {
    return { ok: false, error: "We couldn't check that you're human. Try again." };
  }

  const admin = createAdminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const started = await admin.from("guest_starts").select("id", { count: "exact", head: true }).gt("created_at", since);
  if (started.error) throw new Error(`startGuest: counting guests: ${started.error.message}`);
  if ((started.count ?? 0) >= GUESTS_PER_DAY) {
    return { ok: false, error: "Lots of people are trying FigureQuiz today. Sign up to make a deck, or try again tomorrow." };
  }

  const { data: guest, error } = await supabase.auth.signInAnonymously();
  if (error || !guest.user) {
    console.error("startGuest: anonymous sign-in failed", error);
    return { ok: false, error: UNAVAILABLE };
  }
  const granted = await admin.rpc("grant_guest_credits", { user_id: guest.user.id });
  if (granted.error || !granted.data) {
    console.error("startGuest: the guest got no credits", granted.error);
    return { ok: false, error: UNAVAILABLE };
  }
  const recorded = await admin.from("guest_starts").insert({});
  if (recorded.error) console.error("startGuest: couldn't record the guest", recorded.error);
  return { ok: true };
}
