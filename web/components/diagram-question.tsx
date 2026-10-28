"use client";

import { useId, useState, type KeyboardEvent } from "react";

import { button } from "@/components/ui";
import type { DiagramOutcome } from "@/lib/grade-types";
import type { BlankResult } from "@/lib/grading";
import type { MarkerBox, PublicQuestion } from "@/lib/public-question";

type DiagramPublic = Extract<PublicQuestion, { type: "diagram" }>;

type Props = {
  question: DiagramPublic;
  /** Grades the answers, keyed by marker number. Null when the call failed and can be retried. */
  check: (responses: Record<string, string>) => Promise<DiagramOutcome | null>;
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

/**
 * How far a field reaches past its blank's box, in the image's own pixels: the worker's 3px pad,
 * its 2px outline and a 3px margin (ingest/app/blank.py), so the field hides the drawn gap and
 * its number disc at any image size.
 */
const COVER_PX = 8;

type Size = { width: number; height: number };

/** A blank's box grown by COVER_PX, as CSS percentages. Before the image loads: 1% and 1.2%. */
function placement(box: MarkerBox, natural: Size | null) {
  const padX = natural ? COVER_PX / natural.width : 0.01;
  const padY = natural ? COVER_PX / natural.height : 0.012;
  const left = Math.max(0, box.x - padX);
  const top = Math.max(0, box.y - padY);
  const right = Math.min(1, box.x + box.w + padX);
  const bottom = Math.min(1, box.y + box.h + padY);
  return {
    left: `${left * 100}%`,
    top: `${top * 100}%`,
    width: `${(right - left) * 100}%`,
    height: `${(bottom - top) * 100}%`,
  };
}

/** The highlighter for a right answer, the shake and wavy underline for a wrong one. */
export function verdict(result: BlankResult | undefined): string {
  if (!result) return "";
  return result.correct ? "answer-right" : "answer-wrong";
}

/**
 * A diagram question answered on the diagram itself: each numbered blank becomes a paper tag the
 * student types into, sitting exactly where the label was. Below 36rem of card width the tags
 * would be too small to type in, so they become pins and one answer field docks under the image.
 * When positions are unknown, it falls back to a list of fields.
 */
export function DiagramQuestion({ question, check }: Props) {
  const fieldId = useId();
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<DiagramOutcome | null>(null);
  const [pending, setPending] = useState(false);
  const [active, setActive] = useState(question.markers[0]?.number ?? 1);
  const [showOriginal, setShowOriginal] = useState(false);
  const [natural, setNatural] = useState<Size | null>(null);

  const numbers = question.markers.map((marker) => marker.number);
  const placed = question.markers.every((marker) => marker.box !== null);
  const answered = outcome !== null;
  const original = answered && showOriginal;

  const value = (number: number) => responses[String(number)] ?? "";
  const write = (number: number, text: string) =>
    setResponses((current) => ({ ...current, [String(number)]: text }));
  const resultFor = (number: number) => outcome?.results.find((result) => result.number === number);
  const filled = numbers.filter((number) => value(number).trim() !== "").length;

  async function submit() {
    if (pending || answered) return;
    setPending(true);
    const result = await check(responses);
    setPending(false);
    if (result) setOutcome(result);
  }

  function checkOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void submit();
  }

  /** The docked field: Enter moves to the next label, and checks after the last. */
  function nextOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const index = numbers.indexOf(active);
    if (index === numbers.length - 1) void submit();
    else setActive(numbers[index + 1]);
  }

  function step(delta: number) {
    const index = numbers.indexOf(active);
    setActive(numbers[(index + delta + numbers.length) % numbers.length]);
  }

  return (
    <div className="@container mt-5">
      <div className="relative rounded-lg border-[1.5px] border-ink bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs, no loader */}
        <img
          src={original ? outcome.revealImage : question.image}
          alt={original ? "The diagram with its original labels" : "Diagram with numbered blanks"}
          onLoad={(event) =>
            setNatural({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          className="block h-auto w-full rounded-[7px]"
        />

        {placed && !original && (
          <>
            {/* Wide: type straight onto each blank. */}
            <div className="absolute inset-0 hidden @xl:block">
              {question.markers.map(({ number, box }, index) => {
                const result = resultFor(number);
                const tilt = index % 2 === 0 ? "-rotate-[1.8deg]" : "rotate-[1.4deg]";
                return (
                  <div
                    key={number}
                    className="absolute animate-tag-in"
                    style={{ ...placement(box!, natural), animationDelay: `${0.2 + index * 0.08}s` }}
                  >
                    <div
                      className={`relative flex h-full w-full items-center rounded-[5px] border-[1.5px] border-ink bg-tag shadow-tag transition-[translate,rotate,box-shadow] duration-200 ease-spring focus-within:-translate-y-0.5 focus-within:rotate-0 focus-within:shadow-press ${tilt} ${verdict(result)}`}
                    >
                      <label
                        htmlFor={`${fieldId}-${number}`}
                        className={`absolute top-1/2 left-0 grid size-7 -translate-x-1/2 -translate-y-1/2 cursor-text place-items-center rounded-full border-[1.5px] border-ink text-[13px] font-bold ${result && !result.correct ? "bg-coral-wash" : "bg-marker"}`}
                      >
                        {number}
                      </label>
                      <input
                        id={`${fieldId}-${number}`}
                        aria-label={`Label ${number}`}
                        value={value(number)}
                        onChange={(event) => write(number, event.target.value)}
                        onKeyDown={checkOnEnter}
                        onFocus={() => setActive(number)}
                        readOnly={answered}
                        {...ANSWER_INPUT}
                        className={`h-full w-full min-w-0 bg-transparent pt-0.5 pl-[18px] font-hand leading-none font-semibold text-ink caret-coral outline-none ${result?.correct ? "pr-6" : "pr-2"}`}
                        style={{ fontSize: "clamp(14px, 2.2cqi, 22px)" }}
                      />
                      {result?.correct && <Tick />}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Narrow: tap a pin, write in the docked field. */}
            <div className="absolute inset-0 @xl:hidden">
              {question.markers.map(({ number, box }, index) => {
                const result = resultFor(number);
                const text = value(number);
                const selected = number === active && !answered;
                return (
                  <button
                    key={number}
                    type="button"
                    onClick={() => setActive(number)}
                    disabled={answered}
                    aria-label={`Label ${number}${text ? `: ${text}` : ", empty"}`}
                    aria-pressed={selected}
                    className={`absolute flex animate-tag-in items-center gap-0.5 rounded-[4px] border-[1.5px] border-ink bg-tag pr-1 text-left font-hand text-[13px] leading-none font-semibold text-ink shadow-tag transition-transform duration-200 ease-spring after:absolute after:-inset-1.5 after:content-[''] disabled:cursor-default ${selected ? "z-10 -translate-y-0.5 scale-105 ring-4 ring-marker" : ""} ${verdict(result)}`}
                    style={{ ...placement(box!, natural), animationDelay: `${0.2 + index * 0.06}s` }}
                  >
                    <span className="-ml-2.5 grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px] border-ink bg-marker font-sans text-[10px] font-bold">
                      {number}
                    </span>
                    <span className="answer-text truncate">{text}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {placed && !answered && (
        <div className="mt-3 rounded-xl border-[1.5px] border-ink bg-white p-4 shadow-card @xl:hidden">
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => step(-1)} aria-label="Previous label" className={ROUND}>
              <Chevron direction="left" />
            </button>
            <div className="flex flex-col items-center gap-1.5">
              <label htmlFor={`${fieldId}-docked`} className="text-[15px] font-bold">
                Label {active} of {numbers.length}
              </label>
              <span aria-hidden="true" className="flex gap-1.5">
                {numbers.map((number) => (
                  <span
                    key={number}
                    className={`size-2 rounded-full border-[1.5px] border-ink transition-transform ${
                      number === active ? "scale-125 bg-marker" : value(number) ? "bg-ink" : ""
                    }`}
                  />
                ))}
              </span>
            </div>
            <button type="button" onClick={() => step(1)} aria-label="Next label" className={ROUND}>
              <Chevron direction="right" />
            </button>
          </div>
          <input
            id={`${fieldId}-docked`}
            value={value(active)}
            onChange={(event) => write(active, event.target.value)}
            onKeyDown={nextOnEnter}
            placeholder="write the label"
            enterKeyHint={numbers.indexOf(active) === numbers.length - 1 ? "done" : "next"}
            {...ANSWER_INPUT}
            className="mt-3 h-14 w-full rounded-lg border-[1.5px] border-ink bg-tag px-4 pt-1 font-hand text-[30px] leading-none font-semibold text-ink caret-coral shadow-tag outline-none placeholder:text-ink-ghost focus:shadow-focus"
          />
        </div>
      )}

      {!placed && (
        <ol className="mt-4 flex flex-col gap-3">
          {numbers.map((number) => {
            const result = resultFor(number);
            return (
              <li key={number} className="flex items-center gap-3">
                <label
                  htmlFor={`${fieldId}-${number}`}
                  className="grid size-7 shrink-0 place-items-center rounded-full border-[1.5px] border-ink bg-marker text-[13px] font-bold"
                >
                  {number}
                </label>
                <div className={`flex h-12 flex-1 items-center rounded-[5px] border-[1.5px] border-ink bg-tag shadow-tag ${verdict(result)}`}>
                  <input
                    id={`${fieldId}-${number}`}
                    aria-label={`Label ${number}`}
                    value={value(number)}
                    onChange={(event) => write(number, event.target.value)}
                    onKeyDown={checkOnEnter}
                    readOnly={answered}
                    {...ANSWER_INPUT}
                    className="h-full w-full bg-transparent px-3 pt-0.5 font-hand text-[24px] leading-none font-semibold text-ink caret-coral outline-none"
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {outcome && (
        <ol aria-label="Your labels" className="mt-4 rounded-xl border-[1.5px] border-ink bg-white px-4 shadow-card">
          {outcome.results.map((result) => (
            <li
              key={result.number}
              className="flex min-h-12 items-center gap-3 border-b-[1.5px] border-dashed border-dash py-2 last:border-b-0"
            >
              <span className="grid size-[26px] shrink-0 place-items-center rounded-full border-[1.5px] border-ink bg-marker text-xs font-bold">
                {result.number}
              </span>
              <span
                className={`min-w-0 flex-1 truncate font-hand text-[23px] leading-tight font-semibold ${result.response ? "" : "text-ink-ghost"}`}
              >
                {result.response || "left blank"}
              </span>
              {result.correct ? (
                <span className="shrink-0 rounded-[5px] bg-leaf-wash px-2 py-0.5 text-xs font-bold tracking-[0.06em] text-leaf-ink">
                  {result.matched === "fuzzy" ? "RIGHT, TYPO FORGIVEN" : "RIGHT"}
                </span>
              ) : (
                <span className="shrink-0 font-hand text-[22px] leading-tight font-bold text-coral-ink">
                  → {result.expected}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        <p aria-live="polite" className="m-0 font-hand text-[26px] leading-tight font-semibold">
          {outcome
            ? `${outcome.score} of ${outcome.total} right${outcome.score === outcome.total ? ", every one!" : ""}`
            : `${filled} of ${numbers.length} written`}
        </p>
        {outcome ? (
          <button
            type="button"
            onClick={() => setShowOriginal((shown) => !shown)}
            aria-pressed={showOriginal}
            className={button("line")}
          >
            {showOriginal ? "Back to my answers" : "Show the original labels"}
          </button>
        ) : (
          <button type="button" onClick={() => void submit()} disabled={pending} className={button("ink")}>
            {pending ? "Checking…" : "Check answers"}
          </button>
        )}
      </div>
    </div>
  );
}

const ROUND =
  "grid size-11 shrink-0 place-items-center rounded-full border-[1.5px] border-ink bg-white " +
  "hover:bg-marker-soft focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ink";

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={direction === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

/** The hand-drawn tick that draws itself on a right answer. */
export function Tick() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="absolute top-1/2 right-1.5 size-4 -translate-y-1/2 animate-draw text-leaf [stroke-dasharray:26] [stroke-dashoffset:26]"
    >
      <path d="M2.5 9c1.5 1.2 2.6 2.4 3.6 3.8C8 9 10.5 5.8 13.8 3" />
    </svg>
  );
}
