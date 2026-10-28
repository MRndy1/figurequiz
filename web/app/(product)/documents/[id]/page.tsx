import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { QuestionTypeTags } from "@/components/deck-card";
import { DeleteDeck } from "@/components/delete-deck";
import { FinishDeckButton } from "@/components/finish-deck-button";
import { isInProgress } from "@/components/pipeline-steps";
import { SignedImage } from "@/components/signed-image";
import { StudyDesk } from "@/components/study-desk";
import { BackLink, button, Card, HandNote, ProgressBar } from "@/components/ui";
import { getBalance, getDeckCredits } from "@/lib/dal/credits";
import { canDelete, getDeck, getDesk, isStalled, type Deck, type Desk } from "@/lib/dal/documents";
import { firstUp, justFinished } from "@/lib/desk";
import { megabytes, pageCount } from "@/lib/format";

type Props = { params: Promise<{ id: string }> };

/** "Finish this deck" writes questions after its response, so the page gets generation's time. */
export const maxDuration = 300;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: (await getDeck(id))?.filename };
}

const NOTE: Record<Deck["status"], string> = {
  uploading: "unfinished upload",
  queued: "on its way",
  processing: "on its way",
  extracted: "on its way",
  generating: "on its way",
  ready: "ready to study",
  failed: "couldn't read this one",
};

/** One deck: where it is in the pipeline, why it failed, or what it holds and the way in. */
export default async function DeckPage({ params }: Props) {
  const { id } = await params;
  const deck = await getDeck(id);
  if (!deck) notFound();
  const [spent, balance, desk] = await Promise.all([
    getDeckCredits(deck.id),
    getBalance(),
    isInProgress(deck.status) ? getDesk(deck.id) : null,
  ]);

  const questions = deck.progress?.questions ?? 0;
  const facts = [
    megabytes(deck.size_bytes),
    deck.page_count === null ? null : pageCount(deck.page_count, deck.mime),
    deck.status === "ready" ? `${questions} ${questions === 1 ? "question" : "questions"}` : null,
    spent > 0 ? `${spent} ${spent === 1 ? "credit" : "credits"}` : null,
  ].filter(Boolean);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="self-start">
        <BackLink href="/documents">Your decks</BackLink>
      </div>

      <div className="animate-rise">
        <HandNote>{deck.status === "ready" && questions === 0 ? "nothing to study" : NOTE[deck.status]}</HandNote>
        <h1 className="mt-1 mb-0 font-display text-[clamp(28px,4vw,40px)] leading-[1.05] font-extrabold tracking-[-0.03em] [overflow-wrap:anywhere]">
          {deck.filename}
        </h1>
        <p className="mt-2 mb-0 text-ink-muted">{facts.join(" · ")}</p>
      </div>

      <div className="animate-rise [animation-delay:80ms]">
        <StatusPanel deck={deck} desk={desk} outOfCredits={balance < 1} now={new Date()} />
      </div>

      {canDelete(deck.status) && (
        <div className="animate-rise [animation-delay:160ms]">
          <DeleteDeck documentId={deck.id} />
        </div>
      )}
    </main>
  );
}

type PanelProps = {
  deck: Deck;
  /** What has been saved so far, while the deck is on its way. */
  desk: Desk | null;
  outOfCredits: boolean;
  now: Date;
};

function StatusPanel({ deck, desk, outOfCredits, now }: PanelProps) {
  if (isInProgress(deck.status) && desk) {
    return <StudyDesk deck={deck} desk={desk} stalled={isStalled(deck, now)} />;
  }

  if (deck.status === "failed") {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border-[1.5px] border-coral-strong bg-coral-wash p-6 sm:p-8">
        <p className="m-0 font-display text-2xl font-extrabold tracking-[-0.02em] text-coral-ink">
          This deck couldn&apos;t be turned into questions
        </p>
        <p className="m-0 text-pretty text-coral-ink">
          {deck.error ?? "Something went wrong while reading it."}
        </p>
        <div className="mt-2 flex flex-wrap items-start gap-3">
          {/* A deck that was read can have its questions written again; one that wasn't can't. */}
          {deck.page_count !== null && (
            <FinishDeckButton
              documentId={deck.id}
              label={deck.pages_waiting > 0 ? "Finish this deck" : "Try again"}
              outOfCredits={outOfCredits}
            />
          )}
          <Link href="/documents" className={button("line")}>
            Upload it again
          </Link>
        </div>
      </div>
    );
  }

  if (deck.status === "uploading") {
    return (
      <Card className="flex flex-col items-start gap-3 p-6 sm:p-8">
        <p className="m-0 font-display text-2xl font-extrabold tracking-[-0.02em]">This upload didn&apos;t finish</p>
        <p className="m-0 text-ink-muted">The file never fully arrived. Upload it again from your decks.</p>
        <Link href="/documents" className={`mt-2 ${button("line")}`}>
          Go to your decks
        </Link>
      </Card>
    );
  }

  const progress = deck.progress;
  if (!progress || progress.questions === 0) {
    return (
      <Card className="flex flex-col items-start gap-3 p-6 sm:p-8">
        <p className="m-0 font-display text-2xl font-extrabold tracking-[-0.02em]">No questions came out of this deck</p>
        <p className="m-0 text-pretty text-ink-muted">
          It was read, but nothing in it could be turned into a question. Decks with labelled diagrams
          and full sentences work best.
        </p>
      </Card>
    );
  }

  const { questions, answered, types, coverUrl } = progress;
  const done = answered >= questions;
  const pagesWaiting = deck.pages_waiting > 0 && (
    <PagesWaiting pages={deck.pages_waiting} documentId={deck.id} outOfCredits={outOfCredits} />
  );

  // For the student who watched it being made: the deck fanned out on the desk, and the way in.
  if (justFinished(deck, now)) {
    const first = firstUp(types);
    return (
      <StudyDesk deck={deck} desk={{ found: [], written: questions, latest: null, types }}>
        <div className="flex animate-desk-pop flex-col items-start gap-4">
          <div className="flex flex-wrap items-center gap-3.5">
            <Link href={`/documents/${deck.id}/study`} className={`shadow-marker ${button("ink", "lg")}`}>
              Start studying
            </Link>
            {first && <span className="text-sm text-ink-muted">{first}</span>}
          </div>
          {pagesWaiting}
        </div>
      </StudyDesk>
    );
  }

  return (
    <Card className="flex flex-wrap items-center gap-8 p-6 sm:p-8">
      {coverUrl && (
        <div className="min-w-0 flex-[1_1_300px] overflow-hidden rounded-lg border-[1.5px] border-ink bg-white">
          <SignedImage src={coverUrl} alt="The deck's first diagram, its labels blanked" className="block h-auto w-full" />
        </div>
      )}
      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-4">
        <QuestionTypeTags types={types} />
        <div className="flex flex-col gap-2">
          <ProgressBar value={answered} max={questions} label={`${answered} of ${questions} answered`} />
          {done ? (
            <p className="m-0 font-hand text-[22px] leading-none font-bold text-leaf">all done, nice</p>
          ) : (
            <p className="m-0 text-sm font-semibold text-ink-muted">
              {answered === 0 ? "Not started yet" : `${answered} of ${questions} answered`}
            </p>
          )}
        </div>
        <Link href={`/documents/${deck.id}/study`} className={`self-start ${button(done ? "line" : "ink", "lg")}`}>
          {done ? "Study it again" : answered === 0 ? "Start studying" : "Continue"}
        </Link>
        {pagesWaiting}
      </div>
    </Card>
  );
}

/** Pages a run left for lack of credits, and the button that writes them. */
function PagesWaiting({ pages, documentId, outOfCredits }: { pages: number; documentId: string; outOfCredits: boolean }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border-[1.5px] border-dashed border-ink bg-marker-soft p-4">
      <p className="m-0 text-[15px] text-pretty">
        <strong>
          {pages} more {pages === 1 ? "page" : "pages"}
        </strong>{" "}
        could get questions. Your credits ran out before them.
      </p>
      <FinishDeckButton documentId={documentId} label="Finish this deck" outOfCredits={outOfCredits} />
    </div>
  );
}
