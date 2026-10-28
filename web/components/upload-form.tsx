"use client";

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type DragEvent } from "react";

import { createUpload, finalizeUpload } from "@/app/(product)/documents/actions";
import { button } from "@/components/ui";
import { MAX_UPLOAD_BYTES, UPLOAD_TYPES, UPLOADS_BUCKET } from "@/lib/contracts";
import { createClient } from "@/lib/supabase/client";

/** For the file chooser: by extension, and by type for systems that filter on that. */
const ACCEPT = UPLOAD_TYPES.flatMap((type) => [`.${type.extension}`, type.mime]).join(",");

type Phase = "idle" | "checking" | "uploading" | "queueing" | "opening";

const PROGRESS: Record<Exclude<Phase, "idle">, string> = {
  checking: "Checking the file…",
  uploading: "Uploading…",
  queueing: "Queuing it for processing…",
  opening: "Uploaded. Opening it…",
};

/**
 * Takes a deck dropped on the box or picked with the file chooser and runs the three upload
 * steps (see documents/actions.ts) straight away. The server checks the file before anything
 * is sent, so its messages are the only validation here.
 */
export function UploadForm({
  heading = "Upload a PowerPoint deck or a PDF",
  prepare,
}: {
  heading?: string;
  /**
   * Runs before anything is sent, e.g. to start a guest's session: returns a problem to show,
   * or null to go ahead.
   */
  prepare?: () => Promise<string | null>;
} = {}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const busy = phase !== "idle";

  async function upload(file: File): Promise<string | null> {
    const ticket = await createUpload({ filename: file.name, size: file.size });
    if (!ticket.ok) return ticket.error;

    setPhase("uploading");
    // The bucket accepts only the .pptx and PDF types, and a File is sent with whatever type
    // the browser guessed, which is empty on some systems. So it goes as the type the server
    // took it for. Re-typing it copies nothing.
    const body = new File([file], file.name, { type: ticket.mime });
    const sent = await createClient()
      .storage.from(UPLOADS_BUCKET)
      .uploadToSignedUrl(ticket.path, ticket.token, body);
    if (sent.error) {
      console.error("Upload to Storage failed", sent.error);
      return "The upload didn't go through. Check your connection and try again.";
    }

    setPhase("queueing");
    const queued = await finalizeUpload(ticket.documentId);
    if (!queued.ok) return queued.error;

    setPhase("opening");
    router.push(`/documents/${ticket.documentId}`);
    return null;
  }

  async function start(file: File) {
    setError(null);
    setPhase("checking");
    let problem: string | null;
    try {
      problem = (await prepare?.()) ?? (await upload(file));
    } catch (thrown) {
      console.error("Upload failed", thrown);
      problem = "Something went wrong. Try again in a minute.";
    }
    if (problem) {
      setError(problem);
      setPhase("idle");
    }
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.item(0);
    // Cleared so that picking the same file again, after an error, still counts as a change.
    event.currentTarget.value = "";
    if (file) void start(file);
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    // Text or a link dragged from the page is not a file: leave it to the browser.
    if (!event.dataTransfer.types.includes("Files")) return;
    // Taken even while busy, so a second deck dropped mid-upload is ignored rather than
    // opened by the browser.
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!busy) setDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>) {
    // Moving onto the text inside the box fires a leave too; only leaving the box counts.
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const { files } = event.dataTransfer;
    if (files.length > 1) {
      setError("Drop one deck at a time.");
      return;
    }
    const file = files.item(0);
    if (file) void start(file);
  }

  return (
    <div>
      <label
        htmlFor="deck"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex flex-wrap items-center justify-between gap-6 rounded-2xl border-2 border-dashed border-ink p-6 transition-[background-color,scale,box-shadow] duration-250 ease-spring has-focus-visible:outline-2 has-focus-visible:outline-offset-3 has-focus-visible:outline-ink sm:p-8 ${
          dragging ? "scale-[1.01] bg-marker-soft shadow-card" : "bg-white/70"
        } ${busy ? "opacity-60" : "cursor-pointer hover:bg-marker-wash"}`}
      >
        <span className="flex min-w-0 items-center gap-5">
          <span className="grid size-16 shrink-0 -rotate-[4deg] place-items-center rounded-2xl border-[1.5px] border-ink bg-marker shadow-tag">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 16V5m-5 5 5-5 5 5" />
              <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
            </svg>
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span id="deck-label" className="font-display text-xl leading-tight font-extrabold tracking-[-0.02em] sm:text-[22px]">
              {dragging ? "Drop it to upload" : heading}
            </span>
            <span id="deck-hint" className="text-[15px] text-ink-muted">
              A .pptx or .pdf file, up to {MAX_UPLOAD_BYTES / (1024 * 1024)} MB.
            </span>
          </span>
        </span>
        <span className="flex items-center gap-3.5">
          <span aria-hidden="true" className="hidden font-hand text-2xl font-semibold sm:inline">
            drag it here, or
          </span>
          {/* Looks like a button; the label around it is what opens the file chooser. */}
          <span className={button("ink")}>Choose a file</span>
        </span>
        <input
          id="deck"
          type="file"
          disabled={busy}
          accept={ACCEPT}
          aria-labelledby="deck-label"
          aria-describedby="deck-hint"
          onChange={handleChange}
          className="sr-only"
        />
      </label>

      <p aria-live="polite" className="mt-3 mb-0 text-sm font-semibold">
        {phase === "idle" ? null : PROGRESS[phase]}
      </p>

      {error && (
        <p role="alert" className="mt-3 mb-0 text-sm font-semibold text-coral-ink">
          {error}
        </p>
      )}
    </div>
  );
}
