"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { finishDeck } from "@/app/(product)/documents/actions";
import { button } from "@/components/ui";

/**
 * Starts writing a deck's waiting pages, or retries its failed questions. The page then shows
 * the run's steps, as it does for a new upload.
 */
export function FinishDeckButton({
  documentId,
  label,
  outOfCredits,
}: {
  documentId: string;
  label: string;
  /** Shown instead of the button working: nothing can run without a credit. */
  outOfCredits: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function start() {
    startTransition(async () => {
      setError(null);
      const result = await finishDeck(documentId).catch(() => ({
        ok: false as const,
        error: "That didn't go through. Try again in a minute.",
      }));
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button type="button" onClick={start} disabled={pending || outOfCredits} className={button("ink")}>
        {pending ? "Starting…" : label}
      </button>
      {outOfCredits && !error && (
        <p className="m-0 text-sm font-semibold text-ink-muted">
          You need at least one credit.{" "}
          <Link href="/pricing" className="link-marker text-ink">
            Top up
          </Link>
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 text-sm font-semibold text-coral-ink">
          {error}
        </p>
      )}
    </div>
  );
}
