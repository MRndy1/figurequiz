import { describe, expect, it } from "vitest";

import { creditLines, type LedgerRow } from "@/lib/dal/credits";

const row = (overrides: Partial<LedgerRow> & Pick<LedgerRow, "id" | "delta" | "reason">): LedgerRow => ({
  hold_id: null,
  note: null,
  created_at: "2026-10-26T09:00:00Z",
  documents: null,
  ...overrides,
});

describe("creditLines", () => {
  it("shows a deck's hold and release as one line with what it cost", () => {
    const lines = creditLines([
      row({ id: "r1", delta: 1, reason: "deck_release", hold_id: "h1", note: "3 of 4 pages got questions" }),
      row({ id: "h1", delta: -4, reason: "deck_hold", documents: { filename: "lobes.pptx" } }),
      row({ id: "w1", delta: 100, reason: "welcome_account" }),
    ]);
    expect(lines).toEqual([
      expect.objectContaining({ label: "lobes.pptx", detail: "3 of 4 pages got questions", delta: -3, pending: false }),
      expect.objectContaining({ label: "Free credits for your account", delta: 100 }),
    ]);
  });

  it("marks a deck still being written as pending, at what it holds", () => {
    const [line] = creditLines([row({ id: "h2", delta: -12, reason: "deck_hold", documents: { filename: "notes.pdf" } })]);
    expect(line).toMatchObject({ delta: -12, pending: true, detail: "Writing questions…" });
  });

  it("shows a marked answer at its cost, and one whose marking failed at nothing", () => {
    const lines = creditLines([
      row({ id: "r5", delta: 2, reason: "marking_refund", hold_id: "m5", note: "Hard drive parts" }),
      row({ id: "m5", delta: -2, reason: "marking", note: "Hard drive parts" }),
      row({ id: "m4", delta: -2, reason: "marking", note: "What CMOS keeps" }),
    ]);
    expect(lines).toEqual([
      expect.objectContaining({ label: "Written answer not marked", delta: 0, pending: false }),
      expect.objectContaining({ label: "Written answer marked", detail: "What CMOS keeps", delta: -2 }),
    ]);
  });

  it("names a deck that has since been deleted", () => {
    const lines = creditLines([
      row({ id: "r3", delta: 0, reason: "deck_release", hold_id: "h3", note: "2 of 2 pages got questions" }),
      row({ id: "h3", delta: -2, reason: "deck_hold" }),
    ]);
    expect(lines).toEqual([expect.objectContaining({ label: "A deleted deck", delta: -2 })]);
  });
});
