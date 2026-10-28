import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { HandNote, Wordmark } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign-in and sign-up: the form on the left, a sheet of graph paper with the brain diagram and a
 * few drifting tags on the right, which a phone leaves out. Someone already signed in goes
 * straight to their decks, unless they're a guest come to sign up.
 *
 * The tags say what the answer key does rather than name a label: this is the landing page's
 * sample question, and a tag naming one of its labels would answer it.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  // A guest is signed in too, but comes here to sign up and keep their deck.
  if (data?.claims && data.claims.is_anonymous !== true) redirect("/dashboard");

  return (
    <div className="flex min-h-screen w-full flex-wrap bg-paper">
      <div className="flex min-w-0 flex-[1_1_480px] flex-col gap-12 px-[clamp(24px,6vw,88px)] py-10">
        <Wordmark />
        <div className="my-auto w-full max-w-[420px]">{children}</div>
      </div>

      <aside
        aria-hidden="true"
        className="graph-paper relative hidden min-w-0 flex-[1_1_520px] items-center justify-center overflow-hidden border-l-[1.5px] border-ink bg-panel p-12 lg:flex"
      >
        <div className="relative w-full max-w-[540px]">
          <div className="rotate-[1.5deg] rounded-xl border-[1.5px] border-ink bg-white p-4 shadow-[12px_12px_0_rgb(26_34_56/0.1)]">
            {/* eslint-disable-next-line @next/next/no-img-element -- the public blanked render */}
            <img src="/demo/brain-lobes.png" alt="" className="block h-auto w-full rounded-md" />
          </div>
          <Tag className="top-[18%] -left-9" tilt="-rotate-[4deg]" highlight>
            typos forgiven
          </Tag>
          <Tag className="top-[4%] -right-7 [animation-delay:1.4s]" tilt="rotate-[3deg]">
            look-alikes caught
          </Tag>
          <Tag className="-right-11 bottom-[16%] [animation-delay:2.6s]" tilt="-rotate-2" highlight>
            linked to your slide
          </Tag>
          <HandNote className="absolute -bottom-20 left-0 text-[30px]">
            learn the labels, not just the words
          </HandNote>
        </div>
      </aside>
    </div>
  );
}

function Tag({
  children,
  className,
  tilt,
  highlight = false,
}: {
  children: ReactNode;
  className: string;
  tilt: string;
  highlight?: boolean;
}) {
  return (
    <div className={`absolute animate-float ${className}`}>
      <span
        className={`inline-flex h-11 items-center rounded-md border-[1.5px] border-ink px-4 font-hand text-2xl font-semibold whitespace-nowrap shadow-[3px_3px_0_rgb(26_34_56/0.18)] ${tilt} ${highlight ? "bg-marker" : "bg-tag"}`}
      >
        {children}
      </span>
    </div>
  );
}
