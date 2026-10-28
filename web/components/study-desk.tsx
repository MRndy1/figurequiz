import type { ReactNode } from "react";

import { QuestionTypeTags } from "@/components/deck-card";
import { isInProgress, STEP_STATE, StepMark, type InProgress } from "@/components/pipeline-steps";
import { RefreshWhile } from "@/components/refresh-while";
import { Card, KindTag } from "@/components/ui";
import { pageName } from "@/lib/contracts";
import type { Deck, Desk } from "@/lib/dal/documents";
import { deskLine, deskScene, deskSteps, foundTag, QUESTION_KIND, type Step, type Tag } from "@/lib/desk";
import { pageCount } from "@/lib/format";

/*
 * "The study desk": a deck being made, drawn as the work on a desk. Its pages slide in and wait,
 * a magnifier reads them while what they hold drops into a tray, each question is written onto
 * a card that joins the deck, and the finished deck fans out. Every count, page and title on it
 * comes from what has been saved so far, and the page re-renders every few seconds to show more.
 * The animations are CSS (app/globals.css), so it is all server-rendered.
 */

/** What to say instead of the usual note when a stage has gone on longer than it should. */
const STALLED: Record<InProgress, (page: string) => string> = {
  queued: () =>
    "No processor has picked it up yet. It may be offline or busy with other decks. Your file is " +
    "saved and will be read as soon as one is free, so you can leave this page.",
  processing: () =>
    "This is taking much longer than usual. If the processor stopped, the deck goes back in the " +
    "queue and starts again.",
  extracted: (page) => `The ${page}s were read, but writing questions hasn't started.`,
  generating: () => "Writing questions is taking longer than usual.",
};

/** Tags the tray shows before it says how many more there are. */
const TRAY_TAGS = 3;

type Props = {
  deck: Deck;
  desk: Desk;
  /** The current stage has gone on longer than it should take. */
  stalled?: boolean;
  /** Once ready: the way in, in place of the note about leaving the page. */
  children?: ReactNode;
};

/** A deck on its way, or one that has just become ready. */
export function StudyDesk({ deck, desk, stalled = false, children }: Props) {
  const scene = deskScene(deck.status, desk.written);
  const steps = deskSteps(deck, desk.written);
  // Said once per stage to a screen reader; the line under the steps changes too often for that.
  const stage =
    scene === "ready"
      ? "Ready to study"
      : deck.status === "queued"
        ? "Waiting to be read"
        : (steps.find((step) => step.state === "now")?.label ?? "");

  return (
    <Card
      as="section"
      aria-label={scene === "ready" ? "Your questions" : "Making your questions"}
      className="flex flex-wrap items-stretch gap-4 p-3.5 sm:gap-8 sm:p-7"
    >
      {isInProgress(deck.status) && <RefreshWhile active />}
      <div
        aria-hidden="true"
        className="graph-paper relative h-[226px] min-w-0 flex-[999_1_420px] overflow-hidden rounded-[10px] border-[1.5px] border-dashed border-dash bg-panel sm:h-[340px]"
      >
        {scene === "waiting" && (
          <>
            <Stack reading={false} label={null} />
            <p className="absolute top-24 right-3.5 m-0 max-w-[150px] -rotate-3 font-hand text-[22px] leading-[1.15] font-semibold sm:top-[120px] sm:right-[7%] sm:max-w-[200px] sm:text-[26px]">
              clearing a space on the desk
              <Dots />
            </p>
          </>
        )}
        {scene === "reading" && (
          <>
            <Stack reading label={deck.page_count === null ? null : pageCount(deck.page_count, deck.mime)} />
            <Tray tags={desk.found.map((found) => foundTag(found, deck.mime))} />
          </>
        )}
        {scene === "writing" && desk.latest && (
          <>
            {/* Keyed, so each new question slides in and is written out again. */}
            <QuestionCard key={desk.latest.id} question={desk.latest} />
            <Pile written={desk.written} />
          </>
        )}
        {scene === "ready" && <Fan count={desk.written} />}
      </div>

      <div className="flex min-w-0 flex-[1_1_280px] flex-col justify-center gap-4 sm:gap-5">
        <p className="sr-only" aria-live="polite">
          {stage}
          {stalled ? ", taking longer than usual." : "."}
        </p>
        <Steps steps={steps} />
        <p className="m-0 min-h-[2.3em] font-hand text-[22px] leading-[1.15] font-semibold [overflow-wrap:anywhere] sm:text-[27px]">
          {deskLine(deck, desk)}
          {scene !== "ready" && <Dots />}
        </p>
        {(scene === "writing" || scene === "ready") && <QuestionTypeTags types={desk.types} />}
        {children ??
          (stalled && isInProgress(deck.status) ? (
            <p className="m-0 rounded-lg border-[1.5px] border-dashed border-ink bg-marker-soft px-4 py-3 text-[15px] text-pretty">
              {STALLED[deck.status](pageName(deck.mime))}
            </p>
          ) : (
            <p className="m-0 text-sm leading-normal text-pretty text-ink-muted">
              Usually a minute or two. You can leave this page: the deck keeps going, and it waits for you
              under Decks.
            </p>
          ))}
      </div>
    </Card>
  );
}

/** Uploaded, reading, writing, ready: the current one highlighted, each with what is known of it. */
function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-2.5 p-0 text-[15px] font-semibold sm:gap-3.5 sm:text-base">
      {steps.map(({ label, detail, state }) => (
        <li key={label} className={`flex items-center gap-2.5 sm:gap-3 ${state === "next" ? "text-ink-faint" : ""}`}>
          <StepMark state={state} className="size-6 sm:size-7" />
          <span className={state === "now" ? "marker-sweep" : undefined}>{label}</span>
          <span className="sr-only">{STEP_STATE[state]}</span>
          {detail && <span className="ml-auto pl-2 text-[13px] text-ink-muted sm:text-sm">{detail}</span>}
        </li>
      ))}
    </ol>
  );
}

/** "..." that bounce, after a line that is still going on. */
function Dots() {
  return (
    <span aria-hidden="true">
      <span className="inline-block animate-desk-dot">.</span>
      <span className="inline-block animate-desk-dot [animation-delay:150ms]">.</span>
      <span className="inline-block animate-desk-dot [animation-delay:300ms]">.</span>
    </span>
  );
}

const SHEET = "absolute inset-0 rounded-[5px] border-[1.5px] border-ink bg-white sm:rounded-md";
const PAGE = "absolute inset-0 flex flex-col gap-[7px] px-[11px] py-3 sm:gap-[9px] sm:px-4 sm:py-[18px]";
const LINE = "h-[5px] shrink-0 rounded-full bg-dash sm:h-1.5";
/** A label on the little diagram the top sheet turns to. */
const CHIP = "absolute h-[7px] rounded-[2px] border-[1.2px] border-ink bg-marker sm:h-2 sm:rounded-[3px]";

/** The deck's pages in a stack: read by a magnifier, its top sheet turning, once a reader has it. */
function Stack({ reading, label }: { reading: boolean; label: string | null }) {
  return (
    <div className="absolute top-[22px] left-3 h-[160px] w-[120px] animate-desk-stack sm:top-11 sm:left-[7%] sm:h-[250px] sm:w-[196px]">
      <div className={`${SHEET} -translate-x-1.5 translate-y-1.5 -rotate-5 sm:-translate-x-2 sm:translate-y-2`} />
      <div className={`${SHEET} translate-x-1 translate-y-[3px] rotate-3 sm:translate-x-1.5 sm:translate-y-1`} />
      <div className={`${SHEET} overflow-hidden sm:shadow-[6px_6px_0_rgb(26_34_56/0.08)]`}>
        <div className={`${PAGE} ${reading ? "animate-desk-page-a" : ""}`}>
          <PageTitle />
          {[92, 80, 88, 70, 84, 52].map((width) => (
            <div key={width} className={LINE} style={{ width: `${width}%` }} />
          ))}
        </div>
        {reading && (
          <>
            <div className={`${PAGE} animate-desk-page-b opacity-0`}>
              <PageTitle />
              <div className={`${LINE} w-[92%]`} />
              <div className="relative mt-1 h-[66px] shrink-0 rounded-[5px] border-[1.5px] border-ink bg-tag sm:mt-1.5 sm:h-[92px] sm:rounded-md">
                <div className="absolute top-[22%] left-[32%] size-7 rounded-full border-[1.5px] border-ink sm:size-[38px]" />
                <div className={`${CHIP} top-[14%] left-[10%] w-[18px] sm:w-6`} />
                <div className={`${CHIP} top-[40%] right-[10%] w-5 sm:w-7`} />
                <div className={`${CHIP} bottom-[12%] left-[44%] w-[18px] sm:w-6`} />
              </div>
            </div>
            <div className="absolute inset-x-0 h-3 animate-desk-scan bg-marker/55 motion-reduce:hidden sm:h-4" />
          </>
        )}
        {label && (
          <span className="absolute right-2 bottom-1 font-hand text-[19px] font-bold sm:right-3 sm:bottom-1.5 sm:text-[22px]">
            {label}
          </span>
        )}
      </div>
      {reading && (
        // At rest (without motion) where the sweep ends.
        <div className="absolute top-[58%] left-[3%] -rotate-6 animate-desk-sweep">
          <svg viewBox="0 0 70 70" fill="none" className="size-[52px] sm:size-[70px]">
            <circle cx="28" cy="28" r="19" fill="rgb(255 225 90 / 0.35)" stroke="#1a2238" strokeWidth="2.5" />
            <path d="M42 42L62 62" stroke="#e0492a" strokeWidth="6" strokeLinecap="round" />
            <path d="M19 22a10 10 0 0 1 9-6" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  );
}

function PageTitle() {
  return <div className="h-2 w-[62%] shrink-0 rounded-full bg-ink/85 sm:h-2.5" />;
}

/** What the pages held, as tags dropped into a tray: kept in yellow, skipped struck through. */
function Tray({ tags }: { tags: Tag[] }) {
  const more = tags.length - TRAY_TAGS;
  return (
    <div className="absolute top-[18px] right-3 flex w-[142px] flex-col gap-2 sm:top-11 sm:right-[6%] sm:w-[232px] sm:gap-2.5">
      <p className="m-0 font-hand text-xl leading-none font-bold sm:text-[23px]">found so far</p>
      {tags.length === 0 && (
        <p className="m-0 rounded-[7px] border-[1.5px] border-dashed border-dash px-2.5 py-2 text-xs text-ink-faint sm:rounded-lg sm:px-3 sm:py-2.5 sm:text-sm">
          Diagrams and tables land here.
        </p>
      )}
      {tags.slice(0, TRAY_TAGS).map((tag, index) => (
        // Keyed by its words too, so a picture drops in again once its check says what it is.
        <div
          key={`${index} ${tag.text}`}
          className="-rotate-2 animate-tag-in self-start"
          style={{ animationDelay: `${index * 120}ms` }}
        >
          <span
            className={`inline-flex items-center gap-1.5 rounded-[5px] border-[1.5px] px-2 py-1 font-hand text-lg leading-[1.1] font-bold sm:gap-2 sm:px-[11px] sm:py-[5px] sm:text-[21px] ${
              tag.skipped
                ? "border-dashed border-ink-faint bg-track text-ink-muted line-through"
                : "border-ink bg-marker shadow-tag"
            }`}
          >
            <span
              className={`size-[7px] shrink-0 rounded-full border-[1.5px] bg-white sm:size-2 ${
                tag.skipped ? "border-ink-faint" : "border-ink"
              }`}
            />
            <span className="sm:hidden">{tag.short}</span>
            <span className="max-sm:hidden">{tag.text}</span>
          </span>
        </div>
      ))}
      {more > 0 && <p className="m-0 font-hand text-lg leading-none font-bold text-ink-muted sm:text-xl">and {more} more</p>}
    </div>
  );
}

/** A line of the question being written. */
const WRITTEN = "h-1.5 rounded-full bg-ink-ghost animate-desk-write sm:h-[7px]";

/** The newest question, its lines written out by a pencil. */
function QuestionCard({ question }: { question: NonNullable<Desk["latest"]> }) {
  return (
    <div className="absolute top-9 left-3.5 animate-desk-card sm:top-16 sm:left-[7%]">
      <div className="relative w-[176px] -rotate-2 rounded-[9px] border-[1.5px] border-ink bg-white px-3 pt-3 pb-4 shadow-card sm:w-[278px] sm:rounded-[10px] sm:px-[18px] sm:pt-4 sm:pb-5">
        <KindTag>{QUESTION_KIND[question.type]}</KindTag>
        <p className="mt-2 mb-2.5 line-clamp-2 font-display text-base leading-[1.15] font-bold tracking-[-0.015em] [overflow-wrap:anywhere] sm:mt-2.5 sm:mb-3.5 sm:text-[19px]">
          {question.title}
        </p>
        <div className="relative flex flex-col gap-[7px] sm:gap-[9px]">
          <div className={`${WRITTEN} w-[92%]`} />
          <div className={`${WRITTEN} w-[74%] [animation-delay:750ms] [animation-duration:600ms]`} />
          <div className={`${WRITTEN} w-[46%] [animation-delay:1400ms] [animation-duration:450ms]`} />
          {/* The tip travels between the lines' centres. */}
          <div className="absolute inset-x-0 top-[3px] bottom-[3px]">
            <div className="absolute animate-desk-pencil">
              <div className="-translate-x-[18%] -translate-y-[82%]">
                <svg viewBox="0 0 54 54" fill="none" className="size-10 animate-desk-bob sm:size-[54px]">
                  <path d="M10 44l4-12 24-24 8 8-24 24z" fill="#ffe15a" stroke="#1a2238" strokeWidth="2" strokeLinejoin="round" />
                  <path d="M10 44l4-12 8 8z" fill="#fffdf2" stroke="#1a2238" strokeWidth="2" strokeLinejoin="round" />
                  <path d="M10 44l2-6 4 4z" fill="#1a2238" />
                  <path d="M34 12l8 8" stroke="#e0492a" strokeWidth="2" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The deck so far: a pile of cards with its count on a yellow badge that pops as it grows. */
function Pile({ written }: { written: number }) {
  const card = "absolute h-[104px] w-[78px] rounded-[7px] border-[1.5px] border-ink bg-white sm:h-[150px] sm:w-[120px] sm:rounded-lg";
  return (
    <div className="absolute top-14 right-4 h-[120px] w-[86px] sm:top-[76px] sm:right-[9%] sm:h-[172px] sm:w-[132px]">
      <div className={`${card} top-2 left-2 sm:top-3 sm:left-3`} />
      <div className={`${card} top-1 left-1 sm:top-1.5 sm:left-1.5`} />
      <div className={`${card} top-0 left-0 flex flex-col gap-1.5 p-2.5 sm:gap-2 sm:p-3.5`}>
        <div className={`${LINE} w-[70%]`} />
        <div className={`${LINE} w-[90%]`} />
        <div className={`${LINE} w-1/2`} />
      </div>
      <span
        key={written}
        className="absolute -top-3.5 -right-3 grid size-[38px] animate-desk-pop place-items-center rounded-full border-[1.5px] border-ink bg-marker font-display text-[17px] font-extrabold shadow-tag sm:-top-4 sm:-right-4 sm:size-11 sm:text-[19px]"
      >
        {written}
      </span>
      <p className="absolute top-[116px] -right-2.5 -left-2.5 m-0 text-center font-hand text-[19px] leading-none font-bold sm:top-[168px] sm:right-0 sm:left-0 sm:text-[22px]">
        your deck
      </p>
    </div>
  );
}

/** The finished deck, fanned out with its count, and a few strokes of excitement around it. */
function Fan({ count }: { count: number }) {
  const card =
    "absolute -top-[76px] -left-[50px] h-[130px] w-[100px] origin-[50%_120%] rounded-lg border-[1.5px] border-ink sm:-top-24 sm:-left-16 sm:h-[166px] sm:w-32 sm:rounded-[9px]";
  return (
    <div className="absolute top-[56%] left-1/2 size-0 sm:top-[52%]">
      <div className={`${card} animate-desk-fan-l bg-white`} />
      <div className={`${card} animate-desk-fan-r bg-white`} />
      <div
        className={`${card} flex animate-desk-fan-m flex-col items-center gap-1 bg-tag pt-[22px] shadow-[5px_5px_0_rgb(26_34_56/0.1)] sm:pt-4`}
      >
        <span className="font-display text-[38px] leading-none font-extrabold sm:text-[46px]">{count}</span>
        <span className="font-hand text-[19px] font-bold sm:text-[22px]">{count === 1 ? "question" : "questions"}</span>
      </div>
      <svg
        viewBox="0 0 260 200"
        fill="none"
        className="absolute -top-[94px] -left-[110px] w-[220px] sm:-top-[122px] sm:-left-[130px] sm:w-[260px]"
      >
        <g stroke="#1a2238" strokeWidth="2.4" strokeLinecap="round" className="origin-[130px_100px] animate-desk-ray">
          <path d="M22 60l-16-8M18 100H2M24 140l-16 8M238 60l16-8M242 100h16M236 140l16 8" />
        </g>
      </svg>
    </div>
  );
}
