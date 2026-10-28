import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  gradeDiagramAnswers,
  gradeMcqChoice,
  gradeShortAnswerResponse,
  gradeTableAnswers,
  markEssay,
  rateFlashcard,
} from "@/app/(product)/grade-actions";
import { LockedQuestions } from "@/components/locked-questions";
import { StudySession } from "@/components/study-session";
import { button, Card } from "@/components/ui";
import { requireUser } from "@/lib/dal/auth";
import { getStudyDeck } from "@/lib/dal/questions";

export const metadata: Metadata = { title: "Study" };

/** Marking a written answer waits on a model: up to 90 s, then the credits go back. */
export const maxDuration = 120;

/**
 * One continuous run through a document's ready questions, graded from Postgres, opening on the
 * first one not answered yet. The page gets public fields only (lib/dal/questions.ts); answers,
 * the unblanked diagram and the source slide arrive from the grading actions once an attempt is
 * stored.
 */
export default async function StudyPage({ params }: PageProps<"/documents/[id]/study">) {
  const { id } = await params;
  const user = await requireUser();
  const deck = await getStudyDeck(user, id);
  if (!deck) notFound();

  const backHref = `/documents/${id}`;

  if (deck.questions.length === 0) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-10">
        <Card className="max-w-xl animate-rise p-7">
          <h1 className="m-0 font-display text-3xl font-extrabold tracking-[-0.03em]">
            Nothing to study yet
          </h1>
          <p className="mt-2 mb-0 text-ink-muted">
            {deck.status === "failed"
              ? `${deck.filename} couldn't be turned into questions.`
              : `No questions from ${deck.filename} are ready yet.`}
          </p>
          <Link href={backHref} className={`mt-6 ${button("line")}`}>
            Back to the deck
          </Link>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <StudySession
        questions={deck.questions}
        actions={{
          gradeDiagramAnswers,
          gradeMcqChoice,
          gradeShortAnswerResponse,
          gradeTableAnswers,
          rateFlashcard,
          markEssay,
        }}
        backHref={backHref}
        backLabel={deck.filename}
        startAt={deck.startAt}
        locked={deck.locked}
        lockedCard={<LockedQuestions count={deck.locked} next={`/documents/${id}/study`} />}
      />
    </main>
  );
}
