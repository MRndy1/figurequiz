import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { passedTurnstile } from "@/lib/guests";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // Failures are logged for the operator; keep the test output to the results.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("passedTurnstile", () => {
  it("asks Cloudflare with the secret, the token and the visitor's address", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ success: true }));

    expect(await passedTurnstile("token-1", "secret-1", "203.0.113.7")).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init?.method).toBe("POST");
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      secret: "secret-1",
      response: "token-1",
      remoteip: "203.0.113.7",
    });
  });

  it("says no to anything but Cloudflare's yes, so an outage can't open the door", async () => {
    const answers = [
      () => Promise.resolve(Response.json({ success: false, "error-codes": ["timeout-or-duplicate"] })),
      () => Promise.resolve(Response.json({ success: "true" })),
      () => Promise.resolve(new Response("unavailable", { status: 503 })),
      () => Promise.resolve(new Response("not json")),
      () => Promise.reject(new TypeError("fetch failed")),
    ];
    for (const answer of answers) {
      fetchMock.mockImplementationOnce(answer);
      expect(await passedTurnstile("token-1", "secret-1", null)).toBe(false);
    }
  });
});
