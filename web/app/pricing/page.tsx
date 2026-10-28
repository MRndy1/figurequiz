import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { SiteFooter, SiteHeader, START_HREF } from "@/components/site-chrome";
import { button, Card, HandNote, Included, Tape } from "@/components/ui";
import { MARKING_CREDITS } from "@/lib/essays";
import {
  aud,
  FREE_CREDITS,
  GUEST_CREDITS,
  lectures,
  PAGES_PER_LECTURE,
  PLANS,
  TOP_UPS,
  type Offer,
} from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Start with 100 free credits. One credit writes questions from one page of your slides.",
};

/**
 * Plans and top-ups, priced in credits (docs/credits-plan.md, phase 5). Payments aren't live: the
 * page says so up front, and checkout shows the order without taking a payment.
 */
export default function PricingPage() {
  return (
    <div className="w-full overflow-x-hidden">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-20 px-6 pt-6 pb-28">
        <section aria-labelledby="pricing-title" className="flex animate-rise flex-col gap-4">
          <HandNote>pricing</HandNote>
          <h1
            id="pricing-title"
            className="m-0 max-w-4xl font-display text-[clamp(38px,5vw,64px)] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance"
          >
            Pay for the pages <span className="marker">you study.</span>
          </h1>
          <p className="m-0 max-w-[62ch] text-[17px] leading-relaxed text-pretty text-ink-muted">
            One credit writes questions from one page of your slides, and pages that end up with none,
            like a title slide, are free. Marking a written answer takes {MARKING_CREDITS} credits.
            Checking every other answer is always free.
          </p>
          <PreviewNotice />
        </section>

        <section aria-labelledby="plans-title" className="flex flex-col gap-8">
          <h2 id="plans-title" className="sr-only">
            Plans
          </h2>
          <div className="grid gap-8 md:grid-cols-3">
            <Card className="flex flex-col gap-5 p-7">
              <PlanHead name="Free" price={aud(0)} per="to start" />
              <p className="m-0 font-semibold">
                {FREE_CREDITS} credits, once: about {lectures(FREE_CREDITS)} lectures
              </p>
              <ul className="m-0 flex list-none flex-col gap-3 p-0 text-[15px]">
                <Included>
                  {GUEST_CREDITS} to try it without an account, {FREE_CREDITS - GUEST_CREDITS} more when you sign up
                </Included>
                <Included>Every question type, diagrams and tables included</Included>
                <Included>Every question linked to its slide</Included>
              </ul>
              <Link href={START_HREF} className={`mt-auto ${button("line")}`}>
                Start free
              </Link>
            </Card>
            {PLANS.map((plan, index) => (
              <OfferCard key={plan.id} offer={plan} featured={index === 0} />
            ))}
          </div>
        </section>

        <section aria-labelledby="top-ups-title" className="flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <HandNote>ran out?</HandNote>
            <h2
              id="top-ups-title"
              className="m-0 font-display text-[clamp(30px,3.6vw,44px)] leading-[1.05] font-extrabold tracking-[-0.03em]"
            >
              Top up any time.
            </h2>
            <p className="m-0 max-w-[60ch] text-[17px] text-pretty text-ink-muted">
              On any plan, free included. Top-up credits stay until you use them.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            {TOP_UPS.map((top) => (
              <Card key={top.id} className="flex flex-col gap-3 p-6">
                <p className="m-0 font-display text-[28px] leading-none font-extrabold tracking-[-0.02em]">
                  {top.name}
                </p>
                <p className="m-0 text-ink-muted">
                  {top.blurb} About {lectures(top.credits)} lectures.
                </p>
                <p className="m-0 mt-auto font-display text-2xl font-extrabold">{aud(top.price)}</p>
                <Link href={`/pricing/checkout/${top.id}`} className={button("line")}>
                  Buy {top.name}
                </Link>
              </Card>
            ))}
          </div>
        </section>

        <section aria-labelledby="buys-title" className="flex max-w-3xl flex-col gap-6">
          <h2
            id="buys-title"
            className="m-0 font-display text-[clamp(28px,3.2vw,38px)] leading-tight font-extrabold tracking-[-0.03em]"
          >
            What a credit buys
          </h2>
          <dl className="m-0 rounded-xl border-[1.5px] border-ink bg-white px-5 shadow-card">
            <Cost what={`A ${PAGES_PER_LECTURE}-page lecture`} cost={`about ${PAGES_PER_LECTURE} credits`} />
            <Cost what="Title, agenda and other pages that get no questions" cost="free" />
            <Cost what="Marking a written answer" cost={`${MARKING_CREDITS} credits`} />
            <Cost what="Studying, checking answers and flashcards" cost="free" />
          </dl>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function PreviewNotice() {
  return (
    <p className="m-0 max-w-[62ch] rounded-lg border-[1.5px] border-dashed border-ink bg-marker-soft px-4 py-3 text-[15px] text-pretty">
      <strong>Payments aren&apos;t live yet.</strong> This is how FigureQuiz will be priced. Checkout
      shows your order, but takes no payment and adds no credits.
    </p>
  );
}

function PlanHead({ name, price, per }: { name: string; price: string; per: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="m-0 font-display text-[24px] font-extrabold">{name}</h3>
      <p className="m-0 flex items-baseline gap-2">
        <span className="font-display text-[44px] leading-none font-extrabold tracking-[-0.03em]">{price}</span>
        <span className="text-ink-muted">{per}</span>
      </p>
    </div>
  );
}

function OfferCard({ offer, featured }: { offer: Offer; featured: boolean }) {
  return (
    <Card
      className={`relative flex flex-col gap-5 p-7 ${featured ? "shadow-[10px_10px_0_var(--color-marker)]" : ""}`}
    >
      {featured && <Tape />}
      <PlanHead name={offer.name} price={aud(offer.price)} per="a month" />
      <p className="m-0 font-semibold">
        {offer.credits.toLocaleString("en-AU")} credits a month: about {lectures(offer.credits)} lectures
      </p>
      <p className="m-0 text-[15px] text-ink-muted">{offer.blurb}</p>
      <ul className="m-0 flex list-none flex-col gap-3 p-0 text-[15px]">
        <Included>Everything in Free</Included>
        <Included>Fresh credits every month</Included>
        <Included>Top up whenever you need more</Included>
      </ul>
      <Link href={`/pricing/checkout/${offer.id}`} className={`mt-auto ${button(featured ? "ink" : "line")}`}>
        Choose {offer.name}
      </Link>
    </Card>
  );
}

function Cost({ what, cost }: { what: string; cost: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-dashed border-dash py-3.5 last:border-b-0">
      <dt className="text-pretty">{what}</dt>
      <dd className="m-0 shrink-0 font-display font-extrabold">{cost}</dd>
    </div>
  );
}
