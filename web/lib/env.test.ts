import { afterEach, describe, expect, it, vi } from "vitest";

// Fresh modules per test: each getter caches what it read.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("env", () => {
  it("reads nothing at import time, so the build and /demo need no env", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    await expect(import("@/lib/supabase/admin")).resolves.toHaveProperty("createAdminClient");
  });

  it("names a missing variable", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const { supabaseSecretKey } = await import("@/lib/env");
    expect(() => supabaseSecretKey()).toThrow("SUPABASE_SECRET_KEY is not set");
  });

  it("refuses a value of the wrong kind without echoing it", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_publishable_pasted-the-wrong-key");
    const { supabaseSecretKey } = await import("@/lib/env");
    expect(() => supabaseSecretKey()).toThrow("SUPABASE_SECRET_KEY is invalid");
    expect(() => supabaseSecretKey()).not.toThrow(/wrong-key/);
  });

  it("keeps signups closed unless switched on exactly", async () => {
    vi.stubEnv("SIGNUPS_ENABLED", "yes");
    const { signupsEnabled } = await import("@/lib/env");
    expect(signupsEnabled()).toBe(false);
  });
});
