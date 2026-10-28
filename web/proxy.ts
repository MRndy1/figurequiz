import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Every path except the ones that never use a session: the landing page and /demo, which
     * must keep working with no Supabase at all; the ingest callback, which checks the
     * worker's own secret; Next's build output and image optimizer; and static files.
     *
     * Next also runs the proxy for a page's transport forms (/demo.rsc,
     * /demo.segments/…, and /index.rsc for the landing page), hence the `[/.]` and `index.`.
     */
    "/((?!$|index(?:\\.|$)|demo(?:[/.]|$)|api/ingest(?:/|$)|_next/static|_next/image|favicon\\.ico$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
