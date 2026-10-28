/**
 * Grading for diagram fill-in-the-blank answers.
 *
 * The rule order matters and comes from CLAUDE.md: normalize, accept an exact match against
 * the answer or a stored synonym, then *reject* anything matching a stored confusable or
 * another blank's answer in the same diagram, and only then allow a fuzzy match for typos.
 *
 * Fuzzy matching alone would accept domain opposites — afferent/efferent scores 0.875 and
 * hyperthyroidism/hypothyroidism 0.867, both above the 0.85 threshold — which is exactly the
 * mistake a student needs marked wrong. Synonyms and confusables are generated once when the
 * question is created and stored, so grading is instant and costs nothing.
 */

export const FUZZY_THRESHOLD = 0.85;

export type BlankKey = {
  number: number;
  answer: string;
  synonyms?: string[];
  confusables?: string[];
};

export type MatchKind = "exact" | "synonym" | "fuzzy";

export type BlankResult = {
  number: number;
  response: string;
  correct: boolean;
  expected: string;
  /** How it matched, or why it didn't. */
  matched: MatchKind | null;
  rejectedAs?: "confusable" | "other-blank" | "empty";
};

const LEADING_ARTICLE = /^(?:the|a|an)\s+/;

/** Lowercase, drop punctuation and symbols, collapse spaces, drop a leading article. */
export function normalize(value: string): string {
  const cleaned = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.replace(LEADING_ARTICLE, "").trim();
}

/** Levenshtein edit distance, iterative with a single row of state. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length];
}

/** 1 − distance / longest, so 1 is identical and 0 shares nothing. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - editDistance(a, b) / longest;
}

export function gradeBlank(
  response: string,
  key: BlankKey,
  otherBlanks: BlankKey[] = [],
): BlankResult {
  const base = {
    number: key.number,
    response,
    expected: key.answer,
  };

  const given = normalize(response);
  if (!given) {
    return { ...base, correct: false, matched: null, rejectedAs: "empty" };
  }

  const answer = normalize(key.answer);
  if (given === answer) {
    return { ...base, correct: true, matched: "exact" };
  }

  const synonyms = (key.synonyms ?? []).map(normalize).filter(Boolean);
  if (synonyms.includes(given)) {
    return { ...base, correct: true, matched: "synonym" };
  }

  // Before any fuzzy allowance: a near-miss that is a known opposite, or the answer to a
  // different blank on the same diagram, is a real mistake.
  const confusables = (key.confusables ?? []).map(normalize).filter(Boolean);
  if (confusables.includes(given)) {
    return { ...base, correct: false, matched: null, rejectedAs: "confusable" };
  }

  const otherAnswers = otherBlanks
    .filter((other) => other.number !== key.number)
    .flatMap((other) => [other.answer, ...(other.synonyms ?? [])])
    .map(normalize)
    .filter(Boolean);
  if (otherAnswers.includes(given)) {
    return { ...base, correct: false, matched: null, rejectedAs: "other-blank" };
  }

  // Typos only.
  const best = [answer, ...synonyms].reduce(
    (highest, candidate) => Math.max(highest, similarity(given, candidate)),
    0,
  );
  if (best >= FUZZY_THRESHOLD) {
    return { ...base, correct: true, matched: "fuzzy" };
  }

  return { ...base, correct: false, matched: null };
}

/** Grade every blank of one diagram or table question. Missing responses count as empty. */
export function gradeBlanks(
  responses: Record<number, string>,
  keys: BlankKey[],
): BlankResult[] {
  return keys.map((key) => gradeBlank(responses[key.number] ?? "", key, keys));
}
