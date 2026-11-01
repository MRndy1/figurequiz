import { AuthError, type VerifyOtpParams } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOGIN_ERRORS } from "@/lib/auth-redirects";

import { GET } from "./route";

/* The route with Supabase mocked out. The proxy runs on this path as on /auth/callback. */

const { verifyOtp } = vi.hoisted(() => ({
  verifyOtp: vi.fn<(params: VerifyOtpParams) => Promise<{ error: AuthError | null }>>(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp } }),
}));

/** A token hash as Supabase puts it in the email; PKCE sign-ups prefix it. */
const TOKEN = "pkce_4c6f3b8e0a1d2e9f7b5a3c1d0e8f6a4b2c0d9e7f5a3b1c";

beforeEach(() => {
  verifyOtp.mockReset();
  verifyOtp.mockResolvedValue({ error: null });
  // Each failure is logged for the operator; keep the test output to the results.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** GET /auth/confirm with this query; the redirect it answers with. */
async function confirm(query: string) {
  const response = await GET(new Request(`https://figurequiz.online/auth/confirm${query}`));
  const location = response.headers.get("location") ?? "";
  return {
    status: response.status,
    location,
    url: new URL(location, "https://figurequiz.online"),
    cacheControl: response.headers.get("cache-control"),
  };
}

describe("GET /auth/confirm", () => {
  it("confirms a new account's email and sends the student to their decks", async () => {
    const result = await confirm(`?token_hash=${TOKEN}&type=email`);

    expect(verifyOtp).toHaveBeenCalledExactlyOnceWith({ type: "email", token_hash: TOKEN });
    expect(result.status).toBe(303);
    expect(result.location).toBe("/dashboard");
    // The session cookies ride on this response.
    expect(result.cacheControl).toBe("no-store");
  });

  it("confirms the email a guest signed up with", async () => {
    const result = await confirm(`?token_hash=${TOKEN}&type=email_change`);

    expect(verifyOtp).toHaveBeenCalledExactlyOnceWith({ type: "email_change", token_hash: TOKEN });
    expect(result.location).toBe("/dashboard");
  });

  it("takes only the kinds of email the app sends", async () => {
    const queries = [
      "",
      "?type=email",
      `?token_hash=${TOKEN}`,
      `?token_hash=&type=email`,
      // Supabase verifies these too, but the app never sends them: a recovery link signs in
      // without the password.
      `?token_hash=${TOKEN}&type=recovery`,
      `?token_hash=${TOKEN}&type=magiclink`,
      `?token_hash=${TOKEN}&type=invite`,
      `?token_hash=${TOKEN}&type=signup`,
    ];
    for (const query of queries) {
      const result = await confirm(query);
      expect(result.status, query).toBe(303);
      expect(result.url.pathname, query).toBe("/login");
      expect(result.url.searchParams.get("error"), query).toBe(LOGIN_ERRORS.confirmFailed);
    }
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("sends a used or expired link to /login, saying what to do next", async () => {
    // As the local Supabase stack reports a link that was already opened.
    verifyOtp.mockResolvedValueOnce({
      error: new AuthError("Email link is invalid or has expired", 403, "otp_expired"),
    });
    const result = await confirm(`?token_hash=${TOKEN}&type=email&next=%2F%2Fevil.com`);

    expect(result.status).toBe(303);
    expect(result.url.pathname).toBe("/login");
    expect(result.url.searchParams.get("error")).toBe(LOGIN_ERRORS.confirmFailed);
    expect(result.url.searchParams.get("next")).toBeNull();
    expect(console.warn).toHaveBeenCalledOnce();
  });
});
