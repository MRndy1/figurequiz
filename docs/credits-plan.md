# Credits, guest decks and essays — plan

Agreed with the user on 2026-10-26. Built in this order, one PR per phase, each landed on `main`
(which deploys production) before the next starts.

**Status, 2026-10-26:** phases 1–5 are built and live (PRs #49–#54). Guest decks stay off in
production until the user turns on Supabase's anonymous sign-ins and adds the Turnstile keys
(`SESSION.md`, *Production*), and a privacy page is still to write. It replaces the free/paid table in
`CLAUDE.md` (free = multiple choice and flashcards only) with credits: every question type is
open to everyone, and AI work costs credits.

## Decisions

- **1 credit = 1 page** (a slide, or a PDF page) **that ends up with questions.** Title,
  agenda and "Questions?" slides that produce nothing cost nothing.
- **Free credits, once per person, never refilled: 100.** A guest gets 25 (about one lecture),
  and signing up adds 75. Signing up directly gives 100.
- **AI-marked answers cost credits.** Essay marking is 2 credits. Answers the app marks itself
  (diagram, table, multiple choice, fill-in, flashcards) stay free.
- **Guests try 3 questions** — the deck's diagram or table first — then the rest are blurred
  behind "Sign up to keep going". Signing up keeps the deck.
- **Payments are a mockup.** Plans and top-ups are on the site with prices in credits, but
  checkout says payments aren't live, and it never grants credits.

## What a credit costs us

Measured on 2026-10-26 from `llm_requests` (three real decks):

| Made from one page | Model | Cold cache | Warm cache |
|---|---|---|---|
| Text questions (MCQ, fill-in, flashcards) | Haiku 5.5 | ~0.08¢ | ~0.03¢ |
| A diagram question | Sonnet 5.5 | ~0.9–1.0¢ | ~0.3¢ |
| A table question | Sonnet 5.5 | ~0.9¢ | ~0.4¢ |

Whole decks came to 0.14–0.5¢ a page, so 100 free credits cost at most about $0.50, and about
$0.15–0.20 for a typical lecture. Essay marking is estimated at ~1¢ (Sonnet). OpenRouter adds
5.5% when credit is bought. Re-check against `llm_requests` once real users upload.

## Phases

### 1. Credits

- `credit_ledger`: every grant, hold, release and spend as a row (`user_id`, `delta`,
  `reason`, `document_id`, `note`). Users read their own rows; only the service role writes.
  `credit_balance` (view, `security_invoker`) sums them.
- Welcome credits from a trigger on `auth.users`: 25 for a guest, the rest of 100 on sign-up or
  upgrade, at most once each. Existing accounts are backfilled to 100.
- Writing a deck's questions: `hold_credits` holds one credit per page that could get
  questions (as many as the balance allows), generation plans only those pages, and
  `release_credits` keeps the pages that got questions and gives the rest back. Both run under
  a per-user lock, so two decks at once can't overspend, and a page is never charged twice.
- Short of credits: the deck gets questions from as many pages as the balance covers and says
  how many pages are waiting; **Finish this deck** writes the rest after a top-up. With no
  credits at all, it fails with a reason, and the same button retries it.
- In the app: the balance in the header, a Credits page with the history, credits on the deck
  page and the drop zone. Uploading needs at least 1 credit.

### 2. Guest decks and the blur

- The landing page's drop zone works signed out: a Supabase anonymous user is created on the
  spot, so a guest's deck is a normal deck under RLS.
- Guests: one deck, and the 3-question taste. The blur is enforced on the server: locked
  questions never reach the browser, and grading refuses them.
- Sign up from the blur, with Google (`linkIdentity`) or email (`updateUser`), upgrades the
  same user, so the deck stays. A Google account that already has FigureQuiz: say so, and sign
  in there (the guest deck stays behind for now).
- Abuse protection: Cloudflare Turnstile before a guest is created, a cap of 200 new guests a
  day across the site (`guest_starts` records only when each guest started, never an address),
  and the existing daily spending cap. Without the Turnstile keys, guest decks stay off and the
  landing page asks visitors to sign up.
- A privacy page: strangers now upload files. Needs a contact email (open decision 4 in
  `SESSION.md`).
- Needs from the user: turn on anonymous sign-ins and manual identity linking in Supabase, and
  create a Turnstile widget (its secret goes in with `scripts/set-secret.sh`).

### 3. Image check

- Before a diagram's labels are judged, Haiku looks at the crop and sorts it: labelled
  diagram, screenshot, chart, photo, text, decoration or plain figure. Only labelled diagrams
  go on to Sonnet. Measured at 0.013–0.033¢ a picture. A failed check lets the diagram
  through, and the text-only screenshot rule stays as a backstop.
- Generation runs each route's first call alone, so the rest read its prompt cache instead of
  each writing it. The look at a picture is its own job, which hands on to the label
  judgement, so a skipped screenshot can't leave Sonnet's cache cold. On the forensics chapter
  from a cold start, the second label judgement cost 0.31¢ instead of 1.01¢, and the 9-page
  deck 1.54¢ instead of 2.22¢.

### 4. Essays

- An `essay` question type: 1–2 per deck, each with a rubric of criteria and points, written
  from the deck's text.
- Marking: the student writes up to 250 words; 2 credits are spent before the call and given
  back if it fails; Sonnet marks against the rubric with structured output (points and
  feedback per criterion). The essay is marked as data: instructions inside it are ignored.
- Measured locally on the forensics chapter: one essay with a 4-criterion, 8-point rubric for
  1.2¢. A partial answer scored 6/8 with feedback naming the missing point (0.83¢ cold). An
  answer that only asked for full marks scored 0/8.

### 5. Pricing mockup

- `/pricing`: Free (100 credits once), monthly plans that come with credits, and top-up packs.
  Checkout shows the order and "Payments aren't live in this proof of concept".
- Credits for a demo account are granted by hand (`admin_grant`, service role only).
- Built with placeholder prices in `web/lib/pricing.ts`: Student A$5 a month for 400 credits,
  Exam season A$12 a month for 1,200, and top-ups of 100, 500 and 1,500 credits for A$2, A$8
  and A$20. The cheapest credit, about 1.3 Australian cents on the 1,500 top-up, still covers
  a page at the top of the measured range (0.5 US cents, about 0.8 Australian), before card
  fees. Checkout has no form: it shows the order and a disabled Pay button.

### 6. Final check

- Production end to end as a guest and as a signed-in user; `CLAUDE.md` and `SESSION.md`
  updated.

## Later

- Delete guest data after 7 days without sign-up (users, rows and Storage objects).
- Move a guest's deck into an existing account on sign-in.
- The worker on Azure Container Apps, before guests are invited widely: today the Mac is a
  single point of failure.
- Real payments (Stripe) in place of the mockup.
