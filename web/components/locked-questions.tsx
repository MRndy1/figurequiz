import Link from "next/link";

import { GoogleSignIn } from "@/app/(auth)/google-sign-in";
import { button, HandNote } from "@/components/ui";

/**
 * What a guest sees after their free questions: the rest of the deck, blurred and locked, and
 * the way to sign up for it. Nothing here comes from the locked questions themselves: they never
 * leave the server (lib/dal/questions.ts), so the cards behind the blur are drawn, not real.
 */
export function LockedQuestions({ count, next }: { count: number; next: string }) {
  return (
    <div className="flex flex-col items-center gap-5 py-2 text-center">
      <div aria-hidden="true" className="relative h-44 w-full max-w-md">
        {[0, 1, 2].map((card) => (
          <div
            key={card}
            className="absolute inset-x-4 flex h-32 flex-col gap-2.5 rounded-xl border-[1.5px] border-ink bg-white p-4 blur-[3px]"
            style={{ top: card * 14, rotate: `${(card - 1) * 2}deg`, opacity: 1 - card * 0.2 }}
          >
            <span className="h-5 w-20 rounded-[4px] border-[1.5px] border-ink bg-tag" />
            <span className="h-4 w-3/4 rounded-full bg-ink/70" />
            <span className="h-3 w-full rounded-full bg-ink-faint/40" />
            <span className="h-3 w-2/3 rounded-full bg-ink-faint/40" />
          </div>
        ))}
        <span className="absolute top-1/2 left-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[1.5px] border-ink bg-marker shadow-press">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        </span>
      </div>

      <div className="flex flex-col items-center gap-1.5">
        <HandNote className="origin-center text-2xl">
          {count} more {count === 1 ? "question is" : "questions are"} waiting
        </HandNote>
        <h2 className="m-0 font-display text-[clamp(24px,3vw,32px)] leading-tight font-extrabold tracking-[-0.025em] text-balance">
          Sign up free to keep going
        </h2>
        <p className="m-0 max-w-[40ch] text-pretty text-ink-muted">
          Your deck and your answers come with you, and your credits go up to 100.
        </p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-3">
        <GoogleSignIn next={next} />
        <Link href={`/signup?next=${encodeURIComponent(next)}`} className={`w-full ${button("line", "lg")}`}>
          Sign up with email
        </Link>
      </div>
    </div>
  );
}
