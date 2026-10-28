"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard", label: "Home" },
  { href: "/documents", label: "Decks" },
] as const;

/** The signed-in tabs. A deck's own pages count as Decks. */
export function AppNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="App" className="flex gap-1">
      {TABS.map(({ href, label }) => {
        const current = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`inline-flex h-10 items-center rounded-full px-2.5 text-[15px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ink sm:px-4 ${
              current
                ? "bg-marker-soft text-ink shadow-[inset_0_0_0_1.5px_var(--color-ink)]"
                : "text-ink-muted hover:bg-track hover:text-ink"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
