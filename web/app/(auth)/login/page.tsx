import type { Metadata } from "next";
import Link from "next/link";

import { signIn } from "@/app/(auth)/actions";
import { AuthForm } from "@/app/(auth)/auth-form";
import { GoogleSignIn, OrDivider } from "@/app/(auth)/google-sign-in";
import { HandNote } from "@/components/ui";
import { loginErrorMessage, safeNext } from "@/lib/auth-redirects";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Sign in" };

/** `?error=` is shown only when it is one of the app's own messages (LOGIN_ERRORS). */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error, next } = await searchParams;
  const message = loginErrorMessage(error);
  const { data } = await (await createClient()).auth.getClaims();
  const guest = data?.claims.is_anonymous === true;

  return (
    <main className="animate-rise">
      <HandNote>welcome back</HandNote>
      <h1 className="mt-1 mb-0 font-display text-[clamp(34px,4vw,42px)] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance">
        Sign in and pick up where you left off
      </h1>
      {guest && (
        <p className="mt-5 mb-0 rounded-lg border-[1.5px] border-dashed border-ink bg-marker-soft px-4 py-3 text-sm text-pretty">
          You&apos;re trying FigureQuiz as a guest. Signing in to another account leaves this
          guest&apos;s deck behind.{" "}
          <Link href="/signup" className="link-marker font-semibold text-ink">
            Sign up instead
          </Link>{" "}
          to keep it.
        </p>
      )}
      {message && (
        <p
          role="alert"
          className="mt-5 mb-0 rounded-lg border-[1.5px] border-coral-strong bg-coral-wash px-4 py-3 text-sm font-semibold text-coral-ink"
        >
          {message}
        </p>
      )}
      <div className="mt-7">
        <GoogleSignIn next={typeof next === "string" ? safeNext(next) : undefined} />
        <OrDivider />
        <AuthForm action={signIn} submitLabel="Sign in" />
      </div>
      <p className="mt-7 mb-0 text-[15px] text-ink-muted">
        New to FigureQuiz?{" "}
        <Link href="/signup" className="link-marker font-semibold text-ink">
          Create an account
        </Link>
      </p>
    </main>
  );
}
