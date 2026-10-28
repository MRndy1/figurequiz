"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const POLL_MS = 3000;

/**
 * While `active`, re-renders the page every few seconds (only while the tab is visible), so the
 * server sends fresh statuses. Renders nothing.
 */
export function RefreshWhile({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, router]);

  return null;
}
