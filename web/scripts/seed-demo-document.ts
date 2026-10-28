/**
 * Seeds the demo deck into an account, so the product can be shown with no worker and no model.
 *
 * Run from web/, for a user who has already signed up on that stack (no password is involved):
 *
 *   node --env-file=.env.development.local scripts/seed-demo-document.ts --email you@example.com
 *
 * `--env-file=.env.local` targets whichever project that file names instead; the script prints the
 * URL before writing anything. With the secret key it writes what the worker and generation would
 * have written for the sample deck:
 *   - the slide renders and the diagram's unblanked and blanked images, into `renders` under the
 *     object keys in lib/contracts.ts and contracts/examples.json;
 *   - a `ready` document, its labelled-diagram asset, and the demo's questions with their keys,
 *     each checked with `CreateQuestionArgs` as generation's are. The locked essay is left out:
 *     Postgres has no essay type yet.
 *
 * Ids are derived from the user's id, so a second run replaces that account's demo deck, attempts
 * included, and touches nothing else. Usage counters are left alone: a seeded deck isn't an upload.
 *
 * Node runs this file as it is, stripping the types; its one warning, that package.json names no
 * module "type", is harmless. The hook below only adds tsconfig's `@/` alias, so the script reads
 * the app's own contracts and demo data instead of copies.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";

import type { Question } from "@/lib/questions";
import type { Database } from "@/lib/supabase/database.types";

const WEB = fileURLToPath(new URL("..", import.meta.url));

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const file = ["", ".ts", ".tsx"]
      .map((extension) => WEB + specifier.slice(2) + extension)
      .find((candidate) => statSync(candidate, { throwIfNoEntry: false })?.isFile());
    if (!file) return nextResolve(specifier, context);
    const url = pathToFileURL(file).href;
    return file.endsWith(".json")
      ? { url, shortCircuit: true, importAttributes: { ...context.importAttributes, type: "json" } }
      : { url, shortCircuit: true, format: "module-typescript" };
  },
});

// Imported only now, so the hook above resolves their `@/` imports.
const { CreateQuestionArgs, LabeledDiagramPayload, objectKeys, PPTX_MIME, RENDERS_BUCKET } =
  await import("@/lib/contracts");
const { supabaseEnv, supabaseSecretKey } = await import("@/lib/env");
const { originalImage, questions: demoQuestions } = await import("@/lib/questions");

const { values: flags } = parseArgs({ options: { email: { type: "string" } } });
if (!flags.email) {
  console.error("Usage: node --env-file=<env file> scripts/seed-demo-document.ts --email <address>");
  process.exit(1);
}
const email = flags.email;

/** The deck the demo questions were written from. The file isn't uploaded: nothing reads a ready document's. */
const DECK = { filename: "Brain_Anatomy_Sample.pptx", sizeBytes: 180_276 };
/** Created only when the account has no unit yet. */
const UNIT_NAME = "My unit";
/** RFC 9562 name-based ids (v5) under this namespace, so a re-run lands on the same rows and objects. */
const SEED_NAMESPACE = "5d8f7a63-1c2e-4b9a-8e47-0f3b6c1d2a95";
const DEMO_DIR = `${WEB}data/demo/`;

function seedId(name: string): string {
  const hash = createHash("sha1")
    .update(Buffer.from(SEED_NAMESPACE.replaceAll("-", ""), "hex"))
    .update(name)
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex", 0, 16);
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

/** Width and height from a PNG's header. */
function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** A demo question in the shape generation hands to `create_question`, less the shared fields. */
function questionFields(demo: Exclude<Question, { type: "essay" }>, assetId: string) {
  switch (demo.type) {
    case "diagram":
      return {
        type: "diagram_blank",
        asset_id: assetId,
        payload: { prompt: demo.prompt, numbers: demo.blanks.map((blank) => blank.number) },
        answer_key: {
          // The asset's labels are these blanks, in this order.
          blanks: demo.blanks.map((blank, labelIndex) => ({
            number: blank.number,
            label_index: labelIndex,
            answer: blank.answer,
            synonyms: blank.synonyms ?? [],
            confusables: blank.confusables ?? [],
          })),
        },
      };
    case "mcq":
      return {
        type: "mcq",
        payload: { prompt: demo.prompt, options: demo.options },
        answer_key: { answer_index: demo.answerIndex },
      };
    case "short_answer":
      return {
        type: "short_answer",
        payload: { prompt: demo.prompt },
        answer_key: {
          answer: demo.answer,
          synonyms: demo.synonyms ?? [],
          confusables: demo.confusables ?? [],
        },
      };
    case "flashcard":
      return { type: "flashcard", payload: { front: demo.front, back: demo.back } };
  }
}

const url = supabaseEnv().url;
const supabase = createClient<Database>(url, supabaseSecretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserId(): Promise<string> {
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (user) return user.id;
    if (data.users.length < perPage) throw new Error(`No account for ${email} on ${url}: sign up first`);
  }
}

async function unitFor(userId: string): Promise<string> {
  const { data: existing, error } = await supabase
    .from("units")
    .select("id")
    .eq("user_id", userId)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (existing) return existing.id;

  const { data: created, error: insertError } = await supabase
    .from("units")
    .insert({ user_id: userId, name: UNIT_NAME })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return created.id;
}

async function upload(path: string, file: string) {
  const { error } = await supabase.storage
    .from(RENDERS_BUCKET)
    .upload(path, readFileSync(file), { contentType: "image/png", upsert: true });
  if (error) throw new Error(`Uploading ${file} to ${path}: ${error.message}`);
}

console.log(`Seeding the demo deck on ${url} for ${email}`);

const userId = await findUserId();
const documentId = seedId(`document/${userId}`);
const unitId = await unitFor(userId);

// Replace an earlier seed: the cascade takes its asset, questions, keys and attempts with it.
const { error: deleteError } = await supabase
  .from("documents")
  .delete()
  .eq("id", documentId)
  .eq("user_id", userId);
if (deleteError) throw deleteError;

const pages = readdirSync(`${DEMO_DIR}slides`)
  .map((name) => Number(/^slide-(\d+)\.png$/.exec(name)?.[1]))
  .filter((page) => page > 0)
  .sort((a, b) => a - b);
for (const page of pages) {
  await upload(objectKeys.pageRender(userId, documentId, page), `${DEMO_DIR}slides/slide-${page}.png`);
}

type Insert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
const assets: Insert<"assets">[] = [];
const questions: Insert<"questions">[] = [];
const keys: Insert<"question_keys">[] = [];
const skipped: string[] = [];
const createdAt = Date.now();

for (const [index, demo] of demoQuestions.entries()) {
  if (demo.type === "essay") {
    skipped.push(demo.id);
    continue;
  }
  const questionId = seedId(`question/${documentId}/${demo.id}`);
  const assetId = seedId(`asset/${documentId}/${demo.id}`);
  const args = CreateQuestionArgs.parse({
    document_id: documentId,
    title: demo.title,
    source_page: demo.sourceSlide,
    ...questionFields(demo, assetId),
  });

  let imagePath: string | null = null;
  if (demo.type === "diagram") {
    // What extraction stores, and the blanked copy the blank job would draw from it. The blanks'
    // boxes are already fractions of the crop.
    const crop = `${DEMO_DIR}${originalImage(demo)}`;
    const assetPath = `${userId}/${documentId}/assets/${assetId}.png`;
    imagePath = `${userId}/${documentId}/questions/${questionId}.png`;
    await upload(assetPath, crop);
    await upload(imagePath, `${WEB}public/demo/${demo.image}`);

    const { width, height } = pngSize(readFileSync(crop));
    assets.push({
      id: assetId,
      user_id: userId,
      document_id: documentId,
      page: demo.sourceSlide,
      kind: "labeled_diagram",
      // Slide 3's labels are baked into the picture's pixels.
      tier: 2,
      payload: LabeledDiagramPayload.parse({
        labels: demo.blanks.map((blank) => ({ text: blank.answer, ...blank.box })),
        image_width: width,
        image_height: height,
      }),
      image_path: assetPath,
    });
  }

  questions.push({
    id: questionId,
    user_id: userId,
    document_id: documentId,
    asset_id: "asset_id" in args ? (args.asset_id ?? null) : null,
    type: args.type,
    status: "ready",
    title: args.title,
    payload: args.payload,
    image_path: imagePath,
    // As `create_question` derives it.
    source_ref: `${DECK.filename}, slide ${args.source_page}`,
    source_page: args.source_page,
    // A millisecond apart, so the deck keeps the demo's order wherever type and slide tie.
    created_at: new Date(createdAt + index).toISOString(),
  });
  if (args.type !== "flashcard") keys.push({ question_id: questionId, answer_key: args.answer_key });
}

const { error: documentError } = await supabase.from("documents").insert({
  id: documentId,
  user_id: userId,
  unit_id: unitId,
  filename: DECK.filename,
  mime: PPTX_MIME,
  storage_path: objectKeys.upload(userId, documentId, PPTX_MIME),
  size_bytes: DECK.sizeBytes,
  status: "ready",
  page_count: pages.length,
});
if (documentError) throw documentError;

try {
  for (const insert of [
    () => supabase.from("assets").insert(assets),
    () => supabase.from("questions").insert(questions),
    () => supabase.from("question_keys").insert(keys),
  ]) {
    const { error } = await insert();
    if (error) throw error;
  }
} catch (error) {
  // Leave no half-seeded deck behind.
  await supabase.from("documents").delete().eq("id", documentId);
  throw error;
}

console.log(
  `Seeded ${questions.length} questions (${keys.length} with answer keys) from ${pages.length} slides` +
    (skipped.length ? `, leaving out ${skipped.join(", ")} (no essay type in Postgres yet)` : "") +
    `.\nStudy them at /documents/${documentId}/study`,
);
