# CLAUDE.md

Project context for Claude Code. Read this before making changes.
Current progress, open decisions, and next steps: @SESSION.md — update it at the end of
each working session. It is a private handoff log, kept out of the public repository.

---

## What this is

An AI study platform that turns lecture slides, Word documents, and PDFs into flashcards
and exam-realistic quizzes — including **image-based questions** (diagram fill-in-the-blank,
table reconstruction) that text-only tools like NotebookLM don't generate.

Capstone project, 12-week build, intended to ship as a real freemium SaaS product rather
than a demo.

**Name:** `FigureQuiz` — decided 2026-09-18; domain `figurequiz.online`, bought 2026-10-26. See Naming below.

---

## The one thing that matters

**Image-based question generation is the hero feature.** Everything else (MCQs, flashcards,
spaced repetition, dashboards) is table stakes that NotebookLM, Quizlet, and ChatGPT Study
Mode already do for free.

If a tradeoff comes up between polishing text quizzes and shipping diagram questions,
diagram questions win. Do not let this get deprioritized into "future work."

---

## Scope boundaries

These are deliberate decisions. Don't re-litigate them without asking.

| In scope | Out of scope |
|---|---|
| PPTX, DOCX, PDF upload | Website / URL ingestion (descoped: scraping fragility + copyright) |
| Native structured extraction (Tier 1) | Training custom CV models |
| OCR fallback for scanned pages and flattened figures (Tier 2) | Handwriting recognition |
| Diagram fill-in-blank, table reconstruction | Video/audio input |
| English | i18n |
| Responsive web app (phone, tablet, desktop); phone-first study screens; installable via web manifest | Native iOS/Android apps (store review, in-app purchase rules); offline mode (sync complexity) |

**Tier 1 vs Tier 2 is the central architectural idea:**

- **Tier 1 (primary):** PPTX/DOCX/PDF where labels are *separate text objects* positioned
  over an image. Extraction is geometry + XML parsing. No computer vision needed.
  This covers the large majority of real lecture slides.
- **Tier 2 (fallback):** flattened/scanned images where text is baked into pixels.
  Requires OCR with bounding boxes. Slower, less accurate, costs more.

Always try Tier 1 first. Route to Tier 2 **per image, not per page**: any large picture with
fewer than 2 overlaid text labels goes to OCR, because its labels may be baked into the
pixels. A textbook figure pasted onto a slide that also has a title and bullets is common,
and a page-level "near-zero text" check never fires on it. A scanned page is the same case
at page scale.

---

## Architecture

Two services. The split exists because the document-parsing ecosystem is Python and the
app ecosystem is TypeScript.

```
repo/
├── web/          Next.js (App Router, TypeScript) — UI, auth, billing, quiz runtime
├── ingest/       Python queue worker — document parsing, image extraction, rendering, blanking
└── supabase/     migrations, RLS policies, seed data
```

**Flow:** `web` uploads file to Supabase Storage → enqueues an `extract` job on Supabase
Queues (`pgmq`) → `ingest` reads the job, pulls the file, extracts assets, writes rows to
Postgres, and calls `web`'s ingest callback → `web` calls Claude (through OpenRouter) to
generate questions from extracted assets (diagram questions add a `blank` job for `ingest` —
see Blanking) → questions stored → student studies in `web`.

`ingest` never calls an LLM. It only extracts and normalizes. Question generation lives in
`web` so there's one place that owns prompts, model routing, and cost control.

`ingest` only makes outbound connections (queue, Storage, the callback) and serves no HTTP,
so it runs behind NAT or a school firewall with no open ports. It reaches the queue and the
database through Supabase's REST API over HTTPS, calling the job functions as RPCs with its
own secret key, never through a direct Postgres connection. The callback route checks a
shared secret sent by `ingest`.

### Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend + API | Next.js (App Router, TS) | Server Actions for mutations |
| DB / Auth / Storage | Supabase (Postgres) | RLS on every table; sign-in by email + password or Google |
| Job queue | Supabase Queues (`pgmq`) | queues `extract` and `blank`; `web` enqueues, `ingest` consumes |
| Billing | Stripe | Checkout + Customer Portal, webhook → `subscriptions` |
| Ingestion | Python 3.11 queue worker | containerized; no HTTP server |
| PPTX | `python-pptx` | shapes, text boxes, positions from slide XML |
| DOCX | `python-docx` | paragraphs, tables, inline shapes |
| PDF | `PyMuPDF` (fitz) | text spans w/ bboxes, embedded images, page rendering; AGPL — see Gotchas |
| Slide rendering | LibreOffice headless → PDF → PyMuPDF `page.get_pixmap()` | one renderer for PPTX and PDF |
| Image editing | `Pillow` | drawing blanks over labels |
| OCR (Tier 2) | Tesseract (`pytesseract`) | `image_to_data` for bboxes |
| LLM | Claude via OpenRouter | Sonnet 5.5 primary, Haiku 5.5 for simple text — see Claude API usage |

### Hosting

| Piece | Where | Cost |
|---|---|---|
| `web` | Vercel (Hobby for the capstone; Pro once it takes real payments) | free |
| DB / Auth / Storage / Queues | Supabase cloud, free plan | free |
| `ingest` | Azure Container Apps job (not yet; Docker on a developer machine until then) | monthly free grant |

**Live since 2026-10-26** at https://figurequiz.online (and https://figurequiz.vercel.app):
Vercel deploys every push to `main`, and `ingest` runs in Docker on a developer machine until
it moves to Azure. Accounts and settings are in `SESSION.md`, *Production*.

**`ingest` on Azure, decided 2026-10-26.** It runs as a Container Apps *job* with an
event-driven trigger on queue depth: an execution starts when `extract` or `blank` has work,
and the job scales to zero when both are empty, so an idle month costs nothing. Each
subscription gets 180,000 vCPU-seconds and 360,000 GiB-seconds free per calendar month. The
4-slide sample deck takes 1.8 s in the container; even allowing a minute per real deck with
cold start, the grant covers about 3,000 decks a month. A job has no ingress, which suits a
worker that only makes outbound connections.

Keep the image portable: the subscription's terms are in `SESSION.md`, *Azure*. Not deployed
to Azure yet: the worker runs as `python -m app.worker` (`--once` for a job execution) in the
same image on a developer machine, which stays the fallback, and the image moves to any
container host after the course. Whenever no worker runs, uploads wait in the queue and
everything else keeps working. Free Supabase projects pause after a week without activity —
un-pause before a test day or the demo.

---

## Data model

Core tables, built by `supabase/migrations/`. Every user-owned table carries `user_id` directly
(denormalized), so each RLS policy is a plain `user_id = auth.uid()` check — no join chains
through `units` — and a composite foreign key holds that column equal to the parent row's, so
a row can never claim a different owner than its document.

```
users              (Supabase auth)
units              id, user_id, name, exam_date, created_at
documents          id, user_id, unit_id, filename, mime, storage_path, size_bytes, status,
                   error, page_count, created_at, updated_at
assets             id, user_id, document_id, page, kind, tier, payload(jsonb), image_path,
                   picture_kind, created_at
questions          id, user_id, document_id, asset_id, type, status, title, payload(jsonb),
                   image_path, error, source_ref, source_page, model_used, created_at,
                   updated_at
question_keys      question_id (pk), answer_key(jsonb), created_at
attempts           id, question_id, user_id, response(jsonb), correct, marking(jsonb), answered_at
usage_counters     user_id, period_start, uploads_used, questions_generated
llm_requests       id, user_id, document_id, route, model, input_tokens, output_tokens,
                   cache_read_tokens, cache_write_tokens, batch, cost_usd, stop_reason,
                   provider_request_id, created_at
credit_ledger      id, user_id, delta, reason, document_id, hold_id, note, created_at —
                   append-only; credit_balance (view) sums it. docs/credits-plan.md
guest_starts       id, created_at — when each guest started, for the daily cap; service-only
deck_progress      (view, security_invoker) document_id, user_id, questions, answered,
                   last_answered_at, types[], cover_image_path — for Home and Decks

Not built yet, added with their features:
review_state       question_id, user_id, ease, interval_days, due_at, lapses
subscriptions      user_id, stripe_customer_id, tier, status, current_period_end — plans
                   are a mockup until payments are real (see Credits, plans and guests)
stripe_events      event_id (pk), type, processed_at
```

Every jsonb shape and queue message is a Zod schema in `web/lib/contracts.ts`, with an example
in `contracts/examples.json` that both services' tests parse.

**Write protection.** The publishable key ships to the browser, so RLS and grants are the only
thing stopping direct reads and writes. Users get SELECT-only policies on their own rows; every
write goes through the service role (Server Actions, the ingest callback, `ingest`, later the
Stripe webhook), and `anon` gets nothing. `assets`, `question_keys` and `stripe_events` are
service-only — RLS on, no user policy, no user grant — so answer keys and unblanked labels never
reach a browser. The two Storage buckets, `uploads` and `renders`, are private with no policies:
browsers get signed URLs from server code. Each migration grants explicitly: the core migration
removes the API roles' default privileges on new tables and sequences in `public` (as
`config.toml` does locally), so a table nobody grants stays closed. Functions can't be closed
that way — Postgres lets PUBLIC execute any new function — so each migration revokes its own
from `public, anon, authenticated`. The job functions (`*_queues_and_jobs.sql`) are
`security definer` and executable by `service_role` alone.

**`documents.status`** — `uploading` → `queued` → `processing` → `extracted` → `generating` →
`ready`, or `failed` with `error` set to a reason a student can act on. `documents.pages_waiting`
counts pages a run left for lack of credits; "Finish this deck" writes them.

**Deleting a deck** (`deleteDeck`, the deck page): only while `uploading`, `queued`, `ready` or
`failed` (`DELETABLE` in `web/lib/dal/documents.ts`), checked in the same statement that deletes,
because a run being read or written holds credits it couldn't give back. Assets, questions, keys
and attempts cascade; `credit_ledger` and `llm_requests` keep their rows with `document_id` set
null, so balances and costs never change; the upload and the deck's folders in `renders` are
removed through the Storage API. A queued deck's job is archived when the worker finds it gone.

**`assets.kind`** — `text_block` | `labeled_diagram` | `table`. `figure` joins when image MCQs
are built: an enum value is added by the migration that ships the code and contract producing
it, so the database never holds a value nothing can read.

**`assets.tier`** — `1` (native extraction) | `2` (OCR). Set per asset, never per document:
one PDF can mix text pages, scanned pages, and flattened figures.

**`assets.page`**, **`questions.source_page`** — 1-based, as people number slides.

**`assets.payload`** for `labeled_diagram`:
```json
{
  "labels": [
    {"text": "Router", "x": 0.42, "y": 0.18, "w": 0.11, "h": 0.04}
  ],
  "image_width": 1920,
  "image_height": 1080
}
```
Label coordinates are **normalized 0–1** relative to the stored image (the diagram's crop in
`renders`, which the blank job draws on and the student sees), never raw EMU or points. Convert
at extraction time so downstream code never needs to know the source format. Tier 2 labels also
carry Tesseract's `confidence`.

**`assets.payload`** for `table`: `{"rows": [["Lobe", "Location"], ["Frontal", "Front of the
head"]], "header_rows": 1}` — cells as text, every row the same length, a merged cell's text in
its first cell. A cell's `row` and `col` (0-based, heading row included) are what a key points at.

**`questions.payload`** holds only what the student sees; a check constraint refuses the answer
fields a bug would most likely misplace there. **`question_keys.answer_key`** is the grading
key, read by the service role only: `{blanks: [{number, label_index, answer, synonyms[],
confusables[]}]}` for `diagram_blank`, `{blanks: [{number, row, col, answer, synonyms[],
confusables[]}]}` for `table_blank`, `{answer_index}` for `mcq`, `{answer, synonyms[],
confusables[]}` for `short_answer`, `{rubric: [{criterion, points}], model_answer}` for `essay`.
Flashcards are self-rated and have no key. A `table_blank`
payload is the extracted table with each blanked cell replaced by `{"blank": n}`;
`create_question` refuses anything else, so a graded cell never reaches the browser.

**`questions.status`** — `pending` | `ready` | `failed`. Diagram questions start `pending`
until their `blank` job finishes; every other type, tables included, is `ready` at once.
Students only see `ready` questions. Studying orders them by type, and the enum puts
`diagram_blank` then `table_blank` first.

**`questions.source_ref`** — always populated, e.g. `"lecture-04.pptx, slide 14"`;
`create_question` derives it from the document's filename and `source_page`. Every question
links back to where it came from. This is a trust feature, not a nice-to-have.

---

## Ingestion pipeline

### PPTX labeled-diagram detection (Tier 1, the core algorithm)

1. Open with `python-pptx`. Slide dimensions come from `prs.slide_width` / `slide_height`
   in EMU (914400 EMU = 1 inch).
2. Render each slide to PNG (LibreOffice → PDF → PyMuPDF `page.get_pixmap()`). Record PNG
   pixel dimensions.
3. Compute `scale = png_width / slide_width_emu` to map EMU → pixels → normalized coords.
4. Enumerate shapes. Classify:
   - `MSO_SHAPE_TYPE.PICTURE` / `GROUP` → candidate diagram, record bbox
   - text frames with short text (< ~5 words) → candidate label, record bbox + text
5. A picture with **≥ 2 candidate labels** whose bboxes overlap or sit within a small margin
   of the picture bbox → classify as `labeled_diagram`.
6. A large picture with < 2 candidate labels → Tier 2 OCR candidate; its labels may be baked
   into the pixels.
7. Emit asset: cropped/rendered image + normalized label list.

Shapes inside groups need recursive traversal — `shape.shapes` when
`shape_type == GROUP`. Don't skip this; grouped diagrams are common.

### PDF (Tier 1)

Same logic, different extractor. `page.get_text("dict")` gives spans with bboxes;
`page.get_images()` gives embedded images. Overlap test is identical once both are in
page coordinates.

**OCR routing:** any large embedded image with fewer than 2 overlapping text spans is an
OCR candidate, even on a page with plenty of text. A page whose extracted text is below a
threshold (~20 chars) but has a large embedded image is a scanned page — OCR the whole
page. Mark the resulting assets `tier = 2`.

**Built 2026-10-26** in `ingest/app/pdf.py`, with what a deck never needed. A slide master's
pictures are drawn on every PDF page, so pictures under 2% of the page (logos) and pictures
spanning 90% of its width or height (backgrounds, banners) are not figures. A page has no
title placeholder, so its title is its largest text when nothing else is as large. Wrapped
lines of one label are joined, and OCR labels that re-read the text layer (a title over a
banner) are dropped. A scanned page has under 20 characters of text and pictures covering half
of it: OCR reads its text into a tier-2 `text_block`, and the whole page is its one OCR
candidate. PDFs over 100 pages are refused with a message. An upload's object key ends in
`.pptx` or `.pdf`, and that extension is how the worker picks the reader.

### Tables (built 2026-10-26)

A deck's table shapes (python-pptx; "Header Row" marks the heading) and a PDF's ruled tables
(PyMuPDF `find_tables`) become `table` assets, tier 1 always. Tables smaller than 2×2, larger
than 20 rows or 8 columns, or with fewer than two filled body cells stay text only (their text
is still in the slide's `text_block`). Generation's `table_cells` route picks cells by row and
column; `web/lib/generation/validate.ts` holds the reply to the diagram rules (the cell as
printed must grade correct, no visible cell may show an answer, every row keeps a cell visible,
2–8 blanks).

### DOCX

Not an upload type yet. Tables are fully structured, so they would reuse the table path.
Diagram labeling in DOCX is weak (Word rarely uses the "image + overlaid text box" pattern
and inline shape positions are unreliable). **Lower priority — tables only for MVP.**

### Tier 2 (OCR)

`pytesseract.image_to_data(..., output_type=Output.DICT)` returns text with `left/top/width/height`
per word. Group adjacent words into label candidates, then feed into the same
blanking/grading path as Tier 1. Keep the interface identical so downstream code doesn't branch.

**Decided 2026-10-26: OCR places Tier 2 blanks, not a vision model.** Tesseract's boxes are
pixel-exact; a model's are approximate, and a blank that misses its label shows the answer.
So label positions always come from extraction — the slide XML in Tier 1, OCR in Tier 2 —
and the model only judges which labels to test and writes synonyms and confusables, from
text. Vision-model boxes are a fallback for figures OCR cannot read (stylized fonts, labels
over busy artwork), and only behind the box validation in `docs/prototype-questions.md` §3.7.
Built in `ingest/app/ocr.py`: Tesseract in sparse-text mode (`--psm 11`), words grouped into
lines and wrapped lines into labels, thresholds in `OcrConfig`. `app.cli blank` runs it on
every Tier 2 candidate and `app.cli ocr` runs it on a plain image. Measured results are in
`SESSION.md`.

### Blanking

Blanking spans both services: label selection needs Claude (owned by `web`), drawing needs
`Pillow` (owned by `ingest`).

0. Haiku looks at the diagram's picture first (route `image_check`, about 0.02¢) and sorts it:
   labelled diagram, screenshot, chart, photo, text, decoration or plain figure. Only a labelled
   diagram goes on to step 1; a failed check lets it through. The verdict is kept in
   `assets.picture_kind`, so the deck page can say which pictures were skipped.
1. `web` sends the label list (text plus the positions extraction found) to Claude → returns
   which labels are worth testing (skip "Figure 1", slide numbers, headings, and every label of
   a software screenshot, whose words are menus and buttons rather than parts), acceptable
   synonyms per label, and confusables — wrong answers spelled almost the same as the right
   one (see Grading).
2. `web` creates the question with `create_question`, as `pending`, with its answer key
   (`{blanks: [{number, label_index, answer, synonyms[], confusables[]}]}`). The function
   builds the `blank` job itself from the key's `label_index`es and the asset's own boxes, so
   no label text travels through the queue.
3. `ingest` draws a filled rect over each chosen label's bbox (padded — see Gotchas) on a
   copy of the image with `Pillow`, optionally with a numbered marker, stores the blanked
   image, and marks the question `ready` — or `failed` with a user-legible reason.
   `ingest` drains `blank` before `extract`: blank jobs are small and a student may be
   waiting on one.

Never mutate the original rendered image — always write a derived copy.

---

## Question types

| Type | Grading |
|---|---|
| `mcq` | exact option match |
| `flashcard` | self-rated (no auto-grade) |
| `diagram_blank` | normalized exact match against answer + synonyms → reject if it matches a stored confusable or another label in the same diagram → Levenshtein ratio ≥ 0.85 against answer + synonyms |
| `diagram_dragdrop` | label placed within tolerance radius of target bbox centre |
| `table_blank` | per cell, by the `diagram_blank` rule order (another cell's answer counts as another label) |
| `ordering` | exact sequence |
| `short_answer` | fill-in-the-blank: one gap written `____`, graded by the `diagram_blank` rule order against a single stored key. Deterministic, no API call |
| `essay` | prose up to 250 words, marked by Sonnet against the question's rubric (route `essay_marking`) for 2 credits, given back if marking fails; how it was marked is stored in `attempts.marking`. One or two per deck, written with the rubric and a model answer by route `essay_questions`. The demo shows its essay locked |

**Grading normalization:** lowercase, strip punctuation, collapse whitespace, strip
leading articles. Synonyms and confusables are generated **once at question-creation time
and stored** — never call the API during grading. Grading must be instant and free. Written
answers are the one exception: marking them is a model call, so it costs the student credits.

**Why confusables:** a 0.85 ratio (`1 − distance / max(len)`) accepts domain opposites —
afferent/efferent (0.875), abduction/adduction (0.889), hyperthyroidism/hypothyroidism
(0.867). Fuzzy matching exists only for typos, so it runs after the confusable check.

---

## Claude API usage

**Provider, decided 2026-10-26: OpenRouter.** Calls go to OpenRouter's Anthropic-compatible
Messages endpoint, so `web` keeps `@anthropic-ai/sdk` with `baseURL: "https://openrouter.ai/api"`
and an OpenRouter key in `OPENROUTER_API_KEY` (`web/.env.local`; the user creates it with a
credit limit, and Claude never handles it). The endpoint takes `cache_control`,
`output_config` (effort and format), adaptive thinking and image blocks. Model ids are
OpenRouter slugs, not Anthropic's. Per-token prices match Anthropic's; OpenRouter adds a 5.5%
fee when credits are bought. Pin routing to the Anthropic provider so cache hits and request
semantics stay consistent, and confirm both on the first real call.

Model routing, decided 2026-10-26 — output tokens dominate the bill, so route deliberately:

| Task | Model (OpenRouter slug) | Why |
|---|---|---|
| Picture check: is a diagram candidate a labelled diagram (route `image_check`) | `anthropic/claude-haiku-5.5` | a ~0.02¢ look saves a ~1¢ label judgement on screenshots, charts and photos |
| Label judgement (which labels to test, synonyms, confusables), image MCQs | `anthropic/claude-sonnet-5.5` | a wrong answer key mis-grades students |
| Table cells to blank, with synonyms and confusables (route `table_cells`) | `anthropic/claude-sonnet-5.5` | same stakes as a diagram's key |
| Complex question generation, short-answer grading | `anthropic/claude-sonnet-5.5` | quality |
| Simple text flashcards / MCQs | `anthropic/claude-haiku-5.5` | $0.10/$0.50 vs $2/$10; confirm with the eval before relying on it |
| Essay questions with rubric and model answer, once per deck (route `essay_questions`, effort low) | `anthropic/claude-sonnet-5.5` | the rubric decides every mark; ~1.2¢ a deck cold |
| Marking a written answer (route `essay_marking`, effort medium) | `anthropic/claude-sonnet-5.5` | students read the feedback; ~0.8¢ cold, ~0.5¢ warm, paid with 2 credits |

The model never places blanks: label positions come from the slide XML (Tier 1) or OCR
(Tier 2) — see Tier 2 (OCR).

**Rejected 2026-10-26: OpenAI's Decisions API and TypeSafe's Jev.** Both return only typed
answers — a probability, one option from a fixed list, or a score — with no text and no
coordinates, so neither can write an answer key or place a blank. Their speed buys nothing
here: generation runs once per upload in the background, and grading never calls a model.

**Rules:**

- **Always use prompt caching.** The system prompt (format instructions, output schema,
  few-shot examples) is identical across requests. Cache reads are $0.10/MTok vs $2.00
  standard on Sonnet 5.5, and $0.01 vs $0.10 on Haiku 5.5. Mark the system block with
  `cache_control`. The minimum cacheable prefix is **512 tokens on Sonnet 5.5 and Haiku
  5.5** — shorter prefixes silently don't cache (no error). Caches are per model.
  Verify `usage.cache_read_input_tokens > 0` on repeat requests.
- **Batch API for post-upload generation, except the first quiz.** Batches run at 50% off
  (stacking with cache discounts) through OpenRouter's Batch API or its `:batch` model
  variants (`anthropic/claude-sonnet-5.5:batch` is $1/$5), and can take up to 24h — an
  expiry, not an SLA. Generate the first quiz synchronously so the student can start right
  after upload; batch the rest. **Deferred for the week-7 prototype** — everything generates
  synchronously until the end-to-end loop works.
- **Set effort per route.** Both models run adaptive thinking by default, billed as output
  tokens. Set `output_config.effort` deliberately for each route instead of inheriting the
  default (`high` on Sonnet 5.5, `medium` on Haiku 5.5). Sonnet 5.5 rejects
  `thinking: {type: "disabled"}` with a 400; lower effort instead, or send
  `{type: "between_tools"}`, its lowest setting.
- **No sampling params or prefill.** `temperature` / `top_p` / `top_k` and assistant-turn
  prefill return 400.
- **Downscale images before sending.** A 1920×1080 slide costs ~2,691 visual tokens
  (~$0.0054 on Sonnet 5.5). Don't send 4K renders — cap the long edge at 1920 unless label
  text is too small to read.
- **Structured outputs for JSON.** Pass the schema via `output_config.format` (both models)
  and validate the response with the matching Zod schema. No prompt-only JSON, no fence
  stripping.
- **Log every request** into `llm_requests` (model, input / output / cache read / cache
  write tokens, batch flag, stop reason, and the cost OpenRouter reports in `usage.cost`),
  refused and cut-off replies included; `usage_counters` holds per-period quota counts
  only. OpenRouter's 5.5% credit fee sits outside per-request cost, so add it when reporting
  spend. Cost visibility is a project requirement, not an optimization.

Image token cost = `ceil(w/28) × ceil(h/28)` visual tokens. Sonnet 5.5 and Haiku 5.5 are on
the high-resolution tier (Claude 4.7+): long edge 2576px, max 4784 visual tokens.

---

## Credits, plans and guests

Decided 2026-10-26 (`docs/credits-plan.md`), replacing a free/paid split by question type:
every question type is open to everyone, and AI work costs credits.

- **1 credit = 1 page** (a slide or a PDF page) that ends up with questions. Pages that get
  none, like a title slide, are free.
- **Free credits: 100, once, never refilled.** A guest gets 25 and signing up adds 75;
  signing up directly gives 100. An account's come from triggers on `auth.users`. A guest's
  25 come from web's guest start once Turnstile passes (`grant_guest_credits`), so an
  anonymous user made straight through Supabase Auth with the public key gets none.
- **Marking a written answer costs 2 credits**, spent before the model call and given back if
  marking fails. All other grading is free and makes no model call.
- **Guests** are Supabase anonymous users: one deck, and the first 3 of its questions in
  study order. The rest never leave the server until they sign up, which upgrades the same
  user, so the deck stays. Guest decks need the Turnstile keys and Supabase's anonymous
  sign-ins; without the keys they are off and the landing page asks visitors to sign up.
- **Plans and top-ups are a mockup** (`/pricing`; prices are placeholders in
  `web/lib/pricing.ts`). Checkout never takes a payment or adds credits. A demo account gets
  credits by hand: `select public.grant_credits('<user id>', 500, 'demo account');` with the
  service role.

Enforce all of it **server-side**. The ledger functions (`hold_credits`, `release_credits`,
`spend_marking`, `refund_marking`) take a per-user lock. Generation holds credits before any
model call, and plans only the pages they cover. The study page never sends a guest's locked
questions, and grading refuses them. Monthly upload limits (`usage_counters`) and the daily
model budget (`DAILY_BUDGET_USD`) still apply on top.

---

## Commands

```bash
# web
cd web && npm run dev            # localhost:3000, against the Supabase in web/.env.local
npm run build
npm run lint
npm run typecheck
npx vitest run
# .claude/launch.json's "web-local" runs it against the local Supabase stack on :3005

# ingest: the worker needs LibreOffice and Tesseract, so it runs in its image
docker build -t ingest:dev ingest/
docker run -d --name ingest --restart unless-stopped --stop-timeout 120 \
  --env-file ingest/.env ingest:dev   # drains blank, then extract; stop with docker stop
docker logs -f ingest
cd ingest && pytest
ruff check .

# db
supabase start
supabase db reset               # re-runs migrations + seed
supabase migration new <name>
```

---

## Conventions

- TypeScript strict mode on. No `any` — use `unknown` and narrow.
- Server Actions for mutations; route handlers only for webhooks and the ingest callback.
- Zod schemas for every API boundary, including Claude JSON responses.
- Python: type hints everywhere, `ruff` for lint/format, Pydantic models for payloads.
- Keep the LLM prompt templates in `web/lib/prompts/` as separate files, one per model route
  (`image-check.ts`, `diagram-labels.ts`, `text-questions.ts`; routes in `web/lib/llm/routes.ts`). Don't inline
  prompt strings in business logic.
- Every new table gets an RLS policy in the same migration that creates it.
- Errors from `ingest` must be user-legible — "Couldn't read page 4, it looks like a scan"
  beats a stack trace.
- **A graded question's id must never contain its own answer.** The id travels in the URL, so
  `/questions/blank-cerebrum` hands the answer to anyone reading the address bar. Name ids after
  the prompt instead (`blank-hemisphere-lobes`). MCQ is exempt: every option is on screen by
  design, and which one is correct lives in `answerIndex`, which never leaves the server.
- Anything crossing into a client component goes through a projection that drops the answer key
  (`toPublic` in `web/lib/questions.ts`). Client components import question types with
  `import type` only — a value import would bundle the whole question file, answers included.
- Every question links back to a full render of its source slide, viewable inline and
  downloadable once the question is answered: one slide answers several questions, so showing
  it first gives answers away. This is the visible half of the `source_ref` trust feature.
- Every screen works at phone width (375px) and on touch. Study screens are designed
  phone-first; upload can be laptop-first but must still work on a phone. No hover-only UI.
  Drag-and-drop uses pointer events (e.g. dnd-kit) with a tap-to-place fallback — native
  HTML5 drag-and-drop is unreliable on touch screens. That rule is for moving things inside
  the page; a file dropped from the computer (the upload box) can only arrive as an HTML5 drop
  event, and the file picker is the touch path.

---

## Gotchas

- **`python-pptx` cannot render slides.** It reads XML only. Rendering requires LibreOffice
  headless (`soffice --headless --convert-to pdf`), then PyMuPDF renders the PDF pages to
  PNG. LibreOffice is a heavyweight container dependency — budget for it early, don't
  discover it in week 8.
- **EMU units.** PPTX positions are in English Metric Units, 914400 per inch. Convert to
  normalized coordinates immediately at extraction.
- **Grouped shapes.** Diagram labels are frequently inside a group shape. Recurse.
- **LibreOffice rendering drifts slightly from PowerPoint.** Label bboxes computed from XML
  can be a few pixels off in the render. Pad blanking rectangles slightly.
- **Don't trust a single "is this scanned?" check.** Some PDFs have a partial text layer.
  Check per page, not per document.
- **Supabase Storage signed URLs expire.** Fetch fresh in `ingest`; don't persist URLs.
- **Stripe webhooks must be idempotent.** Insert `event.id` into `stripe_events` in the same
  transaction as the subscription write (a Postgres function called via `rpc`); a conflict
  means already processed — return 200 and skip.
- **PyMuPDF is AGPL-3.0** (dual-licensed with a commercial Artifex license). Artifex's
  position is that closed-source commercial use needs the commercial license; the
  alternative is publishing `ingest/` under AGPL. Permissive swap if needed: `pdfplumber`
  (MIT — spans, bboxes, images) + `pypdfium2` (Apache-2.0/BSD — rendering). Decide before
  public launch.

---

## Build order (12 weeks)

1. **W1–2** — scaffold, auth, upload → Supabase Storage, text extraction for all three formats
2. **W3–4** — MCQ + flashcard generation from text. First demoable loop.
3. **W5–7** — **diagram fill-in-blank + table reconstruction.** The hero feature. Protect this time.
4. **W8–9** — spaced repetition, weak-topic resurfacing, multi-unit dashboard
5. **W10–11** — freemium gating, Stripe, polish, end-to-end testing
6. **W12** — report, docs, presentation

If weeks 1–2 slip, cut scope from weeks 8–9, not from weeks 5–7.

**Re-planned at week 7 (2026-09-12).** Weeks 1–6 produced docs only. The remaining weeks run
hero-feature-first, and the week-7 prototype is **PPTX-only** — DOCX tables, PDF diagrams, Tier 2
OCR, and text MCQ/flashcards move to weeks 8–9. See the schedule in `SESSION.md`.

---

## Naming

**Decided 2026-09-18: the product is `FigureQuiz`.** It was the only candidate of roughly
eighty checked that returned no product or trademark collision.

**Domain, decided 2026-10-26: `figurequiz.online`**, bought by the user through Cloudflare
Registrar, so DNS lives on Cloudflare. It is $4.99 for the first year and $27.70 a year after,
against $10.46 every year for `figurequiz.com` (also unregistered on that date), so `.online` is
only cheaper for a one-year school project: turn auto-renew off unless keeping it, and revisit
`.com` before any commercial launch. Some school web filters distrust newer endings — test the
site on the school network before a demo there.

Rejected, with reasons worth keeping so they are not re-proposed:

- `StudyMate` — Respondus's StudyMate Campus, plus App Store and Play Store apps.
- `BlankSlide` — an existing Google Workspace doc-to-slide add-on.
- `LabelRecall` — the phrase returns food-product-recall software in search, and `Recall`
  is already crowded in study apps (Recall, Recall Labs, FlashRecall).
- `BlankFigure` — free, but `BlankStudy` is an existing AI fill-in-the-blank study app.
- `CramVision`, `DiagramIQ`, `LabelIt` — all registered.

Known weakness of the chosen name: it is descriptive, so it is weak as a trademark and
reads more like a feature than a brand. Acceptable for the capstone; revisit before any
serious commercial launch.

The development repo is the private `MRndy1/ai-study-platform`. The public copy,
`MRndy1/figurequiz`, gets a cleaned snapshot from `scripts/export-public.py` and never this
repo's history: see `SESSION.md`, *Public repository*.
