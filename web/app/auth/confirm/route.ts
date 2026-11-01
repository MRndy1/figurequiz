import type { EmailOtpType } from "@supabase/supabase-js";

import { DEFAULT_NEXT, LOGIN_ERRORS, loginErrorPath, seeOther } from "@/lib/auth-redirects";
import { createClient } from "@/lib/supabase/server";

/**
 * The two emails the app sends (supabase/templates/): a new account's, and a guest's who signed
 * up, whose own user gains an address rather than being created.
 */
const CONFIRMATIONS: readonly EmailOtpType[] = ["email", "email_change"];

/**
 * The link in a confirmation email ends here. Verifying its token confirms the address and signs
 * in whichever browser opened it, so the email works on another device too; then the student goes
 * on to their decks. For a guest, it makes their user an account, which keeps their deck.
 *
 * Every failure goes to /login with LOGIN_ERRORS.confirmFailed, which says what to do next.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const tokenHash = params.get("token_hash");
  const type = CONFIRMATIONS.find((kind) => kind === params.get("type"));
  if (!tokenHash || !type) return seeOther(loginErrorPath(LOGIN_ERRORS.confirmFailed, DEFAULT_NEXT));

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    console.warn("Email confirmation failed", { type, code: error.code });
    return seeOther(loginErrorPath(LOGIN_ERRORS.confirmFailed, DEFAULT_NEXT));
  }

  return seeOther(DEFAULT_NEXT);
}
