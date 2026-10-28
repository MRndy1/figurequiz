import { pageName } from "@/lib/contracts";

/*
 * Numbers as the pages show them. No server-only imports, so client components can use these.
 */

/** `12` → `"12 slides"` for a deck, `"12 pages"` for a PDF. */
export function pageCount(count: number, mime: string): string {
  const name = pageName(mime);
  return `${count} ${count === 1 ? name : `${name}s`}`;
}

/** `1258291` → `"1.2 MB"`, in the binary megabytes the upload limit is set in. */
export function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
