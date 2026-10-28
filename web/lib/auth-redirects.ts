/**
 * Where signing in sends people: shared by the sign-in actions, the OAuth callback and the login
 * page. Nothing here reads cookies or env, so it runs anywhere, the tests included.
 */

/** Where a signed-in student lands when nothing better is known. */
export const DEFAULT_NEXT = "/dashboard";

/** Supabase Auth sends Google sign-ins back here; app/auth/callback/route.ts takes over. */
export const AUTH_CALLBACK_PATH = "/auth/callback";

/** Any origin would do: parsing against it only has to show that `next` stays on it. */
const BASE = new URL("http://next.invalid");

/**
 * `next` as a path on this site, or DEFAULT_NEXT. It arrives in URLs and form fields anyone can
 * write, so only a same-site path passes: one starting with a single `/`. `//evil.com` is another
 * site, and so is `/\evil.com`, which browsers read as `//evil.com`.
 *
 * The value is also parsed the way a browser would, because the parser drops tabs and newlines
 * (`/<tab>/evil.com` is `//evil.com`) and resolves dot segments (`/..//evil.com` is `//evil.com`
 * too). What comes back is the parsed form, checked again.
 */
export function safeNext(value: unknown): string {
  if (typeof value !== "string" || !isSameSitePath(value)) return DEFAULT_NEXT;

  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return DEFAULT_NEXT;
  }
  const path = `${url.pathname}${url.search}${url.hash}`;
  return url.origin === BASE.origin && isSameSitePath(path) ? path : DEFAULT_NEXT;
}

function isSameSitePath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\");
}

/**
 * The origin the browser is using, such as https://figurequiz.online, from the forwarded headers
 * Vercel sets (and `next dev` / `next start` add when missing). Null when they don't name a plain
 * host[:port] over http or https.
 */
export function requestOrigin(headers: Pick<Headers, "get">): string | null {
  const host = firstValue(headers.get("x-forwarded-host")) ?? firstValue(headers.get("host"));
  if (!host) return null;
  const proto =
    firstValue(headers.get("x-forwarded-proto"))?.toLowerCase() ??
    (LOOPBACK.test(host) ? "http" : "https");
  if (proto !== "http" && proto !== "https") return null;

  let url: URL;
  try {
    url = new URL(`${proto}://${host}`);
  } catch {
    return null;
  }
  // A path, query or credentials means the header wasn't a host at all.
  const bare = url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  return bare ? url.origin : null;
}

const LOOPBACK = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

/** The first entry of a header that proxies may have turned into a comma-separated list. */
function firstValue(header: string | null): string | null {
  return header?.split(",")[0]?.trim() || null;
}

/** The callback URL on `origin`, carrying `next` through Google and back. */
export function authCallbackUrl(origin: string, next: string): string {
  const url = new URL(AUTH_CALLBACK_PATH, origin);
  url.searchParams.set("next", safeNext(next));
  return url.toString();
}

/**
 * Everything the login page may say about a failed Google sign-in. The page shows `?error=` only
 * when it is one of these: the query string is anyone's to write, and the page must not say
 * whatever a link tells it to.
 */
export const LOGIN_ERRORS = {
  unavailable: "Google sign-in isn't available right now. Use your email and password instead.",
  cancelled: "Google sign-in was cancelled.",
  expired: "That sign-in expired. Start again from this page.",
  signupsClosed: "New accounts can't be created right now.",
  failed: "Google sign-in didn't work. Try again in a minute.",
  identityTaken:
    "That Google account already has FigureQuiz. Sign in with it to use it; the guest deck stays with the guest.",
} as const;

export type LoginError = (typeof LOGIN_ERRORS)[keyof typeof LOGIN_ERRORS];

const LOGIN_ERROR_MESSAGES: readonly LoginError[] = Object.values(LOGIN_ERRORS);

/** /login showing `error`, keeping `next` so that trying again still ends up there. */
export function loginErrorPath(error: LoginError, next: string): string {
  const query = new URLSearchParams({ error });
  const target = safeNext(next);
  if (target !== DEFAULT_NEXT) query.set("next", target);
  return `/login?${query}`;
}

/** The login page's `?error=` value if it is a message from LOGIN_ERRORS, otherwise null. */
export function loginErrorMessage(value: unknown): LoginError | null {
  return LOGIN_ERROR_MESSAGES.find((message) => message === value) ?? null;
}
