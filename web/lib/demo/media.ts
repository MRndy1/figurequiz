/**
 * The demo's images that show answers: each diagram before its labels were blanked, and the slides
 * the questions came from.
 *
 * They live in data/demo/, outside public/, so no guessable URL serves them. A static import gives
 * each one a content-hashed URL under /_next/static/media, and the only code that hands that URL
 * to the browser is the grading actions in app/demo/actions.ts, after the student has answered.
 * Import this module from server code only; `server-only` fails the build if a client imports it.
 */

import "server-only";

import type { StaticImageData } from "next/image";

import brainLobesOriginal from "@/data/demo/brain-lobes-original.png";
import slide1 from "@/data/demo/slides/slide-1.png";
import slide2 from "@/data/demo/slides/slide-2.png";
import slide3 from "@/data/demo/slides/slide-3.png";
import slide4 from "@/data/demo/slides/slide-4.png";
import { originalImage, type DiagramQuestion, type Question } from "@/lib/questions";

/** Keyed by `originalImage()`. */
const ORIGINALS: Record<string, StaticImageData | undefined> = {
  "brain-lobes-original.png": brainLobesOriginal,
};

/** Keyed by 1-based slide number. */
const SLIDES: Record<number, StaticImageData | undefined> = {
  1: slide1,
  2: slide2,
  3: slide3,
  4: slide4,
};

/** The diagram with every label showing, revealed once its blanks are graded. */
export function revealImage(question: DiagramQuestion): string {
  const image = ORIGINALS[originalImage(question)];
  if (!image) throw new Error(`No un-blanked image imported for question ${question.id}`);
  return image.src;
}

/** The full render of the slide a question came from, unlocked once it is answered. */
export function slideImage(question: Question): string {
  const image = SLIDES[question.sourceSlide];
  if (!image) throw new Error(`No render imported for slide ${question.sourceSlide}`);
  return image.src;
}
