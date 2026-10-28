"use client";

import { useState } from "react";

import { button } from "@/components/ui";

type Props = {
  sourceRef: string;
  /** Null until the question is answered: the slide shows the answer. */
  slideImage: string | null;
};

/**
 * Every question links back to the slide it came from — CLAUDE.md calls this a trust feature.
 * The slide unlocks once the question is answered, because it shows the answer: until then only
 * a locked note shows, and no image is sent at all. Collapsed by default so it never competes
 * with the question, and downloadable so the student can keep the slide next to their notes.
 */
export function SourceSlide({ sourceRef, slideImage }: Props) {
  const [open, setOpen] = useState(false);

  if (!slideImage) {
    return (
      <div className="mt-7 flex items-center gap-3 rounded-xl border-[1.5px] border-dashed border-dash bg-panel px-4 py-3">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0 text-ink-muted"
        >
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        <p className="m-0 text-sm text-ink-muted">
          <span className="font-semibold text-ink">{sourceRef}</span> · the source slide opens once
          you&apos;ve answered
        </p>
      </div>
    );
  }

  return (
    <div className="mt-7 animate-rise rounded-xl border-[1.5px] border-ink bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm font-semibold">From {sourceRef}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className={button("line", "sm")}
          >
            {open ? "Hide the slide" : "View the slide"}
          </button>
          <a href={slideImage} download className={button("line", "sm")}>
            Download
          </a>
        </div>
      </div>

      {open && (
        <div className="mt-3 overflow-hidden rounded-lg border-[1.5px] border-ink">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL, no loader */}
          <img
            src={slideImage}
            alt={`Source slide: ${sourceRef}`}
            className="block h-auto w-full animate-unblur"
          />
        </div>
      )}
    </div>
  );
}
