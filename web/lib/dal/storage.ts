import "server-only";

import { RENDERS_BUCKET } from "@/lib/contracts";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Signed URLs for images in the private `renders` bucket.
 *
 * The bucket has no storage policies, so a browser sees an image only through a URL signed here
 * with the secret key. Every object key starts with its owner's user id (lib/contracts.ts), and
 * nothing is signed for anyone else, whichever row the key was read from.
 */

/** The blanked image a diagram question is asked with: valid for a long study session. */
export const QUESTION_IMAGE_TTL_SECONDS = 2 * 60 * 60;

/** What answering unlocks, the unblanked diagram and the source slide: signed after the attempt. */
export const UNLOCKED_IMAGE_TTL_SECONDS = 10 * 60;

function assertOwnKey(userId: string, path: string) {
  if (!path.startsWith(`${userId}/`)) {
    throw new Error(`Refusing to sign ${path}: it does not belong to user ${userId}`);
  }
}

/**
 * Signs several of the user's images at once. An object that can't be signed (it is missing,
 * say) has no entry in the result, so the caller decides what to do without it.
 */
export async function signRenders(
  userId: string,
  paths: string[],
  expiresIn: number,
): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  for (const path of paths) assertOwnKey(userId, path);

  const { data, error } = await createAdminClient()
    .storage.from(RENDERS_BUCKET)
    .createSignedUrls(paths, expiresIn);
  if (error) throw error;

  const urls = new Map<string, string>();
  for (const item of data) {
    if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  return urls;
}

/**
 * Signs one of the user's images. With `download`, the URL also answers with
 * `Content-Disposition: attachment` under that file name: an `<img>` still shows it, and a link to
 * it downloads instead of leaving the page, which a cross-origin `<a download>` can't do alone.
 */
export async function signRender(
  userId: string,
  path: string,
  expiresIn: number,
  download?: string,
): Promise<string> {
  assertOwnKey(userId, path);

  const { data, error } = await createAdminClient()
    .storage.from(RENDERS_BUCKET)
    .createSignedUrl(path, expiresIn, download ? { download } : undefined);
  if (error) throw error;
  return data.signedUrl;
}
