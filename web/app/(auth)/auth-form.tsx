"use client";

import { useActionState } from "react";

import type { AuthFormState } from "@/app/(auth)/actions";
import { button } from "@/components/ui";

const FIELD =
  "mt-2 h-[50px] w-full rounded-xl border-[1.5px] border-ink bg-white px-4 text-base text-ink " +
  "outline-none transition-shadow focus:shadow-focus";

type Props = {
  action: (state: AuthFormState, form: FormData) => Promise<AuthFormState>;
  submitLabel: string;
  /** Sign-up: the browser offers to generate a password and checks the minimum length. */
  newPassword?: boolean;
  /** Where to go once signed up: the action checks it again. */
  next?: string;
};

/** Email and password, for both signing in and creating an account. */
export function AuthForm({ action, submitLabel, newPassword = false, next }: Props) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-[18px]">
      {next && <input type="hidden" name="next" value={next} />}
      <div>
        <label htmlFor="email" className="block text-sm font-semibold">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          className={FIELD}
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-semibold">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={newPassword ? "new-password" : "current-password"}
          required
          minLength={newPassword ? 8 : undefined}
          aria-describedby={newPassword ? "password-hint" : undefined}
          className={FIELD}
        />
        {newPassword && (
          <p id="password-hint" className="mt-1.5 mb-0 text-sm text-ink-muted">
            At least 8 characters.
          </p>
        )}
      </div>

      {state.error && (
        <p role="alert" className="m-0 text-sm font-semibold text-coral-ink">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p role="status" className="m-0 rounded-lg bg-marker-soft px-3 py-2 text-sm">
          {state.notice}
        </p>
      )}

      <button type="submit" disabled={pending} className={`mt-1.5 w-full ${button("ink", "lg")}`}>
        {pending ? "One moment…" : submitLabel}
      </button>
    </form>
  );
}
