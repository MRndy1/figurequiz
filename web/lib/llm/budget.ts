import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Today's (UTC) model spend across every user, from `llm_requests`: what DAILY_BUDGET_USD caps,
 * for generation and marking alike. PostgREST returns at most 1000 rows a request.
 */
export async function spentTodayUsd(db: ReturnType<typeof createAdminClient>): Promise<number> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const pageSize = 1000;
  let total = 0;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("llm_requests")
      .select("cost_usd")
      .gte("created_at", since.toISOString())
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`could not read today's spend: ${error.message}`);
    total += data.reduce((sum, row) => sum + row.cost_usd, 0);
    if (data.length < pageSize) return total;
  }
}
