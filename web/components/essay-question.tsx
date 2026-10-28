"use client";

import Link from "next/link";
import { useId, useState } from "react";

import type { Answered } from "@/components/question-card";
import { button, HandNote } from "@/components/ui";
import { countWords, ESSAY_MAX_WORDS, MARKING_CREDITS } from "@/lib/essays";
import type { EssayOutcome, EssayResult } from "@/lib/grade-types";
import type { PublicQuestion } from "@/lib/public-question";

type Props = {
  question: Extract<PublicQuestion, { type: "essay" }>;
  mark: (questionId: string, answer: string) => Promise<EssayResult | null>;
  onAnswered?: (answered: Answered) => void;
  /** Hands up the source slide that came back with the marking. */
  onUnlock: (slideImage: string) => void;
};

/**
 * A written answer, marked by a model against the question's rubric. Marking costs credits, so
 * the button says how many, and a failure says why in the student's terms: the server gives the
 * credits back when marking fails (lib/marking.ts).
 */
export function EssayQuestion({ question, mark, onAnswered, onUnlock }: Props) {
  const fieldId = useId();
  const countId = useId();
  const [answer, setAnswer] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; topUp?: boolean } | null>(null);
  const [outcome, setOutcome] = useState<EssayOutcome | null>(null);

  const words = countWords(answer);
  const over = words > ESSAY_MAX_WORDS;

  async function submit() {
    if (pending || words === 0 || over) return;
    setPending(true);
    setError(null);
    const result = await mark(question.id, answer).catch(() => null);
    setPending(false);
    if (!result) return setError({ message: "That didn't go through. Try again." });
    if (!result.ok) return setError({ message: result.error, topUp: result.topUp });
    setOutcome(result.outcome);
    onUnlock(result.outcome.slideImage);
    const { points, outOf } = result.outcome;
    onAnswered?.({
      outcome: points === outOf ? "correct" : points === 0 ? "wrong" : "partial",
      detail: `${points}/${outOf}`,
      unit: "points",
    });
  }

  if (outcome) return <Marked answer={answer} outcome={outcome} />;

  return (
    <div className="mt-5">
      <label htmlFor={fieldId} className="sr-only">
        Your answer
      </label>
      <textarea
        id={fieldId}
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        readOnly={pending}
        aria-describedby={countId}
        rows={9}
        placeholder="Write your answer here, in your own words."
        className="block min-h-56 w-full resize-y rounded-xl border-[1.5px] border-ink bg-white p-4 text-base leading-relaxed text-ink shadow-card outline-none placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ink"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <p id={countId} className={`m-0 text-sm font-semibold ${over ? "text-coral-ink" : "text-ink-muted"}`}>
          {words} / {ESSAY_MAX_WORDS} words{over && " — make it shorter to mark it"}
        </p>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={pending || words === 0 || over}
          className={button("ink")}
        >
          {pending ? "Marking…" : `Mark my answer · ${MARKING_CREDITS} credits`}
        </button>
      </div>

      <div aria-live="polite" className="mt-4">
        {pending ? (
          <HandNote>a careful read takes about twenty seconds</HandNote>
        ) : error ? (
          <p role="alert" className="m-0 text-sm font-semibold text-coral-ink">
            {error.message}{" "}
            {error.topUp && (
              <Link href="/pricing" className="link-marker text-ink">
                Top up
              </Link>
            )}
          </p>
        ) : (
          <HandNote>marked against the points a full answer covers</HandNote>
        )}
      </div>
    </div>
  );
}

function Marked({ answer, outcome }: { answer: string; outcome: EssayOutcome }) {
  return (
    <div className="mt-5 flex flex-col gap-5">
      <div aria-live="polite">
        <p className="m-0 flex items-baseline gap-3">
          <span className="font-display text-[clamp(44px,6vw,60px)] leading-none font-extrabold tracking-[-0.035em]">
            {outcome.points}
            <span className="text-ink-faint">/{outcome.outOf}</span>
          </span>
          <span className="font-semibold text-ink-muted">points</span>
        </p>
        {outcome.comment && (
          <p className="mt-2 mb-0 font-hand text-[24px] leading-snug font-semibold text-pretty">{outcome.comment}</p>
        )}
      </div>

      <ol aria-label="Marks for each point" className="m-0 flex list-none flex-col gap-3 p-0">
        {outcome.criteria.map((item, index) => {
          const tone =
            item.points === item.outOf
              ? "bg-leaf-wash text-leaf-ink"
              : item.points === 0
                ? "bg-coral-wash text-coral-ink"
                : "bg-marker-soft text-ink";
          return (
            <li key={index} className="rounded-xl border-[1.5px] border-ink bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <span className="font-semibold text-pretty">{item.criterion}</span>
                <span className={`shrink-0 rounded-[5px] px-2 py-0.5 text-xs font-bold tracking-[0.06em] ${tone}`}>
                  {item.points}/{item.outOf}
                </span>
              </div>
              <p className="mt-1.5 mb-0 text-sm leading-relaxed text-pretty text-ink-muted">{item.feedback}</p>
            </li>
          );
        })}
      </ol>

      <details className="rounded-xl border-[1.5px] border-dashed border-ink bg-panel px-4">
        <summary className="flex min-h-12 cursor-pointer items-center font-semibold">Your answer</summary>
        <p className="mt-0 mb-4 whitespace-pre-wrap text-pretty">{answer}</p>
      </details>
      <details className="rounded-xl border-[1.5px] border-dashed border-ink bg-panel px-4">
        <summary className="flex min-h-12 cursor-pointer items-center font-semibold">An answer that earns every point</summary>
        <p className="mt-0 mb-4 text-pretty">{outcome.modelAnswer}</p>
      </details>
    </div>
  );
}
