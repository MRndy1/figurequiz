import type { Metadata } from "next";
import Link from "next/link";

import { DeckCard } from "@/components/deck-card";
import { isInProgress } from "@/components/pipeline-steps";
import { RefreshWhile } from "@/components/refresh-while";
import { HandNote } from "@/components/ui";
import { UploadPanel } from "@/components/upload-panel";
import { getBalance } from "@/lib/dal/credits";
import { getUploadQuota, listDecks } from "@/lib/dal/documents";

export const metadata: Metadata = { title: "Your decks" };

/** Every deck, newest first, under the drop zone. Cards on their way update themselves. */
export default async function DecksPage() {
  const [decks, quota, credits] = await Promise.all([listDecks(), getUploadQuota(), getBalance()]);
  const now = new Date();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-7 px-4 py-10 sm:px-6">
      <div className="animate-rise">
        <HandNote>{credits > 0 ? `${credits} ${credits === 1 ? "credit" : "credits"} left` : "out of credits"}</HandNote>
        <h1 className="mt-1 mb-0 font-display text-[clamp(32px,4vw,46px)] leading-[1.02] font-extrabold tracking-[-0.035em]">
          Your decks
        </h1>
      </div>

      <div className="animate-rise [animation-delay:80ms]">
        <UploadPanel quota={quota} credits={credits} />
      </div>

      {decks.length === 0 ? (
        <p className="m-0 text-ink-muted">
          No decks yet. Upload one above, or{" "}
          <Link href="/demo" className="link-marker font-semibold text-ink">
            try the sample deck
          </Link>{" "}
          to see what its questions look like.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(270px,100%),1fr))] gap-6">
          {decks.map((deck, index) => (
            <div key={deck.id} className="grid animate-rise" style={{ animationDelay: `${120 + Math.min(index, 8) * 50}ms` }}>
              <DeckCard deck={deck} now={now} />
            </div>
          ))}
        </div>
      )}

      <RefreshWhile active={decks.some((deck) => isInProgress(deck.status))} />
    </main>
  );
}
