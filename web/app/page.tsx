import Link from "next/link";
import type { ReactNode } from "react";

import { gradeDiagramAnswers } from "@/app/demo/actions";
import { GuestDropZone } from "@/components/guest-drop-zone";
import { SampleQuestion } from "@/components/sample-question";
import { SiteFooter, SiteHeader, START_HREF } from "@/components/site-chrome";
import { button, Card, HandNote, Included, Tape } from "@/components/ui";
import { MARKING_CREDITS } from "@/lib/essays";
import { aud, FREE_CREDITS, GUEST_CREDITS, PLANS, TOP_UPS } from "@/lib/pricing";
import { questions, toPublic } from "@/lib/questions";

/**
 * The front door. The hero runs the demo deck's diagram question for real — typed onto the
 * diagram and graded by the demo's server action, with nothing saved — so the first thing a
 * visitor does is the thing FigureQuiz is for.
 */
export default function Home() {
  const sample = questions.find((question) => question.type === "diagram");
  const sampleQuestion = sample ? toPublic(sample) : null;
  // Inlined at build: without a Turnstile site key, guest decks are off and the page asks
  // visitors to sign up instead (START_HREF).
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  return (
    <div className="w-full overflow-x-hidden">
      <SiteHeader />

      <main>
        <section className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-14 px-6 pt-8 pb-28">
          <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-6">
            <HandNote className="animate-rise">quizzes, straight from your slides</HandNote>
            <h1 className="m-0 animate-rise font-display text-[clamp(42px,5vw,66px)] leading-none font-extrabold tracking-[-0.035em] text-balance [animation-delay:80ms]">
              Your lecture slides, turned into the <mark className="marker-sweep bg-transparent text-inherit">exam.</mark>
            </h1>
            <p className="m-0 max-w-[34em] animate-rise text-lg leading-relaxed text-pretty text-ink-muted [animation-delay:160ms]">
              Upload a deck or a PDF. FigureQuiz blanks the labels on every diagram and quizzes you
              on them. Its answer key forgives a typo, but never “afferent” for “efferent”.
            </p>
            <div className="flex animate-rise flex-wrap items-center gap-5 [animation-delay:240ms]">
              <Link href={START_HREF} className={button("ink")}>
                Make a quiz from your slides
              </Link>
              <a href="#try" className="link-marker inline-flex min-h-11 items-center font-semibold">
                Try the sample question
              </a>
            </div>
            <p className="m-0 flex animate-rise items-center gap-2.5 text-sm text-ink-muted [animation-delay:300ms]">
              <PaperclipIcon />
              Every question links back to its slide.
            </p>
            <div aria-hidden="true" className="hidden items-end gap-2 lg:flex">
              <p className="m-0 font-hand text-2xl font-semibold">go on, try a label</p>
              <svg width="120" height="56" viewBox="0 0 120 56" fill="none" className="text-coral">
                <path
                  d="M4 46c22 6 52 2 74-14 10-7 18-16 24-26M90 8l13-2-2 13"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="animate-[draw_1.1s_1.1s_ease-out_forwards] [stroke-dasharray:220] [stroke-dashoffset:220]"
                />
              </svg>
            </div>
          </div>

          {sampleQuestion?.type === "diagram" && (
            <Card
              as="section"
              id="try"
              aria-labelledby="sample-title"
              className="relative min-w-0 flex-[1.6_1_620px] scroll-mt-6 p-[clamp(16px,2.5vw,24px)] shadow-[10px_10px_0_rgb(26_34_56/0.1)]"
            >
              <Tape />
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <p className="m-0 text-[11px] font-bold tracking-[0.12em] text-ink-muted uppercase">
                    Diagram · {sampleQuestion.sourceRef}
                  </p>
                  <h2 id="sample-title" className="m-0 font-display text-[26px] font-bold tracking-[-0.02em]">
                    {sampleQuestion.title}
                  </h2>
                </div>
                <Link href="/demo/study" className="font-hand text-2xl font-semibold text-ink-muted hover:text-ink">
                  the whole sample deck →
                </Link>
              </div>
              <SampleQuestion question={sampleQuestion} grade={gradeDiagramAnswers} />
            </Card>
          )}
        </section>

        {turnstileSiteKey && (
          <section
            id="start"
            aria-labelledby="start-title"
            className="mx-auto flex w-full max-w-6xl scroll-mt-6 flex-col gap-6 px-6 pb-28"
          >
            <div className="flex flex-col gap-2">
              <HandNote>no account needed</HandNote>
              <h2
                id="start-title"
                className="m-0 font-display text-[clamp(30px,3.6vw,44px)] leading-[1.05] font-extrabold tracking-[-0.03em] text-balance"
              >
                Make a quiz from <span className="marker">your own slides.</span>
              </h2>
              <p className="m-0 max-w-[46em] text-[17px] leading-relaxed text-pretty text-ink-muted">
                Drop in a lecture deck or PDF and try its first questions straight away. You get 25
                free credits to try it, one per page that gets questions, and 75 more when you sign up.
              </p>
            </div>
            <GuestDropZone siteKey={turnstileSiteKey} />
          </section>
        )}

        <section id="how" aria-labelledby="how-title" className="mx-auto flex w-full max-w-6xl scroll-mt-6 flex-col gap-10 px-6 pb-28">
          <SectionHead note="how it works" id="how-title">
            From lecture deck to practice exam in <span className="marker">three steps.</span>
          </SectionHead>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-6">
            <Step number={1} title="Upload your deck" art={<UploadArt />}>
              Drop in the PowerPoint or PDF your lecturer posted, up to 50 MB.
            </Step>
            <Step number={2} title="We find every diagram" art={<FindArt />}>
              Labels are read straight from the slide. When they are baked into the picture, text
              recognition finds them instead.
            </Step>
            <Step number={3} title="Type onto the labels" art={<TagArt />}>
              Each label becomes a blank you fill in place, checked the moment you ask.
            </Step>
          </div>
        </section>

        <section aria-labelledby="key-title" className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-14 px-6 pb-28">
          <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-4">
            <SectionHead note="the answer key" id="key-title">
              Forgives typos. Catches <span className="marker">look-alikes.</span>
            </SectionHead>
            <p className="m-0 text-[17px] leading-relaxed text-pretty text-ink-muted">
              A slip of the finger shouldn’t cost you a mark. Writing “efferent” when the answer is
              “afferent” is the wrong nerve. FigureQuiz keeps a list of look-alikes for every answer
              and checks them before it forgives a typo.
            </p>
          </div>
          <Card className="flex min-w-0 flex-[1.2_1_440px] flex-col p-7">
            <Verdict label="Label 2 · Hippocampus" answer="hipocampus" right note="a typo, so it counts" tilt="-rotate-[1.5deg]" />
            <Verdict label="Blank · afferent neurons" answer="efferent neurons" note="a look-alike, so it doesn’t" tilt="rotate-[1.2deg]" />
            <Verdict label="Label 4 · Corpus callosum" answer="the corpus callosum" right note="“the” is ignored" tilt="-rotate-[0.8deg]" />
          </Card>
        </section>

        <section aria-labelledby="source-title" className="mx-auto flex w-full max-w-6xl flex-wrap-reverse items-center gap-14 px-6 pb-28">
          <Card className="min-w-0 flex-[1.2_1_440px] p-5">
            <div className="relative overflow-hidden rounded-lg border-[1.5px] border-ink">
              {/* eslint-disable-next-line @next/next/no-img-element -- the public blanked render */}
              <img src="/demo/brain-lobes.png" alt="" className="block h-auto w-full scale-105 blur-[10px] saturate-50" />
              <div className="absolute inset-0 grid place-items-center bg-paper/40">
                <p className="m-0 flex items-center gap-2 rounded-full border-[1.5px] border-ink bg-white px-4 py-2 font-hand text-2xl font-bold shadow-tag">
                  <LockIcon />
                  opens once you’ve answered
                </p>
              </div>
            </div>
            <p className="mt-4 mb-0 text-sm font-semibold">From slide 3 of Brain_Anatomy_Sample.pptx</p>
          </Card>
          <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-4">
            <SectionHead note="the receipts" id="source-title">
              Every question shows <span className="marker">where it came from.</span>
            </SectionHead>
            <p className="m-0 text-[17px] leading-relaxed text-pretty text-ink-muted">
              Once you have answered, open the full slide the question was written from, so you can
              check the answer key against your lecturer’s own words.
            </p>
          </div>
        </section>

        <section aria-labelledby="ways-title" className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-6 pb-28 text-center">
          <h2 id="ways-title" className="m-0 font-display text-[clamp(28px,3vw,38px)] leading-tight font-extrabold tracking-[-0.03em]">
            Ways to practise
          </h2>
          <ul className="m-0 flex list-none flex-wrap justify-center gap-3.5 p-0">
            {[
              ["diagram labels", "-rotate-2"],
              ["multiple choice", "rotate-[1.5deg]"],
              ["fill in the blank", "-rotate-1"],
              ["flashcards", "rotate-2"],
            ].map(([label, tilt]) => (
              <li
                key={label}
                className={`inline-flex h-10 items-center rounded-[5px] border-[1.5px] border-ink bg-tag px-4 font-hand text-[23px] font-semibold shadow-tag transition-transform duration-200 ease-spring hover:-translate-y-0.5 hover:rotate-0 ${tilt}`}
              >
                {label}
              </li>
            ))}
          </ul>
        </section>

        <section id="pricing" aria-labelledby="pricing-title" className="mx-auto flex w-full max-w-6xl scroll-mt-6 flex-col gap-10 px-6 pb-28">
          <SectionHead note="pricing" id="pricing-title">
            Start free. <span className="marker">Pay for the pages you study.</span>
          </SectionHead>
          <Card className="relative flex max-w-xl flex-col gap-6 p-8 shadow-[10px_10px_0_var(--color-marker)]">
            <Tape />
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="m-0 font-display text-[26px] font-extrabold">Free</h3>
              <p className="m-0 font-display text-[44px] leading-none font-extrabold tracking-[-0.03em]">
                {FREE_CREDITS} credits
              </p>
            </div>
            <ul className="m-0 flex list-none flex-col gap-3 p-0 text-base">
              <Included>
                {GUEST_CREDITS} to try it without an account, and {FREE_CREDITS - GUEST_CREDITS} more when you sign up
              </Included>
              <Included>One credit per page that gets questions; title slides and the like are free</Included>
              <Included>Every question type, diagrams and tables included</Included>
              <Included>Written answers marked against a rubric, {MARKING_CREDITS} credits each</Included>
            </ul>
            <p className="m-0 text-[15px] text-ink-muted">
              Then plans from {aud(Math.min(...PLANS.map((plan) => plan.price)))} a month, or top-ups from{" "}
              {aud(Math.min(...TOP_UPS.map((top) => top.price)))}.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href={START_HREF} className={button("ink")}>
                Make a quiz from your slides
              </Link>
              <Link href="/pricing" className={button("line")}>
                See plans and top-ups
              </Link>
            </div>
          </Card>
        </section>

        <section aria-labelledby="cta-title" className="mx-auto w-full max-w-6xl px-6 pb-24">
          <Card className="flex flex-wrap items-center justify-between gap-8 p-[clamp(28px,5vw,64px)] shadow-[12px_12px_0_rgb(26_34_56/0.1)]">
            <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-3">
              <h2 id="cta-title" className="m-0 font-display text-[clamp(30px,3.4vw,44px)] leading-tight font-extrabold tracking-[-0.03em] text-balance">
                Bring this week’s lecture. <span className="marker">Leave with a quiz.</span>
              </h2>
              <p className="m-0 text-[17px] text-ink-muted">Questions are ready about a minute after you upload.</p>
            </div>
            <Link href={START_HREF} className={button("ink", "lg")}>
              Make a quiz from your slides
            </Link>
          </Card>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function SectionHead({ note, id, children }: { note: string; id: string; children: ReactNode }) {
  return (
    <div className="flex max-w-3xl flex-col gap-2">
      <HandNote>{note}</HandNote>
      <h2
        id={id}
        className="m-0 font-display text-[clamp(32px,3.6vw,46px)] leading-[1.05] font-extrabold tracking-[-0.03em] text-balance"
      >
        {children}
      </h2>
    </div>
  );
}

function Step({
  number,
  title,
  art,
  children,
}: {
  number: number;
  title: string;
  art: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card
      as="article"
      className="flex flex-col gap-4 p-7 transition-[translate,rotate,box-shadow] duration-300 ease-spring hover:-translate-x-0.5 hover:-translate-y-1 hover:shadow-lift"
    >
      <div className="flex items-center justify-between">
        <span
          aria-hidden="true"
          className="grid size-12 -rotate-6 place-items-center rounded-full border-[1.5px] border-ink bg-marker font-hand text-3xl leading-none font-bold"
        >
          {number}
        </span>
        {art}
      </div>
      <h3 className="m-0 font-display text-[23px] font-bold tracking-[-0.02em]">{title}</h3>
      <p className="m-0 text-base leading-relaxed text-ink-muted">{children}</p>
    </Card>
  );
}

function Verdict({
  label,
  answer,
  right = false,
  note,
  tilt,
}: {
  label: string;
  answer: string;
  right?: boolean;
  note: string;
  tilt: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b-[1.5px] border-dashed border-dash py-5 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-bold tracking-[0.1em] text-ink-muted uppercase">{label}</span>
        <span
          className={`inline-flex h-9 w-fit items-center rounded-[5px] border-[1.5px] border-ink bg-tag px-3.5 font-hand text-[22px] font-semibold shadow-tag ${tilt} ${right ? "answer-right" : "answer-wrong"}`}
        >
          <span className="answer-text">{answer}</span>
        </span>
      </div>
      <p className={`m-0 font-hand text-[23px] font-semibold ${right ? "text-leaf" : "text-coral-strong"}`}>{note}</p>
    </div>
  );
}

const ART = {
  width: 72,
  height: 56,
  viewBox: "0 0 72 56",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function UploadArt() {
  return (
    <svg {...ART}>
      <path d="M14 6h28l12 12v32H14z" />
      <path d="M42 6v12h12" />
      <path d="M34 42V26m-7 7 7-7 7 7" />
      <path d="M60 14h8M64 10v8" className="text-coral" stroke="currentColor" />
    </svg>
  );
}

function FindArt() {
  return (
    <svg {...ART}>
      <path d="M10 34c0-12 9-22 21-22 9 0 16 5 18 13" />
      <path d="M10 34c2 7 9 11 17 11" />
      <circle cx="46" cy="36" r="10" />
      <path d="m53 43 9 9" />
      <path d="M24 22h-9M20 30h-8" className="text-coral" stroke="currentColor" />
    </svg>
  );
}

function TagArt() {
  return (
    <svg {...ART}>
      <path d="M8 22h34l8 8-8 8H8z" />
      <circle cx="16" cy="30" r="2.5" />
      <path d="m48 46 14-30 5 3-14 30-6 3z" />
      <path d="M26 30h10" className="text-coral" stroke="currentColor" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5 12.6 19.9a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
