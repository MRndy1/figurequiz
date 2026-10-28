import "server-only";

import { cache } from "react";

import { requireUser } from "@/lib/dal/auth";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/*
 * Credits (docs/credits-plan.md), read through the user's own session: RLS shows each user
 * their own ledger rows, and only the service role writes them, through the functions in
 * supabase/migrations/*_credits.sql.
 */

/** Shown when an upload or a retry needs a credit and there are none. */
export const OUT_OF_CREDITS = "You're out of credits. Each page that gets questions takes one.";

/** The signed-in user's balance. Cached for the request: the header and a page both ask. */
export const getBalance = cache(async (): Promise<number> => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("credit_balance")
    .select("balance")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(`Couldn't read the credit balance: ${error.message}`);
  return data?.balance ?? 0;
});

type Reason = Database["public"]["Enums"]["credit_reason"];

export type LedgerRow = {
  id: string;
  delta: number;
  reason: Reason;
  hold_id: string | null;
  note: string | null;
  created_at: string;
  documents: { filename: string } | null;
};

/** A line of the Credits page's history. */
export type CreditLine = {
  id: string;
  label: string;
  detail: string | null;
  delta: number;
  at: string;
  /** A deck still being written: its credits are held, not yet settled. */
  pending: boolean;
};

const LABEL: Record<Exclude<Reason, "deck_hold" | "deck_release" | "marking" | "marking_refund">, string> = {
  welcome_guest: "Free credits for trying FigureQuiz",
  welcome_account: "Free credits for your account",
  admin_grant: "Credits added",
};

/** The newest 100 ledger rows, as history lines. */
export async function getCreditHistory(): Promise<CreditLine[]> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("credit_ledger")
    .select("id, delta, reason, hold_id, note, created_at, documents(filename)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Couldn't read the credit history: ${error.message}`);
  return creditLines(data);
}

/**
 * Ledger rows, newest first, as history lines. A row and the one that settles it become one
 * line with what it finally cost: a deck's hold and its release, and a marking spend and its
 * refund. A hold not yet released is pending.
 */
export function creditLines(rows: LedgerRow[]): CreditLine[] {
  const settles = new Map(rows.flatMap((row) => (row.hold_id ? [[row.hold_id, row] as const] : [])));
  return rows.flatMap((row): CreditLine[] => {
    const line = { id: row.id, at: row.created_at, pending: false };
    switch (row.reason) {
      case "deck_release":
      case "marking_refund":
        return [];
      case "deck_hold": {
        const release = settles.get(row.id);
        return [
          {
            ...line,
            label: row.documents?.filename ?? "A deleted deck",
            detail: release ? release.note : "Writing questions…",
            delta: row.delta + (release?.delta ?? 0),
            pending: !release,
          },
        ];
      }
      case "marking": {
        // The note is the question's title.
        const refund = settles.get(row.id);
        return [
          {
            ...line,
            label: refund ? "Written answer not marked" : "Written answer marked",
            detail: refund ? `${row.note ?? "Marking"} failed, so its credits came back` : row.note,
            delta: row.delta + (refund?.delta ?? 0),
          },
        ];
      }
      default:
        return [{ ...line, label: LABEL[row.reason], detail: row.note, delta: row.delta }];
    }
  });
}

/** What a deck has cost so far, in credits: its holds less what their releases gave back. */
export async function getDeckCredits(documentId: string): Promise<number> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("credit_ledger")
    .select("delta")
    .eq("user_id", user.id)
    .eq("document_id", documentId);
  if (error) throw new Error(`Couldn't read the credits for ${documentId}: ${error.message}`);
  return -data.reduce((sum, row) => sum + row.delta, 0);
}
