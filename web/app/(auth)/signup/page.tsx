import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { signUp } from "@/app/(auth)/actions";
import { AuthForm } from "@/app/(auth)/auth-form";
import { GoogleSignIn, OrDivider } from "@/app/(auth)/google-sign-in";
import { HandNote } from "@/components/ui";
import { safeNext } from "@/lib/auth-redirects";
import { signupsEnabled } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Create account" };

/** A new account, or a guest keeping theirs: signing up then turns the guest into the account. */
export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  // SIGNUPS_ENABLED is read per request, never baked in at build time.
  await connection();
  const { next } = await searchParams;
  const after = typeof next === "string" ? safeNext(next) : undefined;
  const { data } = await (await createClient()).auth.getClaims();
  const guest = data?.claims.is_anonymous === true;

  return (
    <main className="animate-rise">
      <HandNote>{guest ? "keep your deck" : "make an account"}</HandNote>
      <h1 className="mt-1 mb-0 font-display text-[clamp(34px,4vw,42px)] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance">
        {guest ? "Sign up to keep your deck" : "Turn your next lecture into a quiz"}
      </h1>
      {guest && (
        <p className="mt-3 mb-0 text-pretty text-ink-muted">
          Your deck and your answers stay, every question opens, and your credits go up to 100.
        </p>
      )}
      {signupsEnabled() ? (
        <div className="mt-7">
          <GoogleSignIn next={after} />
          <OrDivider />
          <AuthForm
            action={signUp}
            submitLabel={guest ? "Sign up and keep my deck" : "Create account"}
            newPassword
            next={after}
          />
        </div>
      ) : (
        <p className="mt-5 mb-0 text-ink-muted">
          New accounts can&apos;t be created right now. You can still{" "}
          <Link href="/demo" className="link-marker font-semibold text-ink">
            try the sample deck
          </Link>
          , no account needed.
        </p>
      )}
      <p className="mt-7 mb-0 text-[15px] text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="link-marker font-semibold text-ink">
          Sign in
        </Link>
      </p>
    </main>
  );
}
