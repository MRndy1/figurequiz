import { AuthError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOGIN_ERRORS, type LoginError } from "@/lib/auth-redirects";

import { GET } from "./route";

/* The route with Supabase mocked out. proxy.test.ts beside it covers the proxy on this path. */

type Claims = { data: { claims: { is_anonymous?: boolean } } | null };
type OAuthStart = { data: { url: string | null }; error: AuthError | null };

const { exchangeCodeForSession, getClaims, signInWithOAuth } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn<(code: string) => Promise<{ error: AuthError | null }>>(),
  getClaims: vi.fn<() => Promise<Claims>>(),
  signInWithOAuth: vi.fn<(credentials: unknown) => Promise<OAuthStart>>(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession, getClaims, signInWithOAuth } }),
}));

/** Where Supabase Auth would send the browser to sign in with Google. */
const GOOGLE = "https://roffcwhgmkuxupctuhty.supabase.co/auth/v1/authorize?provider=google";

beforeEach(() => {
  exchangeCodeForSession.mockReset();
  exchangeCodeForSession.mockResolvedValue({ error: null });
  getClaims.mockReset();
  getClaims.mockResolvedValue({ data: { claims: { is_anonymous: false } } });
  signInWithOAuth.mockReset();
  signInWithOAuth.mockResolvedValue({ data: { url: GOOGLE }, error: null });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  // Each failure is logged for the operator; keep the test output to the results.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** GET /auth/callback with this query, as Vercel forwards it; the redirect it answers with. */
async function callback(query: string) {
  const response = await GET(
    new Request(`https://figurequiz.online/auth/callback${query}`, {
      headers: { "x-forwarded-host": "figurequiz.online", "x-forwarded-proto": "https" },
    }),
  );
  const location = response.headers.get("location") ?? "";
  return {
    status: response.status,
    location,
    url: new URL(location, "https://figurequiz.online"),
    cacheControl: response.headers.get("cache-control"),
  };
}

function expectLoginError(url: URL, error: LoginError, next: string | null = null) {
  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("error")).toBe(error);
  expect(url.searchParams.get("next")).toBe(next);
}

describe("GET /auth/callback", () => {
  it("exchanges the code and sends the student on to next", async () => {
    const result = await callback("?next=%2Fdocuments%2Fabc%2Fstudy%3Fq%3D1&code=7c1e3a52");

    expect(exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith("7c1e3a52");
    expect(result.status).toBe(303);
    // Relative, so it stays on whichever host the callback came in on.
    expect(result.location).toBe("/documents/abc/study?q=1");
    expect(result.cacheControl).toBe("no-store");
  });

  it("defaults to /dashboard and never redirects off the site", async () => {
    const nexts = [
      "",
      "&next=",
      "&next=%2F%2Fevil.com",
      "&next=https%3A%2F%2Fevil.com",
      "&next=%2F%5Cevil.com",
      "&next=%2F%09%2Fevil.com",
    ];
    for (const next of nexts) {
      const result = await callback(`?code=7c1e3a52${next}`);
      expect(result.location, next).toBe("/dashboard");
    }
  });

  it("sends a callback with no code back to /login, keeping next", async () => {
    for (const query of ["?next=%2Fdocuments%2Fabc", "?code=&next=%2Fdocuments%2Fabc"]) {
      const result = await callback(query);
      expect(result.status).toBe(303);
      expectLoginError(result.url, LOGIN_ERRORS.failed, "/documents/abc");
    }
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("turns a refusal from Google or Supabase into the app's own words", async () => {
    const refusals: [string, LoginError][] = [
      ["?error=access_denied&error_description=The+user+denied+access", LOGIN_ERRORS.cancelled],
      [
        "?error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance",
        LOGIN_ERRORS.signupsClosed,
      ],
      ["?error=invalid_request&error_code=flow_state_expired", LOGIN_ERRORS.expired],
      // A guest linking a Google account that already has FigureQuiz.
      [
        "?error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked+to+another+user",
        LOGIN_ERRORS.identityTaken,
      ],
      ["?error=server_error&error_description=Unable+to+exchange+external+code", LOGIN_ERRORS.failed],
      ["?error_code=unexpected_failure", LOGIN_ERRORS.failed],
      // An error wins over a code that came with it.
      ["?code=7c1e3a52&error=access_denied", LOGIN_ERRORS.cancelled],
    ];
    for (const [query, error] of refusals) {
      const result = await callback(query);
      expect(result.status, query).toBe(303);
      expectLoginError(result.url, error);
    }
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(refusals.length);
  });

  it("signs a guest in to the account their Google account already has, keeping next", async () => {
    getClaims.mockResolvedValue({ data: { claims: { is_anonymous: true } } });
    const result = await callback(
      "?next=%2Fdocuments%2Fabc&error=server_error&error_code=identity_already_exists" +
        "&error_description=Identity+is+already+linked+to+another+user",
    );

    expect(result.status).toBe(303);
    expect(result.location).toBe(GOOGLE);
    expect(result.cacheControl).toBe("no-store");
    expect(signInWithOAuth).toHaveBeenCalledExactlyOnceWith({
      provider: "google",
      options: { redirectTo: "https://figurequiz.online/auth/callback?next=%2Fdocuments%2Fabc" },
    });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("says the account exists when the visitor isn't a guest, or signing in can't start", async () => {
    const taken = "?error=server_error&error_code=identity_already_exists&next=%2Fdocuments%2Fabc";

    // Already signed in to an account: going round again could only loop.
    expectLoginError((await callback(taken)).url, LOGIN_ERRORS.identityTaken, "/documents/abc");
    expect(signInWithOAuth).not.toHaveBeenCalled();

    getClaims.mockResolvedValue({ data: { claims: { is_anonymous: true } } });
    signInWithOAuth.mockResolvedValueOnce({ data: { url: null }, error: new AuthError("fetch failed") });
    expectLoginError((await callback(taken)).url, LOGIN_ERRORS.identityTaken, "/documents/abc");
  });

  it("never repeats the provider's description to the student", async () => {
    const result = await callback("?error=access_denied&error_description=Call+555-0100+to+unlock");
    expect(result.location).not.toContain("555");
  });

  it("sends a failed exchange back to /login, keeping next", async () => {
    // Codes as the local Supabase stack and supabase-js report them.
    const failures: [AuthError, LoginError][] = [
      [new AuthError("invalid flow state", 404, "flow_state_not_found"), LOGIN_ERRORS.expired],
      [new AuthError("no verifier", 400, "pkce_code_verifier_not_found"), LOGIN_ERRORS.expired],
      [new AuthError("verifier mismatch", 403, "bad_code_verifier"), LOGIN_ERRORS.expired],
      [new AuthError("Internal Server Error", 500, "unexpected_failure"), LOGIN_ERRORS.failed],
      [new AuthError("fetch failed"), LOGIN_ERRORS.failed],
    ];
    for (const [failure, error] of failures) {
      exchangeCodeForSession.mockResolvedValueOnce({ error: failure });
      const result = await callback("?code=7c1e3a52&next=%2Fdocuments%2Fabc");
      expect(result.status).toBe(303);
      expectLoginError(result.url, error, "/documents/abc");
    }
  });
});
