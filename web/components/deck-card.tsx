import Link from "next/link";

import { isInProgress, PipelineSteps } from "@/components/pipeline-steps";
import { SignedImage } from "@/components/signed-image";
import { button, Card, ProgressBar } from "@/components/ui";
import { QuestionType } from "@/lib/contracts";
import { isStalled, type Deck, type DeckProgress } from "@/lib/dal/documents";
import { pageCount } from "@/lib/format";

/** How a deck's card counts its questions of each type, in the order studying asks them. */
const TYPE_COUNT: Record<QuestionType, (count: number) => string> = {
  diagram_blank: (count) => `${count} ${count === 1 ? "diagram" : "diagrams"}`,
  mcq: (count) => `${count} multiple choice`,
  short_answer: (count) => `${count} fill-in`,
  flashcard: (count) => `${count} ${count === 1 ? "flashcard" : "flashcards"}`,
  table_blank: (count) => `${count} ${count === 1 ? "table" : "tables"}`,
  essay: (count) => `${count} written ${count === 1 ? "answer" : "answers"}`,
};

/** "Week_5-Cranial_Nerves.pdf" → "Week 5 Cranial Nerves": the hand-lettered stand-in for a cover. */
function deckTitle(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || filename;
}

const LIFT =
  "transition-[translate,box-shadow] duration-250 ease-spring hover:-translate-x-0.5 hover:-translate-y-1 hover:shadow-lift";

/** One deck in a grid: ready to study, on its way, or failed with the reason why. */
export function DeckCard({ deck, now }: { deck: Deck; now: Date }) {
  const href = `/documents/${deck.id}`;
  const title = (
    <h3 className="m-0 text-base leading-snug font-bold [overflow-wrap:anywhere]">
      <Link href={href} className="rounded-sm text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
        {deck.filename}
      </Link>
    </h3>
  );

  if (deck.status === "failed") {
    return (
      // Not a Card: its ink border would compete with the coral one.
      <article className="flex flex-col gap-3 rounded-xl border-[1.5px] border-coral-strong bg-white p-3.5 shadow-card">
        <div className="grid aspect-video place-items-center rounded-lg border-[1.5px] border-coral-strong bg-coral-wash">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-coral-strong">
            <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
            <path d="M14 3v5h5M10 12l4 4M14 12l-4 4" />
          </svg>
        </div>
        <div className="flex flex-col gap-1 px-1">
          {title}
          <p className="m-0 text-sm font-semibold text-coral-ink">
            {deck.error ?? "Something went wrong while reading it."}
          </p>
        </div>
        <p className="mt-auto mb-0 px-1 pb-1 text-[13px] text-ink-muted">Upload it again to try once more.</p>
      </article>
    );
  }

  if (isInProgress(deck.status)) {
    return (
      <Card as="article" className="flex flex-col gap-3 p-3.5">
        <DeckThumb deck={deck} busy />
        <div className="flex flex-col gap-1 px-1">
          {title}
          {deck.page_count !== null && (
            <p className="m-0 text-[13px] text-ink-muted">{pageCount(deck.page_count, deck.mime)}</p>
          )}
        </div>
        <div aria-live="polite" className="flex flex-col gap-2 px-1 pb-1">
          <PipelineSteps status={deck.status} mime={deck.mime} pageCount={deck.page_count} size="sm" />
          {isStalled(deck, now) && (
            <p className="m-0 text-[13px] text-ink-muted">
              Taking longer than usual. <Link href={href} className="link-marker font-semibold text-ink">See why</Link>
            </p>
          )}
        </div>
      </Card>
    );
  }

  const progress = deck.progress;
  const questions = progress?.questions ?? 0;
  const answered = progress?.answered ?? 0;
  const done = questions > 0 && answered >= questions;
  const facts = [
    deck.page_count === null ? null : pageCount(deck.page_count, deck.mime),
    `${questions} ${questions === 1 ? "question" : "questions"}`,
  ].filter(Boolean);

  return (
    <Card as="article" className={`flex flex-col gap-3 p-3.5 ${LIFT}`}>
      <DeckThumb deck={deck} />
      <div className="flex flex-col gap-1 px-1">
        {title}
        <p className="m-0 text-[13px] text-ink-muted">{facts.join(" · ")}</p>
      </div>
      {progress && <QuestionTypeTags types={progress.types} className="px-1" />}
      {deck.pages_waiting > 0 && (
        <p className="m-0 px-1 text-[13px] font-semibold text-coral-ink">
          {deck.pages_waiting} {deck.pages_waiting === 1 ? "page is" : "pages are"} waiting for credits
        </p>
      )}
      {questions > 0 && (
        <div className="mt-auto flex flex-col gap-3">
          <div className="px-1">
            <ProgressBar value={answered} max={questions} label={`${answered} of ${questions} answered`} />
          </div>
          <div className="flex items-center justify-between gap-3 px-1 pb-1">
            {done ? (
              <span className="font-hand text-[22px] leading-none font-bold text-leaf">all done, nice</span>
            ) : (
              <span className="text-[13px] font-semibold text-ink-muted">
                {answered === 0 ? "Not started" : `${answered} of ${questions} answered`}
              </span>
            )}
            <Link href={`${href}/study`} className={button(done ? "line" : "ink", "sm")}>
              {done ? "Review" : answered === 0 ? "Study" : "Continue"}
            </Link>
          </div>
        </div>
      )}
    </Card>
  );
}

/** "1 diagram", "6 multiple choice": small paper tags, in the order studying asks them. */
export function QuestionTypeTags({ types, className = "" }: { types: DeckProgress["types"]; className?: string }) {
  return (
    <ul aria-label="Questions by type" className={`m-0 flex list-none flex-wrap gap-1.5 p-0 ${className}`}>
      {QuestionType.options.map((type) => {
        const count = types[type];
        return count ? (
          <li key={type} className="inline-flex h-6 items-center rounded-[5px] border-[1.5px] border-ink bg-tag px-2 text-xs font-semibold">
            {TYPE_COUNT[type](count)}
          </li>
        ) : null;
      })}
    </ul>
  );
}

/** The blanked image of the deck's first diagram, or its name lettered by hand on graph paper. */
function DeckThumb({ deck, busy = false }: { deck: Deck; busy?: boolean }) {
  const cover = deck.progress?.coverUrl;
  return (
    <div className="graph-paper relative grid aspect-video place-items-center overflow-hidden rounded-lg border-[1.5px] border-ink bg-panel">
      {cover ? (
        <SignedImage src={cover} alt="" className="block h-full w-full bg-white object-contain p-2" />
      ) : (
        <span className="relative line-clamp-2 -rotate-2 px-4 text-center font-hand text-[28px] leading-[1.05] font-bold">
          {deckTitle(deck.filename)}
        </span>
      )}
      {busy && (
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-shimmer bg-[linear-gradient(100deg,transparent_30%,rgb(255_225_90/0.55)_50%,transparent_70%)] bg-size-[200%_100%]"
        />
      )}
    </div>
  );
}

/** The dashed "add one" card that ends a grid of decks. */
export function UploadTile() {
  return (
    <Link
      href="/documents"
      className="flex min-h-56 flex-col items-center justify-center gap-2.5 rounded-xl border-[1.5px] border-dashed border-ink bg-white/60 p-6 text-center text-ink transition-colors hover:bg-marker-wash focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ink"
    >
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 16V5m-5 5 5-5 5 5" />
        <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
      </svg>
      <span className="text-base font-bold">Upload a deck</span>
      <span className="font-hand text-[22px] leading-none font-semibold text-ink-muted">PowerPoint or PDF</span>
    </Link>
  );
}
