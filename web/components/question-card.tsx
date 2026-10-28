"use client";

import { useId, useState } from "react";

import { DiagramQuestion } from "@/components/diagram-question";
import { EssayQuestion } from "@/components/essay-question";
import { SourceSlide } from "@/components/source-slide";
import { TableQuestion } from "@/components/table-question";
import { button, KindTag } from "@/components/ui";
import type { McqOutcome, QuestionActions, ShortAnswerOutcome } from "@/lib/grade-types";
import type { PublicQuestion } from "@/lib/public-question";

export type Outcome = "correct" | "partial" | "wrong" | "skipped";
/** `detail` is a score such as "3/6": blanks right, or with `unit` "points", an essay's points. */
export type Answered = { outcome: Outcome; detail?: string; unit?: "points" };

type Props = {
  question: PublicQuestion;
  /** Server actions that grade an answer — the demo's or the product's. */
  actions: QuestionActions;
  /** Called once the student has committed an answer, so a session can score it. */
  onAnswered?: (answered: Answered) => void;
};

/*
 * Typed answers are graded on spelling, so the phone must not fix it for the student: no
 * autocorrect, no capitalising, and no spellcheck underline hinting at the right word.
 */
const ANSWER_INPUT = {
  autoComplete: "off",
  autoCapitalize: "off",
  autoCorrect: "off",
  spellCheck: false,
} as const;

/** The gap in a fill-in-the-blank prompt (GAP in lib/contracts.ts, kept out of the client bundle). */
const GAP = "____";

export function QuestionCard({ question, actions, onAnswered }: Props) {
  // The source slide shows answers, so it arrives with the grade result, never before.
  const [slideImage, setSlideImage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  /** Runs a grading call. One that throws or comes back empty is reported, and can be retried. */
  async function grade<T>(call: () => Promise<T | null>): Promise<T | null> {
    const result = await call().catch(() => null);
    setFailed(result === null);
    return result;
  }

  const variant = { actions, grade, onAnswered, onUnlock: setSlideImage };

  return (
    <section aria-labelledby={`q-${question.id}`}>
      <div className="flex flex-wrap items-center gap-2.5">
        <KindTag>{question.typeLabel}</KindTag>
        <span className="text-sm text-ink-muted">{question.sourceRef}</span>
      </div>
      <h2
        id={`q-${question.id}`}
        className="mt-2 font-display text-[clamp(24px,3vw,32px)] leading-tight font-extrabold tracking-[-0.025em] text-balance"
      >
        {question.title}
      </h2>

      {(question.type === "diagram" ||
        question.type === "table" ||
        question.type === "mcq" ||
        question.type === "essay") && (
        <p className="mt-2 text-base text-pretty text-ink-muted">{question.prompt}</p>
      )}

      {question.type === "diagram" && (
        <DiagramQuestion
          question={question}
          check={async (responses) => {
            const result = await grade(() => actions.gradeDiagramAnswers(question.id, responses));
            if (!result) return null;
            setSlideImage(result.slideImage);
            onAnswered?.({
              outcome:
                result.score === result.total ? "correct" : result.score === 0 ? "wrong" : "partial",
              detail: `${result.score}/${result.total}`,
            });
            return result;
          }}
        />
      )}
      {question.type === "table" && (
        <TableQuestion
          question={question}
          check={async (responses) => {
            const result = await grade(() => actions.gradeTableAnswers(question.id, responses));
            if (!result) return null;
            setSlideImage(result.slideImage);
            onAnswered?.({
              outcome:
                result.score === result.total ? "correct" : result.score === 0 ? "wrong" : "partial",
              detail: `${result.score}/${result.total}`,
            });
            return result;
          }}
        />
      )}
      {question.type === "mcq" && <Mcq question={question} {...variant} />}
      {question.type === "short_answer" && <ShortAnswer question={question} {...variant} />}
      {question.type === "flashcard" && <Flashcard question={question} {...variant} />}
      {question.type === "essay" &&
        (actions.markEssay && !question.lockedReason ? (
          <EssayQuestion
            question={question}
            mark={actions.markEssay}
            onAnswered={onAnswered}
            onUnlock={setSlideImage}
          />
        ) : (
          <div className="mt-5 flex items-start gap-4 rounded-xl border-[1.5px] border-dashed border-ink bg-panel p-5">
            <LockIcon />
            <div>
              <p className="m-0 font-semibold">Not available yet</p>
              <p className="mt-1 mb-0 text-sm text-ink-muted">
                {question.lockedReason ?? "Written answers are marked in your decks."}
              </p>
            </div>
          </div>
        ))}

      {failed && (
        <p role="alert" className="mt-4 mb-0 text-sm font-semibold text-coral-ink">
          That didn&apos;t go through. Try again.
        </p>
      )}

      <SourceSlide sourceRef={question.sourceRef} slideImage={slideImage} />
    </section>
  );
}

type Variant<T extends PublicQuestion["type"]> = {
  question: Extract<PublicQuestion, { type: T }>;
  actions: QuestionActions;
  grade: <R>(call: () => Promise<R | null>) => Promise<R | null>;
  onAnswered?: (answered: Answered) => void;
  /** Hands up the source slide that came back with the grade result. */
  onUnlock: (slideImage: string) => void;
};

function Mcq({ question, actions, grade, onAnswered, onUnlock }: Variant<"mcq">) {
  const [chosen, setChosen] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<McqOutcome | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    if (chosen === null) return;
    setPending(true);
    const result = await grade(() => actions.gradeMcqChoice(question.id, chosen));
    setPending(false);
    if (!result) return;
    setOutcome(result);
    onUnlock(result.slideImage);
    onAnswered?.({ outcome: result.correct ? "correct" : "wrong" });
  }

  return (
    <div className="mt-5">
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {question.options.map((option, index) => {
          const isAnswer = outcome !== null && index === outcome.answerIndex;
          const isWrongPick = outcome !== null && index === outcome.chosen && !outcome.correct;
          const picked = outcome === null && chosen === index;

          let tone = "bg-white hover:bg-marker-wash";
          if (isAnswer) tone = "answer-right";
          else if (isWrongPick) tone = "answer-wrong bg-coral-wash";
          else if (picked) tone = "bg-marker-soft shadow-tag -translate-y-px";

          return (
            <li key={option} className="animate-rise" style={{ animationDelay: `${index * 0.05}s` }}>
              <label
                className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border-[1.5px] border-ink px-4 py-3 transition-[translate,rotate,background-color,box-shadow] duration-200 ease-spring has-focus-visible:outline-2 has-focus-visible:outline-offset-3 has-focus-visible:outline-ink ${tone}`}
              >
                <input
                  type="radio"
                  name={`choice-${question.id}`}
                  checked={chosen === index}
                  onChange={() => setChosen(index)}
                  disabled={outcome !== null}
                  className="size-4 shrink-0 accent-ink"
                />
                <span className="answer-text text-base text-ink">{option}</span>
                {isAnswer && (
                  <span className="ml-auto shrink-0 rounded-[5px] bg-leaf-wash px-2 py-0.5 text-xs font-bold tracking-[0.06em] text-leaf-ink">
                    RIGHT
                  </span>
                )}
                {isWrongPick && (
                  <span className="ml-auto shrink-0 text-xs font-bold tracking-[0.06em] text-coral-ink">
                    YOUR ANSWER
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        <p aria-live="polite" className="m-0 font-hand text-[26px] leading-tight font-semibold">
          {outcome ? (outcome.correct ? "right, nice one" : "not quite") : "pick one"}
        </p>
        {!outcome && (
          <button
            type="button"
            onClick={submit}
            disabled={pending || chosen === null}
            className={button("ink")}
          >
            {pending ? "Checking…" : "Check answer"}
          </button>
        )}
      </div>
    </div>
  );
}

/** Fill in the blank, typed into the sentence itself, where the gap is. */
function ShortAnswer({ question, actions, grade, onAnswered, onUnlock }: Variant<"short_answer">) {
  const fieldId = useId();
  const [response, setResponse] = useState("");
  const [outcome, setOutcome] = useState<ShortAnswerOutcome | null>(null);
  const [pending, setPending] = useState(false);

  const [before, after = ""] = question.prompt.split(GAP);

  async function submit() {
    if (pending || outcome || response.trim() === "") return;
    setPending(true);
    const result = await grade(() => actions.gradeShortAnswerResponse(question.id, response));
    setPending(false);
    if (!result) return;
    setOutcome(result);
    onUnlock(result.slideImage);
    onAnswered?.({ outcome: result.correct ? "correct" : "wrong" });
  }

  const verdict = outcome ? (outcome.correct ? "answer-right" : "answer-wrong") : "";

  return (
    <div className="mt-5">
      <label htmlFor={fieldId} className="sr-only">
        Fill in the blank
      </label>
      <p className="m-0 text-[clamp(18px,2.2vw,22px)] leading-[2.1] text-pretty">
        {before}
        <span
          className={`mx-1 inline-flex h-11 min-w-[9ch] -rotate-1 items-center rounded-[5px] border-[1.5px] border-ink bg-tag align-middle shadow-tag transition-[translate,rotate,box-shadow] duration-200 ease-spring focus-within:rotate-0 focus-within:shadow-press ${verdict}`}
        >
          <input
            id={fieldId}
            value={response}
            onChange={(event) => setResponse(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
            readOnly={outcome !== null}
            size={Math.max(9, response.length + 1)}
            {...ANSWER_INPUT}
            className="h-full bg-transparent px-3 pt-0.5 font-hand text-[26px] leading-none font-semibold text-ink caret-coral outline-none"
          />
        </span>
        {after}
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        <p aria-live="polite" className="m-0 font-hand text-[26px] leading-tight font-semibold">
          {!outcome && "write it in the gap"}
          {outcome?.correct &&
            (outcome.matched === "fuzzy" ? "right, the typo is forgiven" : "right, nice one")}
          {outcome && !outcome.correct && (
            <span className="text-coral-ink">
              → {outcome.expected}
              {outcome.rejectedAs === "confusable" && (
                <span className="text-ink-muted"> (a look-alike doesn&apos;t count)</span>
              )}
            </span>
          )}
        </p>
        {!outcome && (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={pending || response.trim() === ""}
            className={button("ink")}
          >
            {pending ? "Checking…" : "Check answer"}
          </button>
        )}
      </div>
    </div>
  );
}

/** Self-rated, per CLAUDE.md: no auto-grading, the student judges their own recall. */
function Flashcard({ question, actions, grade, onAnswered, onUnlock }: Variant<"flashcard">) {
  const [revealed, setRevealed] = useState(false);
  const [rated, setRated] = useState<boolean | null>(null);

  async function rate(known: boolean) {
    // The rating is the student's own, so it counts at once; the call records it and fetches the
    // slide. If that fails, the buttons come back so the rating can be sent again.
    setRated(known);
    onAnswered?.({ outcome: known ? "correct" : "wrong" });
    const result = await grade(() => actions.rateFlashcard(question.id, known));
    if (result) onUnlock(result.slideImage);
    else setRated(null);
  }

  const face =
    "col-start-1 row-start-1 flex min-h-48 flex-col justify-center gap-3 rounded-xl border-[1.5px] " +
    "border-ink p-6 shadow-card [backface-visibility:hidden]";

  return (
    <div className="mt-5">
      <div className="[perspective:1400px]">
        <div
          className={`grid transition-transform duration-700 ease-soft [transform-style:preserve-3d] ${revealed ? "[transform:rotateY(180deg)]" : ""}`}
        >
          <div className={`${face} bg-white`} aria-hidden={revealed}>
            <span className="text-xs font-bold tracking-[0.1em] text-ink-muted">FRONT</span>
            <p className="m-0 text-[clamp(18px,2.2vw,22px)] leading-snug text-pretty">{question.front}</p>
          </div>
          <div className={`${face} bg-tag [transform:rotateY(180deg)]`} aria-hidden={!revealed}>
            <span className="text-xs font-bold tracking-[0.1em] text-ink-muted">BACK</span>
            <p className="m-0 font-hand text-[clamp(26px,3vw,32px)] leading-tight font-semibold text-pretty">
              {question.back}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {!revealed ? (
          <button type="button" onClick={() => setRevealed(true)} className={button("ink")}>
            Turn it over
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void rate(true)}
              disabled={rated !== null}
              className={button("ink")}
            >
              I knew it
            </button>
            <button
              type="button"
              onClick={() => void rate(false)}
              disabled={rated !== null}
              className={button("line")}
            >
              Need to review
            </button>
            {rated !== null && (
              <p aria-live="polite" className="m-0 font-hand text-[24px] font-semibold">
                {rated ? "marked as known" : "marked for review"}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-0.5 shrink-0"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
