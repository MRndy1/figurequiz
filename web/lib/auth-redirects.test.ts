import { describe, expect, it } from "vitest";

import {
  authCallbackUrl,
  DEFAULT_NEXT,
  LOGIN_ERRORS,
  loginErrorMessage,
  loginErrorPath,
  requestOrigin,
  safeNext,
} from "@/lib/auth-redirects";

describe("safeNext", () => {
  it("keeps a path on this site, query and fragment included", () => {
    for (const path of ["/dashboard", "/documents/abc", "/documents/abc/study?q=1#top", "/"]) {
      expect(safeNext(path), path).toBe(path);
    }
  });

  it("falls back to /dashboard for anything that isn't a string", () => {
    for (const value of [null, undefined, 42, ["/documents/abc"], new Blob(["/documents/abc"])]) {
      expect(safeNext(value), String(value)).toBe(DEFAULT_NEXT);
    }
  });

  it("refuses absolute and protocol-relative URLs", () => {
    const offsite = [
      "",
      "dashboard",
      " /dashboard",
      "https://evil.com",
      "javascript:alert(1)",
      "//evil.com",
      "///evil.com",
      "/\\evil.com",
      "/\\/evil.com",
      "\\\\evil.com",
    ];
    for (const value of offsite) expect(safeNext(value), JSON.stringify(value)).toBe(DEFAULT_NEXT);
  });

  it("refuses paths a browser would read as another site", () => {
    // The URL parser strips tabs and newlines and resolves dot segments: each becomes //evil.com.
    const disguised = [
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r\n/evil.com",
      "/..//evil.com",
      "/a/../..//evil.com",
    ];
    for (const value of disguised) {
      expect(safeNext(value), JSON.stringify(value)).toBe(DEFAULT_NEXT);
    }
  });

  it("only ever returns a same-site path, and returns it unchanged a second time", () => {
    const inputs = [
      "/%2F%2Fevil.com",
      "/./documents/../dashboard",
      "/documents/a b",
      "/\u0000",
      "/?next=//evil.com",
    ];
    for (const value of inputs) {
      const path = safeNext(value);
      expect(path, JSON.stringify(value)).toMatch(/^\/(?![/\\])/);
      expect(safeNext(path)).toBe(path);
    }
  });
});

describe("requestOrigin", () => {
  const origin = (entries: Record<string, string>) => requestOrigin(new Headers(entries));

  it("names each host the app runs on", () => {
    expect(
      origin({
        "x-forwarded-proto": "https",
        "x-forwarded-host": "figurequiz.online",
        host: "figurequiz.online",
      }),
    ).toBe("https://figurequiz.online");
    expect(origin({ "x-forwarded-proto": "https", "x-forwarded-host": "figurequiz.vercel.app" })).toBe(
      "https://figurequiz.vercel.app",
    );
    expect(origin({ "x-forwarded-proto": "http", "x-forwarded-host": "localhost:3000" })).toBe(
      "http://localhost:3000",
    );
  });

  it("prefers the forwarded host and takes the first entry of a list", () => {
    expect(
      origin({
        "x-forwarded-proto": "https, http",
        "x-forwarded-host": "figurequiz.online, internal:8080",
        host: "internal:8080",
      }),
    ).toBe("https://figurequiz.online");
  });

  it("falls back to Host, assuming https except on this machine", () => {
    expect(origin({ host: "figurequiz.online" })).toBe("https://figurequiz.online");
    expect(origin({ host: "localhost:3005" })).toBe("http://localhost:3005");
    expect(origin({ host: "127.0.0.1:3000" })).toBe("http://127.0.0.1:3000");
  });

  it("gives up on headers that don't name a plain host", () => {
    expect(origin({})).toBeNull();
    expect(origin({ "x-forwarded-proto": "ftp", host: "figurequiz.online" })).toBeNull();
    for (const host of ["evil.com/path", "user@evil.com", "evil.com?x=1", "evil.com#x", "a b"]) {
      expect(origin({ host }), host).toBeNull();
    }
  });
});

describe("authCallbackUrl", () => {
  it("points at /auth/callback on the same origin, carrying a safe next", () => {
    expect(authCallbackUrl("https://figurequiz.online", "/documents/abc?x=1")).toBe(
      "https://figurequiz.online/auth/callback?next=%2Fdocuments%2Fabc%3Fx%3D1",
    );
    expect(authCallbackUrl("http://localhost:3000", "//evil.com")).toBe(
      "http://localhost:3000/auth/callback?next=%2Fdashboard",
    );
  });
});

describe("login errors", () => {
  it("round-trips every message through /login?error=", () => {
    for (const message of Object.values(LOGIN_ERRORS)) {
      const url = new URL(loginErrorPath(message, DEFAULT_NEXT), "http://localhost");
      expect(url.pathname).toBe("/login");
      expect(loginErrorMessage(url.searchParams.get("error"))).toBe(message);
      expect(url.searchParams.has("next")).toBe(false);
    }
  });

  it("keeps a safe next so that trying again still ends up there", () => {
    const url = new URL(loginErrorPath(LOGIN_ERRORS.failed, "/documents/abc"), "http://localhost");
    expect(url.searchParams.get("next")).toBe("/documents/abc");
    expect(loginErrorPath(LOGIN_ERRORS.failed, "//evil.com")).not.toContain("evil");
  });

  it("shows nothing for words the app didn't write", () => {
    const values = [
      "Your account is locked. Call 555-0100.",
      "",
      undefined,
      null,
      [LOGIN_ERRORS.failed],
    ];
    for (const value of values) expect(loginErrorMessage(value), String(value)).toBeNull();
  });
});
