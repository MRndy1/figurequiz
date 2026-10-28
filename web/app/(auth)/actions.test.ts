import { AuthError } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { LOGIN_ERRORS } from "@/lib/auth-redirects";
import { createClient } from "@/lib/supabase/server";

import { signInWithGoogle, signUp } from "./actions";

/*
 * signInWithGoogle against the real @supabase/ssr server client, with a cookie jar standing in
 * for next/headers. Building the authorize URL and storing the PKCE verifier happen locally, so
 * no Supabase is needed; only the provider check's fetch is stubbed. signUp's calls to Supabase
 * Auth are stubbed on the client.
 */

const mocks = vi.hoisted(() => {
  class Redirect extends Error {
    constructor(readonly url: string) {
      super(`redirected to ${url}`);
    }
  }
  return {
    Redirect,
    supabaseUrl: "http://127.0.0.1:54321",
    publishableKey: "sb_publishable_test",
    requestHeaders: { current: new Headers() },
    jar: new Map<string, string>(),
  };
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new mocks.Redirect(url);
  },
}));

vi.mock("next/headers", () => ({ headers: async () => mocks.requestHeaders.current }));

vi.mock("@/lib/supabase/server", async () => {
  const { createServerClient } = await import("@supabase/ssr");
  return {
    createClient: vi.fn(async () =>
      createServerClient(mocks.supabaseUrl, mocks.publishableKey, {
        cookies: {
          getAll: () => [...mocks.jar].map(([name, value]) => ({ name, value })),
          setAll: (cookies) => {
            for (const { name, value } of cookies) {
              if (value) mocks.jar.set(name, value);
              else mocks.jar.delete(name);
            }
          },
        },
      }),
    ),
  };
});

/** A fresh Response per call: a body can only be read once. */
const settings = (google: boolean) => async () => Response.json({ external: { google, email: true } });
const fetchMock = vi.fn<typeof fetch>();

beforeAll(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", mocks.supabaseUrl);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", mocks.publishableKey);
  vi.stubEnv("SIGNUPS_ENABLED", "true");
  vi.stubGlobal("fetch", fetchMock);
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  mocks.jar.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(settings(true));
  vi.mocked(createClient).mockClear();
  // Failures are logged for the operator; keep the test output to the results.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Submits the Google form from a request with these headers; returns where it redirected. */
async function submit(headers: Record<string, string>, next?: string): Promise<URL> {
  mocks.requestHeaders.current = new Headers(headers);
  const form = new FormData();
  if (next !== undefined) form.set("next", next);
  try {
    await signInWithGoogle(form);
  } catch (error) {
    if (error instanceof mocks.Redirect) return new URL(error.url, "http://redirect.invalid");
    throw error;
  }
  throw new Error("signInWithGoogle finished without redirecting");
}

const ONLINE = { "x-forwarded-proto": "https", "x-forwarded-host": "figurequiz.online" };

describe("signInWithGoogle", () => {
  it("sends the browser to Google through Supabase, coming back to the host it started on", async () => {
    const hosts: [Record<string, string>, string][] = [
      [ONLINE, "https://figurequiz.online"],
      [
        { "x-forwarded-proto": "https", "x-forwarded-host": "figurequiz.vercel.app" },
        "https://figurequiz.vercel.app",
      ],
      [
        { "x-forwarded-proto": "http", "x-forwarded-host": "localhost:3000" },
        "http://localhost:3000",
      ],
    ];
    for (const [headers, origin] of hosts) {
      mocks.jar.clear();
      const url = await submit(headers);

      expect(`${url.origin}${url.pathname}`).toBe(`${mocks.supabaseUrl}/auth/v1/authorize`);
      expect(url.searchParams.get("provider")).toBe("google");
      expect(url.searchParams.get("redirect_to")).toBe(`${origin}/auth/callback?next=%2Fdashboard`);
      expect(url.searchParams.get("code_challenge_method")).toBe("s256");
      expect(url.searchParams.get("code_challenge")).toBeTruthy();
      // PKCE: the verifier waits in a cookie for the callback's code exchange.
      expect([...mocks.jar.keys()]).toContain("sb-127-auth-token-code-verifier");
    }
  });

  it("asks Supabase whether Google is switched on, with the publishable key", async () => {
    await submit(ONLINE);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe(`${mocks.supabaseUrl}/auth/v1/settings`);
    expect(init?.headers).toEqual({ apikey: mocks.publishableKey });
  });

  it("carries a safe next through the callback URL and drops an unsafe one", async () => {
    const kept = await submit(ONLINE, "/documents/abc/study");
    expect(kept.searchParams.get("redirect_to")).toBe(
      "https://figurequiz.online/auth/callback?next=%2Fdocuments%2Fabc%2Fstudy",
    );

    const dropped = await submit(ONLINE, "//evil.com");
    expect(dropped.searchParams.get("redirect_to")).toBe(
      "https://figurequiz.online/auth/callback?next=%2Fdashboard",
    );
  });

  it("comes back to /login with a message while Google is switched off", async () => {
    fetchMock.mockImplementation(settings(false));
    const url = await submit(ONLINE, "/documents/abc");

    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("error")).toBe(LOGIN_ERRORS.unavailable);
    expect(url.searchParams.get("next")).toBe("/documents/abc");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("goes ahead when the provider check can't tell", async () => {
    const answers = [
      () => Promise.reject(new TypeError("fetch failed")),
      () => Promise.resolve(new Response("unavailable", { status: 503 })),
      () => Promise.resolve(Response.json({ unexpected: true })),
    ];
    for (const answer of answers) {
      fetchMock.mockImplementationOnce(answer);
      const url = await submit(ONLINE);
      expect(url.pathname).toBe("/auth/v1/authorize");
    }
  });

  it("comes back to /login with a message when sign-in can't start", async () => {
    const client = await createClient();
    vi.spyOn(client.auth, "signInWithOAuth").mockResolvedValueOnce({
      data: { provider: "google", url: null },
      error: new AuthError("storage failed"),
    });
    vi.mocked(createClient).mockResolvedValueOnce(client);

    const url = await submit(ONLINE);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("error")).toBe(LOGIN_ERRORS.failed);
  });

  it("comes back to /login with a message when the request names no host", async () => {
    const url = await submit({});
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("error")).toBe(LOGIN_ERRORS.failed);
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("signUp for a guest", () => {
  const GUEST = "9eac020e-7051-410c-a682-8d37e48a0e81";

  /** A client whose session belongs to a guest, with Supabase Auth's answers stubbed. */
  async function guestClient(stillAnonymous: boolean) {
    const client = await createClient();
    vi.spyOn(client.auth, "getClaims").mockResolvedValue({
      data: {
        claims: {
          iss: `${mocks.supabaseUrl}/auth/v1`,
          sub: GUEST,
          aud: "authenticated",
          exp: 2_000_000_000,
          iat: 1_900_000_000,
          role: "authenticated",
          aal: "aal1",
          session_id: "5e551011-0000-4000-8000-000000000000",
          is_anonymous: true,
        },
        header: { alg: "ES256", kid: "test", typ: "JWT" },
        signature: new Uint8Array(),
      },
      error: null,
    });
    const updateUser = vi.spyOn(client.auth, "updateUser").mockResolvedValue({
      data: {
        user: {
          id: GUEST,
          aud: "authenticated",
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-10-26T09:00:00Z",
          is_anonymous: stillAnonymous,
        },
      },
      error: null,
    });
    const refreshSession = vi
      .spyOn(client.auth, "refreshSession")
      .mockResolvedValue({ data: { user: null, session: null }, error: null });
    vi.mocked(createClient).mockResolvedValue(client);
    return { updateUser, refreshSession };
  }

  function form(next: string): FormData {
    const data = new FormData();
    data.set("email", "student@example.com");
    data.set("password", "correct horse battery");
    data.set("next", next);
    return data;
  }

  it("gives the guest's own user the email, and a fresh token that no longer says guest", async () => {
    const { updateUser, refreshSession } = await guestClient(false);

    const redirected = await signUp({}, form("/documents/abc/study")).catch((error: unknown) => error);

    expect(updateUser).toHaveBeenCalledExactlyOnceWith({
      email: "student@example.com",
      password: "correct horse battery",
    });
    // Without it, the paywall would keep reading the old token's is_anonymous.
    expect(refreshSession).toHaveBeenCalledOnce();
    expect(redirected).toEqual(new mocks.Redirect("/documents/abc/study"));
  });

  it("asks for the confirmation email when the project needs one, keeping the guest's token", async () => {
    const { refreshSession } = await guestClient(true);

    const state = await signUp({}, form("/documents/abc/study"));

    expect(state.notice).toMatch(/confirm your email address/);
    expect(refreshSession).not.toHaveBeenCalled();
  });
});
