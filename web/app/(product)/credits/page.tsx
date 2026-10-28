import type { Metadata } from "next";

import Link from "next/link";

import { button, Card, HandNote } from "@/components/ui";
import { getBalance, getCreditHistory, type CreditLine } from "@/lib/dal/credits";
import { MARKING_CREDITS } from "@/lib/essays";
import { FREE_CREDITS } from "@/lib/pricing";

export const metadata: Metadata = { title: "Credits" };

/** Dates as a student in the product's home market reads them: "26 Oct". */
const DAY = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Sydney" });

/** The balance, how credits work, and where they went. */
export default async function CreditsPage() {
  const [balance, lines] = await Promise.all([getBalance(), getCreditHistory()]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-4 py-10 sm:px-6">
      <div className="animate-rise">
        <HandNote>{balance > 0 ? "your credits" : "out of credits"}</HandNote>
        <h1 className="mt-1 mb-0 font-display text-[clamp(32px,4vw,46px)] leading-[1.02] font-extrabold tracking-[-0.035em]">
          {balance} {balance === 1 ? "credit" : "credits"}
        </h1>
        <p className="mt-2 mb-0 max-w-[60ch] text-pretty text-ink-muted">
          One credit writes questions from one page of a deck. Pages that end up with none, like a
          title slide, are free.
        </p>
        <Link href="/pricing" className={`mt-5 ${button(balance > 0 ? "line" : "ink")}`}>
          Top up or see plans
        </Link>
      </div>

      <Card as="section" aria-labelledby="how-title" className="animate-rise p-6 [animation-delay:80ms] sm:p-7">
        <h2 id="how-title" className="m-0 font-display text-[22px] font-extrabold tracking-[-0.02em]">
          How credits work
        </h2>
        <ul className="mt-3 mb-0 flex flex-col gap-2 pl-5 text-[15px] leading-relaxed text-pretty marker:text-ink-faint">
          <li>
            Everyone gets {FREE_CREDITS} free credits once: some to try FigureQuiz, the rest when you
            sign up. They don&apos;t refill.
          </li>
          <li>
            While a deck&apos;s questions are written, it holds a credit for each page that could get
            some, then gives back the ones it didn&apos;t use.
          </li>
          <li>
            If your credits run out partway, the deck gets questions from the pages they covered,
            and <strong>Finish this deck</strong> writes the rest later.
          </li>
          <li>
            Marking a written answer takes {MARKING_CREDITS}. If it can&apos;t be marked, they come
            back.
          </li>
        </ul>
      </Card>

      <section aria-labelledby="history-title" className="flex flex-col gap-3">
        <h2 id="history-title" className="m-0 font-display text-[22px] font-extrabold tracking-[-0.02em]">
          History
        </h2>
        {lines.length === 0 ? (
          <p className="m-0 text-ink-muted">Nothing yet.</p>
        ) : (
          <ol className="m-0 list-none rounded-xl border-[1.5px] border-ink bg-white p-0 px-4 shadow-card">
            {lines.map((line) => (
              <HistoryLine key={line.id} line={line} />
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function HistoryLine({ line }: { line: CreditLine }) {
  const sign = line.delta > 0 ? "+" : line.delta < 0 ? "−" : "";
  return (
    <li className="flex items-center gap-4 border-b-[1.5px] border-dashed border-dash py-3 last:border-b-0">
      <time dateTime={line.at} className="w-14 shrink-0 text-sm text-ink-muted">
        {DAY.format(new Date(line.at))}
      </time>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold">{line.label}</span>
        {line.detail && <span className="text-sm text-ink-muted">{line.detail}</span>}
      </span>
      {line.pending && (
        <span className="shrink-0 rounded-[5px] bg-marker-soft px-2 py-0.5 text-xs font-bold tracking-[0.06em]">
          IN PROGRESS
        </span>
      )}
      <span
        className={`w-14 shrink-0 text-right font-display text-lg font-extrabold ${line.delta > 0 ? "text-leaf-ink" : ""}`}
      >
        {sign}
        {Math.abs(line.delta)}
      </span>
    </li>
  );
}
