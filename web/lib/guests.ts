import "server-only";

/*
 * Guest decks (docs/credits-plan.md, phase 2): a visitor tries FigureQuiz as a Supabase
 * anonymous user, which RLS treats like any other user. These are the rules that make a guest
 * different: one deck, a taste of its questions, and a human check before it starts.
 */

/** Questions a guest can open in a deck before signing up; the rest stay on the server. */
export const FREE_QUESTIONS = 3;

/** Decks a guest can make. Signing up lifts it. */
export const GUEST_DECKS = 1;

/** New guests a day, across the whole site: each can spend some of the model budget. */
export const GUESTS_PER_DAY = 200;

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Whether Cloudflare says `token` came from a human solving Turnstile on our site. A token works
 * once and for five minutes. Any failure to ask counts as no, so an outage can't open the door.
 */
export async function passedTurnstile(token: string, secret: string, ip: string | null): Promise<boolean> {
  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set("remoteip", ip);
  try {
    const response = await fetch(SITEVERIFY, {
      method: "POST",
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const result: unknown = await response.json();
    return typeof result === "object" && result !== null && "success" in result && result.success === true;
  } catch (error) {
    console.error("Turnstile check failed", error);
    return false;
  }
}
