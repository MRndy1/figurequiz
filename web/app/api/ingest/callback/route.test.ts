import { beforeAll, describe, expect, it } from "vitest";

import { INGEST_CALLBACK_PATH } from "@/lib/contracts";

import { POST } from "./route";

/*
 * The checks that run before the database is touched. Claiming (202), repeats (200), unknown
 * documents (404) and early calls (409) need Supabase, so they are checked against the local
 * stack instead.
 */

const SECRET = "test-secret-that-is-at-least-32-characters-long";
const DOCUMENT_ID = "0b7e3c1a-2d4f-4e6a-9b8c-7d6e5f4a3b2c";

beforeAll(() => {
  process.env.INGEST_CALLBACK_SECRET = SECRET;
});

function callback(body: string, authorization?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (authorization !== undefined) headers.set("authorization", authorization);
  return POST(new Request(`http://localhost${INGEST_CALLBACK_PATH}`, { method: "POST", headers, body }));
}

const valid = JSON.stringify({ document_id: DOCUMENT_ID });

describe("POST /api/ingest/callback", () => {
  it("answers 401 without the worker's secret", async () => {
    for (const authorization of [undefined, "", SECRET, `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(1)}`]) {
      const response = await callback(valid, authorization);
      expect(response.status, String(authorization)).toBe(401);
    }
  });

  it("answers 400 to a body that is not {document_id}", async () => {
    const bodies = [
      "not json",
      "[]",
      "{}",
      JSON.stringify({ document_id: "not-a-uuid" }),
      JSON.stringify({ document_id: DOCUMENT_ID, user_id: DOCUMENT_ID }),
    ];
    for (const body of bodies) {
      const response = await callback(body, `Bearer ${SECRET}`);
      expect(response.status, body).toBe(400);
    }
  });
});
