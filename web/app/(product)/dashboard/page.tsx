import type { Metadata } from "next";
import Link from "next/link";

import { DeckCard, UploadTile } from "@/components/deck-card";
import { isInProgress } from "@/components/pipeline-steps";
import { RefreshWhile } from "@/components/refresh-while";
import { SignedImage } from "@/components/signed-image";
import { button, Card, HandNote, KindTag, ProgressBar } from "@/components/ui";
import { UploadPanel } from "@/components/upload-panel";
import { requireUser } from "@/lib/dal/auth";
import { getBalance } from "@/lib/dal/credits";
import { deckToContinue, getUploadQuota, listDecks, type Deck } from "@/lib/dal/documents";
import { getStudyDeck, type StudyDeck } from "@/lib/dal/questions";
import type { PublicQuestion } from "@/lib/public-question";

export const metadata: Metadata = { title: "Home" };

/** Home shows the newest few; the Decks tab has them all. */
const RECENT_DECKS = 3;

const H1 = "mt-1 mb-0 font-display text-[clamp(32px,4vw,46px)] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance";
const H2 = "m-0 font-display text-[28px] leading-tight font-extrabold tracking-[-0.02em]";

/**
 * Home: the question to carry on with, a tally of the work so far, and the newest decks. A first
 * visit gets the upload form instead. There is no "due for review" list until spaced repetition
 * exists to fill it.
 */
export default async function HomePage() {
  const user = await requireUser();
  const [decks, quota, credits] = await Promise.all([listDecks(), getUploadQuota(), getBalance()]);
  const current = deckToContinue(decks);
  const study = current ? await getStudyDeck(user, current.id) : null;
  const busy = decks.some((deck) => isInProgress(deck.status));
  const now = new Date();

  if (decks.length === 0) {
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
        <div className="animate-rise">
          <HandNote>welcome</HandNote>
          <h1 className={H1}>Turn your next lecture into a quiz.</h1>
        </div>
        <Card className="flex animate-rise flex-col gap-6 p-6 [animation-delay:80ms] sm:p-8">
          <div className="flex flex-col gap-2">
            <h2 className={H2}>Start with one deck</h2>
            <p className="m-0 max-w-[60ch] text-pretty text-ink-muted">
              Upload the slides from a lecture. FigureQuiz finds the labelled diagrams, blanks the
              labels for you to fill back in, and writes questions from the text.
            </p>
          </div>
          <UploadPanel quota={quota} credits={credits} />
          <p className="m-0 text-[15px] text-ink-muted">
            Not ready to upload?{" "}
            <Link href="/demo" className="link-marker font-semibold text-ink">
              Try the sample deck
            </Link>{" "}
            first.
          </p>
        </Card>
      </main>
    );
  }

  const next = study?.questions[study.startAt];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-9 px-4 py-10 sm:px-6">
      <div className="animate-rise">
        <HandNote>welcome back</HandNote>
        <h1 className={H1}>Pick up where you left off.</h1>
      </div>

      <div className="flex flex-wrap items-stretch gap-7">
        {current && study && next ? (
          <ContinueCard deck={current} study={study} next={next} />
        ) : (
          <NothingToContinue state={busy ? "busy" : decks.some((deck) => deck.status === "ready") ? "done" : "failed"} />
        )}
        <SoFar decks={decks} credits={credits} />
      </div>

      <section aria-labelledby="decks-title" className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="decks-title" className="m-0 font-display text-2xl font-extrabold tracking-[-0.02em]">
            Your decks
          </h2>
          {decks.length > RECENT_DECKS && (
            <Link href="/documents" className="link-marker text-[15px] font-semibold text-ink">
              See all {decks.length}
            </Link>
          )}
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(250px,100%),1fr))] gap-6">
          {decks.slice(0, RECENT_DECKS).map((deck) => (
            <DeckCard key={deck.id} deck={deck} now={now} />
          ))}
          <UploadTile />
        </div>
      </section>

      <RefreshWhile active={busy} />
    </main>
  );
}

/** The next unanswered question in the deck studied most recently, and the way back into it. */
function ContinueCard({ deck, study, next }: { deck: Deck; study: StudyDeck; next: PublicQuestion }) {
  const total = study.questions.length;
  const answered = Math.min(deck.progress?.answered ?? 0, total);

  return (
    <Card as="article" className="flex min-w-0 flex-[1.6_1_560px] animate-rise flex-col gap-5 p-5 [animation-delay:80ms] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <KindTag>{next.typeLabel}</KindTag>
            <span className="text-sm text-ink-muted">{next.sourceRef}</span>
          </div>
          <h2 className={H2}>{next.title}</h2>
        </div>
        <p className="m-0 font-hand text-2xl leading-none font-semibold text-ink-muted">
          {answered > 0 ? "up next" : "start here"}
        </p>
      </div>

      {next.type === "diagram" ? (
        <div className="overflow-hidden rounded-lg border-[1.5px] border-ink bg-white">
          <SignedImage
            key={next.id}
            src={next.image}
            alt={`${next.title}, with its labels blanked`}
            className="mx-auto block h-auto max-h-[420px] w-auto max-w-full"
          />
        </div>
      ) : next.type === "table" ? (
        <TablePreview question={next} />
      ) : (
        <p className="m-0 rounded-lg border-[1.5px] border-dashed border-dash bg-panel px-5 py-6 text-lg leading-relaxed text-pretty">
          {next.type === "flashcard" ? next.front : next.prompt}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-4">
        <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-2">
          <div className="flex justify-between gap-3 text-sm font-semibold">
            <span>
              Question {study.startAt + 1} of {total}
            </span>
            <span className="text-ink-muted">{answered} answered</span>
          </div>
          <ProgressBar value={answered} max={total} label={`${answered} of ${total} answered`} />
        </div>
        <Link href={`/documents/${deck.id}/study`} className={button("ink")}>
          {answered > 0 ? "Continue" : "Start"}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </Link>
      </div>
    </Card>
  );
}

/** A table question's first rows, its blanks as numbered tags: a glimpse, not the exercise. */
function TablePreview({ question }: { question: Extract<PublicQuestion, { type: "table" }> }) {
  const rows = question.rows.slice(0, question.headerRows + 3);
  return (
    <div className="overflow-hidden rounded-lg border-[1.5px] border-ink bg-white">
      <table className="w-full table-fixed border-collapse text-sm">
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={index}
              className={
                index < question.headerRows
                  ? "bg-marker-soft text-xs font-bold tracking-[0.08em] uppercase"
                  : "border-t-[1.5px] border-dashed border-dash"
              }
            >
              {row.map((cell, col) => (
                <td key={col} className="truncate px-3 py-2.5">
                  {typeof cell === "string" ? (
                    cell
                  ) : (
                    <span className="inline-flex h-7 w-full max-w-28 items-center rounded-[4px] border-[1.5px] border-ink bg-tag pl-1 shadow-tag">
                      <span className="grid size-5 place-items-center rounded-full border-[1.5px] border-ink bg-marker text-[10px] font-bold">
                        {cell.blank}
                      </span>
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const NOTHING_TO_CONTINUE = {
  busy: {
    note: "almost there",
    title: "Your questions are on their way.",
    body: "Your deck is being read and its questions written. They will be here in a minute or two.",
  },
  done: {
    note: "all caught up",
    title: "You've answered every question.",
    body: "Study a deck again to go over it, or upload your next lecture.",
  },
  failed: {
    note: "nothing to study yet",
    title: "None of your decks could be read.",
    body: "Each deck below says why. Upload another one to start.",
  },
} as const;

function NothingToContinue({ state }: { state: keyof typeof NOTHING_TO_CONTINUE }) {
  const { note, title, body } = NOTHING_TO_CONTINUE[state];
  return (
    <Card className="flex min-w-0 flex-[1.6_1_560px] animate-rise flex-col justify-center gap-2 p-6 [animation-delay:80ms] sm:p-8">
      <HandNote className="text-2xl text-ink-muted">{note}</HandNote>
      <h2 className={H2}>{title}</h2>
      <p className="m-0 text-pretty text-ink-muted">{body}</p>
    </Card>
  );
}

/** Answers and decks so far, and the credits left. */
function SoFar({ decks, credits }: { decks: Deck[]; credits: number }) {
  const answered = decks.reduce((sum, deck) => sum + (deck.progress?.answered ?? 0), 0);
  const ready = decks.filter((deck) => deck.status === "ready").length;

  return (
    <Card as="section" aria-labelledby="so-far-title" className="flex min-w-0 flex-[1_1_300px] animate-rise flex-col gap-5 p-6 [animation-delay:160ms]">
      <h2 id="so-far-title" className="m-0 font-display text-[22px] font-extrabold tracking-[-0.02em]">
        So far
      </h2>
      <dl className="m-0 grid grid-cols-2 gap-4">
        <Stat value={answered} label={answered === 1 ? "question answered" : "questions answered"} />
        <Stat value={ready} label={ready === 1 ? "deck to study" : "decks to study"} />
      </dl>
      <div className="mt-auto flex flex-col gap-3">
        <Link href="/credits" className="font-hand text-[22px] leading-tight font-semibold text-ink hover:underline">
          {credits} {credits === 1 ? "credit" : "credits"} left, one per page
        </Link>
        <Link href="/documents" className={button("line")}>
          Upload a deck
        </Link>
      </div>
    </Card>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col-reverse gap-1 rounded-lg border-[1.5px] border-dashed border-dash bg-panel px-4 py-3">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="m-0 font-display text-4xl leading-none font-extrabold">{value}</dd>
    </div>
  );
}
