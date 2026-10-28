"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { QuestionCard, type Answered } from "@/components/question-card";
import { BackLink, button, Card, HandNote, ProgressBar } from "@/components/ui";
import type { QuestionActions } from "@/lib/grade-types";
import type { PublicQuestion } from "@/lib/public-question";

type Props = {
  questions: PublicQuestion[];
  actions: QuestionActions;
  /** The question list this run started from. */
  backHref: string;
  /** What that link is called, e.g. the deck's file name. */
  backLabel?: string;
  /** The question to open on, e.g. the first one not answered on an earlier visit. */
  startAt?: number;
  /** Questions a guest can't open yet: counted in the progress, shown as `lockedCard`. */
  locked?: number;
  /** What a guest sees after their free questions: the way to sign up and keep going. */
  lockedCard?: ReactNode;
};

/** Above this many questions, one segment each would be too thin to read: a bar instead. */
const MAX_SEGMENTS = 40;

/**
 * One continuous run through every question, rather than a page per question: the student
 * answers, sees the result, and moves straight on. The card is keyed by question id, so moving
 * back gives a fresh attempt; the session keeps the recorded outcome for the summary.
 */
export function StudySession({
  questions,
  actions,
  backHref,
  backLabel = "All questions",
  startAt = 0,
  locked = 0,
  lockedCard = null,
}: Props) {
  const [index, setIndex] = useState(startAt);
  const [answers, setAnswers] = useState<Record<string, Answered>>({});
  const [finished, setFinished] = useState(false);

  const total = questions.length + locked;
  // Past a guest's free questions sits one card: the way to sign up for the rest.
  const atLocked = locked > 0 && index >= questions.length;
  const question = questions[index];
  const isLast = index === questions.length - 1 && locked === 0;
  const current = question ? answers[question.id] : undefined;
  const answeredCount = questions.filter((item) => answers[item.id]).length;

  function record(answered: Answered) {
    setAnswers((all) => ({ ...all, [question.id]: answered }));
  }

  function go(next: number) {
    setIndex(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (finished) {
    return (
      <Summary
        questions={questions}
        answers={answers}
        backHref={backHref}
        onRestart={() => {
          setAnswers({});
          setFinished(false);
          go(0);
        }}
      />
    );
  }

  return (
    <div className="pb-32">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <BackLink href={backHref}>{backLabel}</BackLink>
        <div className="flex min-w-0 flex-[1_1_240px] items-center gap-3">
          {total <= MAX_SEGMENTS ? (
            <div
              role="img"
              aria-label={`Question ${Math.min(index + 1, total)} of ${total}, ${answeredCount} answered${locked ? `, ${locked} locked` : ""}`}
              className="flex flex-1 gap-1"
            >
              {questions.map((item, position) => (
                <span
                  key={item.id}
                  className={`h-2 flex-1 rounded-full border-[1.5px] border-ink transition-colors duration-300 ${
                    position === index ? "bg-marker" : answers[item.id] ? "bg-ink" : "bg-white"
                  }`}
                />
              ))}
              {Array.from({ length: locked }, (_, position) => (
                <span
                  key={`locked-${position}`}
                  className={`h-2 flex-1 rounded-full border-[1.5px] border-dashed border-ink-faint ${atLocked ? "bg-marker-soft" : "bg-panel"}`}
                />
              ))}
            </div>
          ) : (
            <div className="flex-1">
              <ProgressBar value={answeredCount} max={total} label={`${answeredCount} of ${total} answered`} />
            </div>
          )}
          <span className="text-sm font-bold whitespace-nowrap">
            {Math.min(index + 1, total)} / {total}
          </span>
        </div>
      </div>

      {atLocked ? (
        <Card className="mt-6 animate-rise p-[clamp(18px,3vw,30px)]" key="locked">
          {lockedCard}
        </Card>
      ) : (
        <Card className="mt-6 animate-rise p-[clamp(18px,3vw,30px)]" key={question.id}>
          <QuestionCard question={question} actions={actions} onAnswered={record} />
        </Card>
      )}

      {/* Fixed so Next is always in reach on a phone, without scrolling past the question. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t-[1.5px] border-ink bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => go(Math.max(0, index - 1))}
            disabled={index === 0}
            className={button("line")}
          >
            Back
          </button>
          <span aria-live="polite" className="truncate font-hand text-[22px] leading-tight font-semibold">
            {atLocked ? "sign up to keep going" : current ? outcomeLabel(current) : "not answered yet"}
          </span>
          {atLocked ? (
            <span aria-hidden="true" className="w-[88px]" />
          ) : (
            <button
              type="button"
              onClick={() => (isLast ? setFinished(true) : go(index + 1))}
              className={button("ink")}
            >
              {isLast ? "Finish" : "Next"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function outcomeLabel(answered: Answered): string {
  if (answered.detail) {
    const [score, total] = answered.detail.split("/");
    return total ? `${score} of ${total} ${answered.unit ?? "right"}` : answered.detail;
  }
  if (answered.outcome === "correct") return "right";
  if (answered.outcome === "wrong") return "not quite";
  return "skipped";
}

function Summary({
  questions,
  answers,
  backHref,
  onRestart,
}: {
  questions: PublicQuestion[];
  answers: Record<string, Answered>;
  backHref: string;
  onRestart: () => void;
}) {
  // A written answer earns points, not right or wrong, so the headline leaves essays out.
  const graded = questions.filter((question) => question.type !== "essay");
  const correct = graded.filter((question) => answers[question.id]?.outcome === "correct").length;

  return (
    <div className="animate-rise">
      <HandNote>session complete</HandNote>
      <h1 className="mt-1 font-display text-[clamp(32px,4vw,46px)] leading-none font-extrabold tracking-[-0.035em]">
        <span className="marker-sweep">
          {correct} of {graded.length}
        </span>{" "}
        answered right
      </h1>

      <Card as="section" className="mt-8 px-5">
        <ul aria-label="Your answers" className="m-0 list-none p-0">
          {questions.map((question) => {
            const answered = answers[question.id];
            const chip =
              question.type === "essay" && question.lockedReason
                ? { text: "LOCKED", tone: "bg-panel text-ink-muted" }
                : !answered
                  ? { text: "NOT ANSWERED", tone: "bg-panel text-ink-muted" }
                  : answered.outcome === "correct"
                    ? { text: outcomeLabel(answered).toUpperCase(), tone: "bg-leaf-wash text-leaf-ink" }
                    : { text: outcomeLabel(answered).toUpperCase(), tone: "bg-coral-wash text-coral-ink" };
            return (
              <li
                key={question.id}
                className="flex min-h-14 items-center justify-between gap-4 border-b-[1.5px] border-dashed border-dash py-3 last:border-b-0"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-semibold">{question.title}</span>
                  <span className="text-[13px] text-ink-muted">{question.typeLabel}</span>
                </span>
                <span
                  className={`shrink-0 rounded-[5px] px-2 py-0.5 text-xs font-bold tracking-[0.06em] ${chip.tone}`}
                >
                  {chip.text}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" onClick={onRestart} className={button("ink")}>
          Study again
        </button>
        <Link href={backHref} className={button("line")}>
          Back to the deck
        </Link>
      </div>
    </div>
  );
}
