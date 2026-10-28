import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { BackLink, button, Card, HandNote } from "@/components/ui";
import { aud, findOffer, lectures, PLANS, TOP_UPS } from "@/lib/pricing";

export const metadata: Metadata = { title: "Checkout" };

/** Every plan and top-up has its page, built ahead; any other address is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return [...PLANS, ...TOP_UPS].map((offer) => ({ offer: offer.id }));
}

/**
 * The order, as checkout will show it. Payments aren't live in this proof of concept, so there
 * is nothing to fill in: no card details are asked for, nothing is charged, and no credits are
 * added (docs/credits-plan.md, phase 5).
 */
export default async function CheckoutPage({ params }: PageProps<"/pricing/checkout/[offer]">) {
  const { offer: id } = await params;
  const offer = findOffer(id);
  if (!offer) notFound();
  const plan = offer.kind === "plan";

  return (
    <div className="w-full overflow-x-hidden">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-7 px-6 pt-4 pb-28">
        <BackLink href="/pricing">Pricing</BackLink>
        <div className="animate-rise">
          <HandNote>checkout</HandNote>
          <h1 className="mt-1 mb-0 font-display text-[clamp(32px,4vw,46px)] leading-[1.02] font-extrabold tracking-[-0.035em]">
            Your order
          </h1>
        </div>

        <Card as="section" aria-label="Order summary" className="animate-rise px-6 [animation-delay:80ms]">
          <dl className="m-0">
            <Row term={plan ? "Plan" : "Top-up"} detail={offer.name} />
            <Row
              term="Credits"
              detail={`${offer.credits.toLocaleString("en-AU")}${plan ? " every month" : ", kept until used"}`}
            />
            <Row term="Covers" detail={`about ${lectures(offer.credits)} lectures`} />
            <Row term="Total" detail={`${aud(offer.price)}${plan ? " a month" : ""}`} strong />
          </dl>
        </Card>

        <div role="note" className="rounded-xl border-[1.5px] border-dashed border-ink bg-marker-soft p-5 text-pretty">
          <p className="m-0 font-semibold">Payments aren&apos;t live in this proof of concept.</p>
          <p className="mt-1 mb-0 text-[15px]">
            Nothing is charged and no credits are added. Credits for a demo account are added by hand.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled className={button("ink", "lg")}>
            Pay {aud(offer.price)}: not live yet
          </button>
          <Link href="/pricing" className={button("line", "lg")}>
            Back to pricing
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function Row({ term, detail, strong = false }: { term: string; detail: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-dashed border-dash py-4 last:border-b-0">
      <dt className="text-ink-muted">{term}</dt>
      <dd className={`m-0 text-right ${strong ? "font-display text-2xl font-extrabold" : "font-semibold"}`}>{detail}</dd>
    </div>
  );
}
