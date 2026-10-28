import Link from "next/link";
import type { HTMLAttributes, ReactNode } from "react";

/*
 * The Field Guide's shared pieces (docs/design/field-guide.dna.json). Buttons are class strings
 * rather than components so a <button>, a <Link> and a form's submit all wear the same look.
 * Nothing here holds state, so server and client components can both use it.
 */

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap " +
  "transition-[translate,box-shadow,background-color] duration-200 ease-spring " +
  "focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ink " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANTS = {
  /** The one main action: ink pill that lifts over a yellow offset shadow. */
  ink:
    "bg-ink text-white hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-marker " +
    "disabled:hover:translate-0 disabled:hover:shadow-none",
  /** Secondary: white pill with an ink outline. */
  line: "border-[1.5px] border-ink bg-white text-ink hover:bg-marker-soft disabled:hover:bg-white",
  /** Confirms something that can't be undone, such as deleting a deck. */
  danger: "bg-coral-strong text-white hover:bg-coral-ink disabled:hover:bg-coral-strong",
} as const;

const BUTTON_SIZES = {
  md: "h-11 px-5 text-[15px]",
  sm: "h-10 px-4 text-sm",
  lg: "h-13 px-7 text-base",
} as const;

export function button(
  variant: keyof typeof BUTTON_VARIANTS = "ink",
  size: keyof typeof BUTTON_SIZES = "md",
): string {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]}`;
}

/** The white, ink-bordered panel with a hard offset shadow that most content sits on. */
export function Card({
  children,
  className = "",
  as: Tag = "div",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "aside";
} & Omit<HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <Tag
      className={`rounded-xl border-[1.5px] border-ink bg-white shadow-card ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** "DIAGRAM", "TABLE": the small stamp above a question title. */
export function KindTag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center rounded-[5px] border-[1.5px] border-ink bg-tag px-2 text-[11px] font-bold tracking-[0.08em] uppercase">
      {children}
    </span>
  );
}

/** A handwritten aside, tilted slightly. Decoration, so keep it short and never essential. */
export function HandNote({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={`m-0 origin-left -rotate-2 font-hand text-[26px] font-semibold ${className}`}>
      {children}
    </p>
  );
}

/** The mark: a hexagonal tag with a highlighter dot. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 26 26"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7.5 13 3l9 4.5v11L13 23l-9-4.5z" />
      <circle cx="13" cy="13" r="3.2" fill="#ffe15a" />
    </svg>
  );
}

/** The wordmark, linking home. */
export function Wordmark({ href = "/", size = "md" }: { href?: string; size?: "md" | "sm" }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-md font-display font-extrabold tracking-[-0.02em] text-ink focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ink ${
        size === "sm" ? "text-xl" : "text-[22px]"
      }`}
    >
      <Logo size={size === "sm" ? 26 : 28} />
      FigureQuiz
    </Link>
  );
}

/** A progress bar: highlighter fill on an ink-outlined track. */
export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="img"
      aria-label={label}
      className="h-2.5 overflow-hidden rounded-full border-[1.5px] border-ink bg-track"
    >
      <span
        className={`block h-full origin-left animate-fill bg-marker ${percent < 100 ? "border-r-[1.5px] border-ink" : ""}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** "← Your decks": the way back up, an arrow and a label that truncates rather than wraps. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="flex min-h-11 max-w-full items-center gap-2 rounded-md font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ink"
    >
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
        className="shrink-0"
      >
        <path d="M19 12H5M11 6l-6 6 6 6" />
      </svg>
      <span className="truncate">{children}</span>
    </Link>
  );
}

/** A ticked line in a plan or feature list. */
export function Included({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <svg
        width="18"
        height="18"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="mt-[3px] shrink-0 text-leaf"
      >
        <path d="M2.5 9c1.5 1.2 2.6 2.4 3.6 3.8C8 9 10.5 5.8 13.8 3" />
      </svg>
      {children}
    </li>
  );
}

/** A strip of highlighter tape across a card's top edge. */
export function Tape() {
  return (
    <span
      aria-hidden="true"
      className="absolute -top-3 left-1/2 h-6 w-24 -translate-x-1/2 -rotate-[2.5deg] bg-marker/80"
    />
  );
}
