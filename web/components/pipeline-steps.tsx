import { pageName, type DocumentStatus } from "@/lib/contracts";
import { pageCount as countPages } from "@/lib/format";

/*
 * Where a deck is between upload and its first question. Server and client components both use
 * this, so it holds no state.
 */

/** The statuses a deck passes through on its own; polling stops once it leaves them. */
export const IN_PROGRESS = ["queued", "processing", "extracted", "generating"] as const;

export type InProgress = (typeof IN_PROGRESS)[number];

export function isInProgress(status: DocumentStatus): status is InProgress {
  return (IN_PROGRESS as readonly DocumentStatus[]).includes(status);
}

type Props = {
  status: InProgress;
  mime: string;
  /** Known once the pages are read. */
  pageCount: number | null;
  size?: "sm" | "md";
};

/** Uploaded, reading the pages, writing questions: done ones ticked, the current one pulsing. */
export function PipelineSteps({ status, mime, pageCount, size = "md" }: Props) {
  const pages = `${pageName(mime)}s`;
  const reading = status === "queued" || status === "processing";
  const steps: { label: string; state: StepState }[] = [
    { label: "Uploaded", state: "done" },
    reading
      ? { label: `Reading the ${pages}…`, state: "now" }
      : {
          label: pageCount === null ? `Read the ${pages}` : `Read ${countPages(pageCount, mime)}`,
          state: "done",
        },
    reading
      ? { label: "Write questions", state: "next" }
      : { label: "Writing questions…", state: "now" },
  ];

  return (
    <ol className={`m-0 flex list-none flex-col p-0 font-semibold ${size === "sm" ? "gap-2 text-[13px]" : "gap-3"}`}>
      {steps.map(({ label, state }) => (
        <li key={label} className={`flex items-center gap-2.5 ${state === "next" ? "text-ink-faint" : ""}`}>
          <StepMark state={state} className={size === "sm" ? "size-5" : "size-7"} />
          {label}
          <span className="sr-only">{STEP_STATE[state]}</span>
        </li>
      ))}
    </ol>
  );
}

export type StepState = "done" | "now" | "next";

/** What a step's mark says to a screen reader, after its label. */
export const STEP_STATE: Record<StepState, string> = { done: " (done)", now: " (in progress)", next: "" };

/** A step's mark: ticked once done, pulsing while it runs, empty until then. Sized by `className`. */
export function StepMark({ state, className }: { state: StepState; className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full border-[1.5px] ${className} ${
        state === "done" ? "border-ink bg-ink" : state === "now" ? "animate-pulse-marker border-ink bg-marker" : "border-dash bg-white"
      }`}
    >
      {state === "done" && (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="#fff"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-1/2"
        >
          <path d="M3 8.5l3.2 3L13 4.5" />
        </svg>
      )}
    </span>
  );
}
