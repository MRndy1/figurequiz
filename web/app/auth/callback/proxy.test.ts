import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { config, proxy } from "@/proxy";

/*
 * proxy.ts on the Google callback: it must run there, so a session gets refreshed like anywhere
 * else, and must neither redirect a visitor who isn't signed in yet nor touch the PKCE verifier
 * the code exchange needs.
 *
 * In a file of its own because Next's testing helper patches console in a way that throws under
 * vitest, and route.test.ts exercises a route that logs.
 */

beforeAll(() => {
  // proxy.ts builds a real Supabase client; with no session cookie it never calls out.
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("proxy.ts on /auth/callback", () => {
  it("runs there", () => {
    expect(unstable_doesMiddlewareMatch({ config, url: "/auth/callback?code=7c1e3a52" })).toBe(true);
    // Not a matcher that matches everything: paths that never use a session are still skipped.
    expect(unstable_doesMiddlewareMatch({ config, url: "/demo" })).toBe(false);
  });

  it("lets a signed-out visitor through, leaving the PKCE verifier cookie alone", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3000/auth/callback?code=7c1e3a52&next=%2Fdashboard", {
        headers: { cookie: "sb-127-auth-token-code-verifier=base64-InZlcmlmaWVyIg" },
      }),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
