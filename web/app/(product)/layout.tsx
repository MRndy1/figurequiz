import Link from "next/link";
import type { ReactNode } from "react";

import { signOut } from "@/app/(auth)/actions";
import { AppNav } from "@/components/app-nav";
import { button, Wordmark } from "@/components/ui";
import { requireUser } from "@/lib/dal/auth";
import { getBalance } from "@/lib/dal/credits";

/**
 * The signed-in shell. Its `requireUser()` sends visitors to /login, but a layout doesn't
 * re-render on every navigation, so each page also reads its data through a function that
 * checks the user (lib/dal). Pages bring their own <main>.
 */
export default async function ProductLayout({ children }: { children: ReactNode }) {
  const [user, balance] = await Promise.all([requireUser(), getBalance()]);

  return (
    <>
      <header className="border-b-[1.5px] border-ink bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-2 px-4 py-3 sm:gap-x-8 sm:px-6">
          <Wordmark href="/dashboard" size="sm" />
          <AppNav />
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/credits"
              className="hidden h-10 items-center gap-1.5 rounded-full border-[1.5px] border-ink bg-tag px-3.5 text-sm font-bold text-ink shadow-tag transition-colors hover:bg-marker-soft focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ink sm:inline-flex"
            >
              <CreditIcon />
              {balance}
              <span className="font-semibold text-ink-muted">{balance === 1 ? "credit" : "credits"}</span>
            </Link>
            {user.isGuest && (
              <Link href="/signup" className={`hidden sm:inline-flex ${button("ink", "sm")}`}>
                Sign up
              </Link>
            )}
            <AccountMenu email={user.email} balance={balance} guest={user.isGuest} />
          </div>
        </div>
      </header>
      {children}
    </>
  );
}

/**
 * The person icon and what it opens: who is signed in, and signing out. A native popover, so
 * Escape and a click elsewhere close it with no script. It sits in the top layer, placed under
 * the header's right edge: below `sm` that edge is the page's 1rem gutter, and above it the
 * 72rem column's 1.5rem one.
 */
function AccountMenu({ email, balance, guest }: { email: string | null; balance: number; guest: boolean }) {
  return (
    <div>
      <button
        type="button"
        popoverTarget="account-menu"
        aria-label="Account"
        className="grid size-11 place-items-center rounded-full border-[1.5px] border-ink bg-white text-ink transition-colors hover:bg-marker-soft focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ink"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
        </svg>
      </button>
      <div
        id="account-menu"
        popover="auto"
        className="absolute inset-auto top-[78px] right-4 m-0 w-72 max-w-[calc(100%-2rem)] rounded-xl border-[1.5px] border-ink bg-white p-4 text-ink shadow-card sm:right-[max(1.5rem,calc((100%-72rem)/2+1.5rem))]"
      >
        {guest ? (
          <>
            <p className="m-0 text-xs font-bold tracking-[0.08em] text-ink-muted uppercase">Trying as a guest</p>
            <p className="mt-1 mb-0 text-sm text-pretty">Sign up to keep your deck and get 75 more credits.</p>
            <Link href="/signup" className={`mt-3 w-full ${button("ink", "sm")}`}>
              Sign up free
            </Link>
          </>
        ) : (
          <>
            <p className="m-0 text-xs font-bold tracking-[0.08em] text-ink-muted uppercase">Signed in as</p>
            <p className="mt-1 mb-0 truncate font-semibold">{email ?? "your account"}</p>
          </>
        )}
        <Link
          href="/credits"
          className="mt-3 flex items-center justify-between gap-3 rounded-lg border-[1.5px] border-dashed border-dash bg-panel px-3 py-2 text-sm font-semibold text-ink hover:bg-marker-wash"
        >
          <span className="flex items-center gap-1.5">
            <CreditIcon />
            Credits
          </span>
          <span className="font-bold">{balance}</span>
        </Link>
        {/* A guest has no way back in once signed out, so they aren't offered it. */}
        {!guest && (
          <form action={signOut} className="mt-4">
            <button type="submit" className={`w-full ${button("line", "sm")}`}>
              Sign out
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/** A coin with a highlighter centre: one credit. */
function CreditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" fill="#ffe15a" />
    </svg>
  );
}
