import Link from "next/link";

import { button, Wordmark } from "@/components/ui";

/**
 * Where "Make a deck" goes. Inlined at build: with a Turnstile site key, guests make a deck on
 * the landing page; without one, guest decks are off and visitors sign up first.
 */
export const START_HREF = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? "/#start" : "/signup";

/** The public pages' header: the landing page, pricing and checkout. */
export function SiteHeader() {
  return (
    <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-5 px-6 py-7">
      <Wordmark />
      <nav aria-label="Main" className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[15px]">
        <Link href="/#how" className={`hidden sm:inline ${NAV_LINK}`}>
          How it works
        </Link>
        <Link href="/pricing" className={`hidden sm:inline ${NAV_LINK}`}>
          Pricing
        </Link>
        <Link href="/login" className={NAV_LINK}>
          Sign in
        </Link>
        <Link href={START_HREF} className={button("ink", "sm")}>
          Make a deck
        </Link>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-5 border-t-[1.5px] border-dashed border-dash px-6 pt-7 pb-10">
      <p className="m-0 font-display text-lg font-extrabold">FigureQuiz</p>
      <nav aria-label="Footer" className="flex flex-wrap gap-6 text-sm">
        <Link href="/demo" className={FOOT_LINK}>
          Sample deck
        </Link>
        <Link href="/pricing" className={FOOT_LINK}>
          Pricing
        </Link>
        <Link href="/login" className={FOOT_LINK}>
          Sign in
        </Link>
      </nav>
      <p className="m-0 text-sm text-ink-muted">© 2026 FigureQuiz</p>
    </footer>
  );
}

const NAV_LINK =
  "font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 " +
  "focus-visible:outline-offset-3 focus-visible:outline-ink rounded-sm";

const FOOT_LINK = "text-ink-muted hover:text-ink rounded-sm focus-visible:outline-2 focus-visible:outline-ink";
