"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { deleteDeck } from "@/app/(product)/documents/actions";
import { button } from "@/components/ui";

/**
 * "Delete this deck", asked twice: the first press only says what goes with it. Focus moves to
 * "Keep it", so a second Enter can't delete by accident. Once deleted, the student is back on
 * their decks.
 */
export function DeleteDeck({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const keep = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) keep.current?.focus();
  }, [confirming]);

  function remove() {
    startTransition(async () => {
      setError(null);
      const result = await deleteDeck(documentId).catch(() => ({
        ok: false as const,
        error: "That didn't go through. Try again in a minute.",
      }));
      if (result.ok) router.replace("/documents");
      else setError(result.error);
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-semibold text-coral-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
        </svg>
        Delete this deck
      </button>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border-[1.5px] border-coral-strong bg-coral-wash p-4 sm:p-5">
      <p className="m-0 text-[15px] text-pretty text-coral-ink">
        <strong>Delete this deck?</strong> Its questions, your answers and the file you uploaded are
        deleted for good. Credits it used aren&apos;t given back.
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={remove} disabled={pending} className={button("danger")}>
          {pending ? "Deleting…" : "Delete deck"}
        </button>
        <button
          ref={keep}
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className={button("line")}
        >
          Keep it
        </button>
      </div>
      {error && (
        <p role="alert" className="m-0 text-sm font-semibold text-coral-ink">
          {error}
        </p>
      )}
    </div>
  );
}
