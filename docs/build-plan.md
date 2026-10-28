# Build plan: from prototype to product (26–31 Oct 2026)

The proof of concept proved the hero feature on one deck with hand-written questions. This plan
builds the real loop — **sign up → upload a .pptx → extract and OCR → generate questions →
study and get graded** — on the decided stack (Supabase, Vercel on `figurequiz.online`,
OpenRouter, `ingest` as a queue worker), with a working version to show on **Saturday
31 October**. `CLAUDE.md` stays the binding architecture; §9 lists the changes this plan makes
to it.

## 1. Decisions every step inherits

| # | Decision |
|---|---|
| D-1 | The worker talks to Supabase over **HTTPS only** (PostgREST RPC + Storage REST, plain `httpx`, one secret key). No Postgres connection: port 443 works on any network, and there is no pooler or IPv6 problem. |
| D-2 | The job state machine is **seven SQL functions**, `security definer`, executable by `service_role` only. Web and the worker both call them; every multi-row transition is one transaction. |
| D-3 | **Answer material is unreachable from the browser at the DB and Storage level**: keys live in a `question_keys` table, `assets` is service-only, both buckets are private, and signed URLs for unblanked images and source slides are created only after the attempt is stored. |
| D-4 | **The prototype moves to `/demo`**, needs no Supabase or OpenRouter, and its questions are also seeded into the product as a ready-made deck. |
| D-5 | **Generation runs in `after()` from the ingest callback**: atomic claim, self-imposed 240 s deadline (Vercel Hobby allows 300 s), 4 calls at a time, per-document caps, retryable. |
| D-6 | **Saturday scope**: PPTX only; `diagram_blank`, `mcq`, `short_answer`, `flashcard`; worker on the Mac; everything synchronous (no Batch API). |
| D-7 | **Cost is logged from OpenRouter's own `usage.cost`** (returned on every response), not a hand-kept price table. Token counts are still logged. |

## 2. Verified on 26 Oct

- The OpenRouter key in `web/.env.local` works. Two test calls to `anthropic/claude-sonnet-5.5`
  through `https://openrouter.ai/api/v1/messages` succeeded for $0.0006: a plain reply, and a
  **structured output** via `output_config.format` that returned valid JSON. Message ids start
  with `msg_` (served by Anthropic), and `usage` carries `cost` and `cost_details`.
- Platform facts behind the design: Next 16 uses `proxy.ts`; Supabase SSR auth refreshes in
  `proxy.ts` with `getClaims()`; Vercel Hobby = 300 s functions, 4.5 MB bodies, non-commercial;
  Supabase Free = 50 MB uploads, direct browser upload via `createSignedUploadUrl` +
  `uploadToSignedUrl`; the built-in mailer only reaches team members; Vercel apex = `A @ 76.76.21.21`, DNS only.
- Still unverified: prompt caching through OpenRouter (needs prompts ≥ 512 tokens), and the new
  `sb_secret_` Supabase keys with `httpx` (F0's smoke test).

## 3. Steps

### Step 0 — Human prerequisites
1. ~~OpenRouter key~~ (done). Optional: OpenRouter → Settings → Routing, allow only Anthropic.
2. Supabase: create project `figurequiz` in **ap-southeast-2 (Sydney)**, keep the DB password in a
   password manager, run `supabase login`, and create two secret keys (one for the web app, one for
   the worker). Save them with `scripts/set-secret.sh`.
3. Vercel: sign in with GitHub and grant access to `MRndy1/ai-study-platform`.
4. Sign in to the Supabase and Cloudflare MCPs with `/mcp`.

### Step 1 — F0 Foundation (Mon)
- `supabase init`; `supabase/config.toml` with `enable_confirmations = false`, minimum password
  length 8, redirect URLs for localhost and `https://figurequiz.online/**`.
- `supabase/migrations/…_core_schema.sql`: `units`, `documents` (`status` of 7 values, `error`,
  `size_bytes`, `updated_at`), `assets` (service-only), `questions` (public `payload` only, plus
  `document_id`, `title`, `status`, `error`, `source_ref`, `source_page`), `question_keys`
  (service-only), `attempts`, `usage_counters`, `llm_requests` (+ `document_id`, `route`,
  `stop_reason`, `provider_request_id`). Users get SELECT-only policies on their own rows; all
  writes go through the service role. `review_state`, `subscriptions`, `stripe_events` come later.
- `…_storage_buckets.sql`: private `uploads` (50 MiB, .pptx) and `renders` (10 MiB, images); no
  storage policies.
- `…_queues_and_jobs.sql`: `pgmq` queues `extract` and `blank`, and the job functions
  `enqueue_extract`, `claim_next_job` (blank before extract), `complete_extract`,
  `create_question` (inserts question + key, and a `blank` job when it has blanks),
  `complete_blank`, `fail_job`, `retry_job_later` — each revoked from `public, anon,
  authenticated` and granted to `service_role`.
- `supabase/tests/rls.test.sql` (pgTAP) and `contracts/examples.json` (one example of every queue
  message, payload and storage path, parsed by both languages' tests).
- Web: install `@supabase/supabase-js @supabase/ssr zod server-only @anthropic-ai/sdk` (the only
  step that touches `package.json`); `web/lib/env.ts` (lazy, Zod-checked), `web/lib/supabase/
  {server,client,admin}.ts`, generated `database.types.ts`, `web/lib/dal/auth.ts`
  (`requireUser()` via `getClaims()`), `web/lib/contracts.ts` + test, `.env.example` files.
- **Verify:** `supabase db reset && supabase test db` (authenticated gets permission denied on
  `question_keys`, `assets` and every job function; users see only their own rows; anon sees
  nothing); the secret key can call `claim_next_job` and the publishable key cannot; web
  typechecks, tests and builds with no env; `supabase db push` to the cloud project and the same
  probe there.

### Step 2 — D1 `/demo` and the reveal leak (Mon, parallel with F0)
- Move the prototype pages and actions under `web/app/demo/`; redirect `/study` and
  `/questions/:id`; a new static landing page (Sign in · Create account · Try the demo).
- Fix the leak: unblanked images and source slides leave `web/public/` for `web/data/demo/`
  and are served through static imports in a `server-only` module; `PublicQuestion` loses
  `revealImage` and `slideImage`, which now arrive only in grade results. `QuestionCard` takes an
  `actions` prop (so demo and product share it), and blank inputs turn off autocorrect.
- **Verify:** tests and build pass; before answering, the page source has neither the original
  image nor slide 3; afterwards both appear; grading behaviour is unchanged.

### Step 3 — A Auth and upload (Tue)
- `web/proxy.ts` + `web/lib/supabase/proxy.ts` (`updateSession`; `/demo` and `/api/ingest` are
  excluded); `(auth)/login`, `(auth)/signup` and actions (signups gated by `SIGNUPS_ENABLED`).
- `(product)/dashboard`: `createUpload` (validates .pptx and ≤ 50 MiB, monthly cap, default unit,
  inserts the document, returns a signed upload URL) → browser `uploadToSignedUrl` →
  `finalizeUpload` (checks the object, calls `enqueue_extract`) → `/documents/[id]`, which polls
  status and says plainly when the worker seems offline.
- **Verify:** sign-up/sign-out; uploading the sample deck leaves it `queued` with one `extract`
  message; a .pdf or > 50 MiB file is rejected legibly; user B gets 404 on user A's document.

### Step 4 — B The ingest worker (Tue–Wed; owns all of `ingest/`)
- Fix the title bug in `detect.py` (use the topmost short text box when `shapes.title` is None,
  and exclude it from label candidates).
- `ingest/app/extract.py`: `extract_deck()` built from `cli.py`'s `cmd_blank` chain
  (`detect_presentation` → `convert_to_pdf` → `render_page` → Tier 1 `_snapped_labels` or Tier 2
  `ocr_picture` → `Diagram.crop` → `crop_image`); `cmd_blank` is rebuilt on it. Deterministic
  asset ids so retries overwrite.
- `app/supa.py` (HTTPS gateway), `app/jobs.py` (`handle_extract`, `handle_blank`,
  `UserFacingError`), `app/callback.py`, `app/worker.py` (blank before extract, backoff when
  idle, `read_ct > 3` fails with a legible reason, `--once` for a scheduled job later).
- Storage: `renders/{user}/{doc}/pages/NNN.png`, `…/assets/{asset}.png` (the unblanked crop),
  `…/questions/{qid}.png`. Diagram payloads keep CLAUDE.md's shape, with boxes normalized to the
  stored crop — the exact image the blank job draws on and the student sees.
- **Verify:** pytest + ruff; against local Supabase, slide 3 of the sample deck becomes a Tier 2
  diagram; a blank job draws blanks on the printed labels; a renamed .txt fails legibly; a killed
  worker's job reappears after the visibility timeout.

### Step 5 — C Generation and the callback (Tue–Wed)
- `web/app/api/ingest/callback/route.ts` (`maxDuration = 300`): constant-time secret check, Zod
  body, atomic claim (`extracted → generating`), `after(runGeneration)`, 202.
- `web/lib/llm/` (client with OpenRouter base URL, `callStructured` with `messages.parse` +
  `output_config`, refusal and max-token handling, logging), `web/lib/prompts/
  {diagram-labels,text-questions}.ts` (≥ 512 tokens each so caching engages),
  `web/lib/schemas/generation.ts`.
- Routes: `diagram_labels` → Sonnet 5.5, effort `medium` (label list in; chosen labels,
  synonyms, confusables out); `text_questions` → Haiku 5.5, effort `low` (switch to Sonnet if the
  Wednesday check fails).
- `web/lib/generation/validate.ts` enforces the invariants from `lib/questions.test.ts` at
  runtime with `grading.ts` (drop confusables that grade correct, ≥ 2 blanks, MCQ evidence in the
  slide, options shuffled server-side). `run.ts`: diagrams first, caps (8 diagrams, 15 text
  slides, 60 questions, `DAILY_BUDGET_USD`), stop starting calls 45 s before the deadline.
- **Verify:** on the Step 4 document: `llm_requests` rows with costs, cache reads > 0 on repeat
  calls, a pending diagram question with a queued blank job, ready text questions, < $0.10.

### Step 6 — D2 Studying from Postgres (Tue–Wed, after F0 and D1)
- `web/scripts/seed-demo-document.ts` seeds the prototype questions into a signed-up account.
- `web/lib/dal/questions.ts` (study reads via RLS, public columns only; grading reads keys via
  the service role), `(product)/documents/[id]/study`, `(product)/grade-actions.ts` (grade with
  the unchanged `grading.ts`, insert the attempt, then sign reveal and source-slide URLs).
- **Verify:** all seeded questions grade correctly with attempts stored; before answering, no
  answer fields or original-image URLs reach the browser; with a user JWT, `question_keys`,
  `assets` and original images are all denied.

### Step 7 — Integration (Wed)
Merge D2 → A → B → C; run the full local loop; add "Retry generation" for stale states; run the
Haiku-vs-Sonnet check on slides 2–4 against the 22 hand-written questions (< $0.50).

### Step 8 — Deployment
- **8a (Tue morning):** Vercel project (root `web`, Fluid, `syd1`), env vars (`OPENROUTER_API_KEY`
  production-only), `figurequiz.online` + `www` with Cloudflare `A @ 76.76.21.21` DNS-only;
  `output: "standalone"` only off Vercel. The landing page and `/demo` go live early.
- **8b (Thu):** push migrations; Supabase Auth Site URL and redirects; `SIGNUPS_ENABLED=true`;
  the worker on the Mac against the cloud (`docker run -d --restart unless-stopped …`); seed the
  demo account.

### Step 9 — Hardening and rehearsal (Fri)
3–5 real decks, failure paths, the 375 px layout, security probes against production, cost
totals, a test from the school network (fallback: the `*.vercel.app` URL), pre-processed demo
decks; code freeze 18:00.

## 4. Parallel sessions and file ownership

| Work | When | Owns | Needs |
|---|---|---|---|
| F0 foundation | Mon | `supabase/**`, `contracts/**`, `web/package.json` + lockfile, `web/lib/{env,contracts}.ts`, `web/lib/supabase/**`, `web/lib/dal/auth.ts` | — |
| D1 demo + leak | Mon | `web/app/{page,layout}.tsx`, `web/app/demo/**`, `web/lib/{questions,public-question,grade-types}.ts`, `web/components/**`, `web/public/**`, `web/data/demo/**`, `web/next.config.ts` | — |
| A auth + upload | Tue | `web/proxy.ts`, `web/app/(auth)/**`, `web/app/(product)/{layout,dashboard,documents/[id]/page}`, upload components | F0 |
| B worker | Tue–Wed | `ingest/**` | F0 |
| C generation | Tue–Wed | `web/app/api/ingest/**`, `web/lib/{llm,prompts,schemas,generation}/**` | F0 |
| D2 study | Tue–Wed | `(product)/documents/[id]/study/**`, `grade-actions.ts`, `web/lib/dal/{questions,storage}.ts`, seed script | F0, D1 |

Rules: one worktree per parallel session; only F0 installs packages; only B edits `ingest/`;
migrations after F0 are new files written by the main session; real LLM calls only in the main
checkout (the only place the key lives).

## 5. Schedule

| Day | Work |
|---|---|
| Mon 26 | Step 0; F0 and D1 in parallel, merged by evening; cloud `db push` |
| Tue 27 | 8a domain + Vercel live; A, B, C, D2 in parallel; first real generation calls |
| Wed 28 | Finish B and C; integration; retry; Haiku-vs-Sonnet check |
| Thu 29 | 8b production cutover; end-to-end on `figurequiz.online` from a phone |
| Fri 30 | Real decks, failure paths, probes, school-network test; freeze 18:00 |
| Sat 31 | Start the worker, smoke-test an upload, check credit, keep `/demo` open |

## 6. Saturday

**Demoable:** sign up and upload on `figurequiz.online`; watch queued → processing → generating →
ready; study diagram questions (OCR or XML boxes, Sonnet-chosen labels with synonyms and
confusables), MCQs, fill-in-the-blanks and flashcards; a typo accepted, a confusable rejected,
the reveal and source slide only after answering; per-deck cost; a probe showing answer keys are
unreachable; `/demo` as the fallback.

**Not in Saturday's build:** PDF/DOCX, table questions, image MCQs, the worker on Azure, Stripe and
free/paid gating (caps stand in), spaced repetition, Batch API, essay grading, password reset.

**Cut list (first to go first):** short-answer generation → cost line on the document page →
flashcard self-ratings → retry button → text questions altogether → a live upload (present the
ready-made account plus `/demo`).

**Never cut:** diagram questions from uploaded decks, answer-key protection, `source_ref` with the
source slide after answering, legible failure messages.

## 7. Risks, most dangerous first

1. **Integration slipping** — contracts frozen Monday with fixture tests; the seed script makes
   the product demoable without generation; the cut list.
2. **Diagram quality on unseen decks** — Tier 1 is untested on real slides; fix the title bug,
   let the model filter OCR junk, choose demo decks deliberately.
3. **Sonnet 5.5 refusals** on anatomy or microbiology slides (its `bio` classifier; no
   server-side fallback through OpenRouter) — handled per slide with a note.
4. **The Mac worker is a single point of failure** — `--restart unless-stopped`, `caffeinate`;
   uploads wait in the queue; the demo account and `/demo` are backstops.
5. **Generation stuck past 300 s** — 240 s deadline, per-call timeouts, caps, retry button.
6. **Cloud-only surprises** (pgmq, buckets, grants) — push to the cloud on Monday, not Thursday.
7. **DNS/TLS or a school filter on `.online`** — DNS on Tuesday, school test on Friday,
   `vercel.app` fallback.
8. **Open signup burning credit** — a spend limit on the OpenRouter key, per-user caps, daily budget,
   `SIGNUPS_ENABLED`.

## 8. Not decided here

Batch API, Azure Container Apps deployment of the worker (the `--once` mode is ready for it),
gating, spaced repetition and Stripe follow the build order in `CLAUDE.md` after Saturday.

## 9. CLAUDE.md changes this plan makes

- Data model: `question_keys` added and `answer_key` removed from `questions`; `assets` and
  `question_keys` join `stripe_events` as service-only; the new columns above.
- Ingestion: the worker uses HTTPS RPC; the seven job functions are its API.
- Prompts: one file per *route* (`diagram-labels`, `text-questions`) instead of one per question
  type, to cut calls per slide for the 300 s budget.
- Conventions: the source slide unlocks after answering.
- Cost: logged from OpenRouter's `usage.cost`.
