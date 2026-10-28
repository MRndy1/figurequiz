"use client";

import { useId, useState, type KeyboardEvent } from "react";

import { Tick, verdict } from "@/components/diagram-question";
import { button } from "@/components/ui";
import type { TableOutcome } from "@/lib/grade-types";
import type { BlankResult } from "@/lib/grading";
import type { PublicQuestion, TableCell } from "@/lib/public-question";

type TablePublic = Extract<PublicQuestion, { type: "table" }>;

type Props = {
  question: TablePublic;
  /** Grades the answers, keyed by blank number. Null when the call failed and can be retried. */
  check: (responses: Record<string, string>) => Promise<TableOutcome | null>;
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

type Blank = { blank: number };

/**
 * A table question answered in the table itself: each blanked cell is a paper tag to type into.
 * From 36rem of card width it is a real table; narrower, each row becomes a card of heading and
 * cell pairs, so a phone never scrolls sideways. Tab moves between cells, Enter checks. After
 * checking, each wrong cell shows what it said.
 */
export function TableQuestion({ question, check }: Props) {
  const fieldId = useId();
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<TableOutcome | null>(null);
  const [pending, setPending] = useState(false);

  const headings = question.headerRows > 0 ? question.rows[0] : null;
  const body = question.rows.slice(question.headerRows);
  const numbers = body.flatMap((row) => row.flatMap((cell) => (isBlank(cell) ? [cell.blank] : [])));
  const filled = numbers.filter((number) => (responses[number] ?? "").trim() !== "").length;

  async function submit() {
    if (pending || outcome) return;
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

  const heading = (col: number) => {
    const text = headings?.[col];
    return typeof text === "string" && text ? text : `Column ${col + 1}`;
  };

  /** "Blank 2, Hormone, Thyroid": the number, its column's heading, and the row's first cell. */
  const labelFor = (number: number, row: TableCell[], col: number) => {
    const first = row[0];
    const rowName = col > 0 && typeof first === "string" && first ? first : null;
    return [`Blank ${number}`, headings ? heading(col) : null, rowName].filter(Boolean).join(", ");
  };

  const field = (cell: Blank, row: TableCell[], col: number, layout: "wide" | "narrow") => (
    <CellField
      id={`${fieldId}-${layout}-${cell.blank}`}
      number={cell.blank}
      label={labelFor(cell.blank, row, col)}
      value={responses[cell.blank] ?? ""}
      onChange={(text) => setResponses((current) => ({ ...current, [cell.blank]: text }))}
      onKeyDown={checkOnEnter}
      result={outcome?.results.find((result) => result.number === cell.blank)}
    />
  );

  return (
    <div className="@container mt-5">
      <div className="hidden overflow-x-auto pb-1 @xl:block">
        <table className="w-full border-separate border-spacing-0 overflow-hidden rounded-[10px] border-[1.5px] border-ink bg-white text-[15px]">
          {headings && (
            <thead>
              <tr>
                {headings.map((cell, col) => (
                  <th
                    key={col}
                    scope="col"
                    className="border-b-[1.5px] border-ink bg-marker-soft px-4 py-3 text-left text-xs font-bold tracking-[0.1em] uppercase [&+th]:border-l-[1.5px] [&+th]:border-l-rule"
                  >
                    {typeof cell === "string" ? cell : null}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {body.map((row, index) => (
              <tr
                key={index}
                className="animate-rise [&:last-child>td]:border-b-0"
                style={{ animationDelay: `${80 + Math.min(index, 8) * 70}ms` }}
              >
                {row.map((cell, col) => (
                  <td
                    key={col}
                    className="border-b-[1.5px] border-dashed border-dash px-4 py-3 align-middle leading-snug [&+td]:border-l-[1.5px] [&+td]:border-l-rule"
                  >
                    {isBlank(cell) ? field(cell, row, col, "wide") : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ol className="m-0 flex list-none flex-col gap-3 p-0 @xl:hidden">
        {body.map((row, index) => (
          <li
            key={index}
            className="animate-rise rounded-[10px] border-[1.5px] border-ink bg-white px-4 py-3"
            style={{ animationDelay: `${80 + Math.min(index, 8) * 70}ms` }}
          >
            <dl className="m-0 flex flex-col gap-2.5">
              {row.map((cell, col) => (
                <div key={col}>
                  <dt className="text-[11px] font-bold tracking-[0.1em] text-ink-muted uppercase">{heading(col)}</dt>
                  <dd className="m-0 mt-1 text-[15px] leading-snug">
                    {isBlank(cell) ? field(cell, row, col, "narrow") : cell || "—"}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        <p aria-live="polite" className="m-0 font-hand text-[26px] leading-tight font-semibold">
          {outcome
            ? `${outcome.score} of ${outcome.total} right${outcome.score === outcome.total ? ", clean sweep!" : ""}`
            : `${filled} of ${numbers.length} filled in`}
        </p>
        {!outcome && (
          <button type="button" onClick={() => void submit()} disabled={pending} className={button("ink")}>
            {pending ? "Checking…" : "Check answers"}
          </button>
        )}
      </div>
    </div>
  );
}

function isBlank(cell: TableCell): cell is Blank {
  return typeof cell !== "string";
}

/** One blanked cell: a numbered paper tag to type into, and once checked, what it said. */
function CellField({
  id,
  number,
  label,
  value,
  onChange,
  onKeyDown,
  result,
}: {
  id: string;
  number: number;
  label: string;
  value: string;
  onChange: (text: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  result: BlankResult | undefined;
}) {
  return (
    <div className="pl-3">
      <div
        className={`relative flex h-11 min-w-[9ch] items-center rounded-[5px] border-[1.5px] border-ink bg-tag shadow-tag transition-[translate,box-shadow] duration-200 ease-spring focus-within:-translate-y-0.5 focus-within:shadow-press ${verdict(result)}`}
      >
        <label
          htmlFor={id}
          aria-hidden="true"
          className="absolute top-1/2 -left-3 grid size-6 -translate-y-1/2 cursor-text place-items-center rounded-full border-[1.5px] border-ink bg-marker text-[11px] font-bold"
        >
          {number}
        </label>
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          readOnly={result !== undefined}
          aria-label={label}
          {...ANSWER_INPUT}
          className="h-full w-full min-w-0 bg-transparent pt-0.5 pr-7 pl-[18px] font-hand text-[23px] leading-none font-semibold text-ink caret-coral outline-none"
        />
        {result?.correct && <Tick />}
      </div>
      {result && !result.correct && (
        <span className="mt-1.5 block -rotate-1 font-hand text-xl leading-tight font-bold text-coral-ink">
          → {result.expected}
        </span>
      )}
      {result?.matched === "fuzzy" && (
        <span className="mt-1 block text-xs font-bold tracking-[0.06em] text-leaf-ink">TYPO FORGIVEN</span>
      )}
    </div>
  );
}
