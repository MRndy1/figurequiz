"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

import { startGuest } from "@/app/guest/actions";
import { UploadForm } from "@/components/upload-form";

type TurnstileOptions = {
  sitekey: string;
  appearance: "always" | "execute" | "interaction-only";
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
};

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: TurnstileOptions) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

/** How long a drop waits for Turnstile's answer, which is usually there before it. */
const TOKEN_WAIT_MS = 10_000;

/**
 * The landing page's drop zone, open to anyone. Cloudflare Turnstile checks the visitor is human
 * in the background (it only shows itself when it needs a click); the drop then starts a guest
 * session with that answer, unless one is open already, and uploads as usual.
 */
export function GuestDropZone({ siteKey }: { siteKey: string }) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const token = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);

  useEffect(() => {
    const turnstile = window.turnstile;
    if (!scriptReady || !turnstile || !container.current || widget.current) return;
    widget.current = turnstile.render(container.current, {
      sitekey: siteKey,
      appearance: "interaction-only",
      callback: (value) => {
        token.current = value;
      },
      "expired-callback": () => {
        token.current = null;
      },
      "error-callback": () => {
        token.current = null;
      },
    });
    return () => {
      if (widget.current) turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [scriptReady, siteKey]);

  const prepare = useCallback(async () => {
    for (let waited = 0; !token.current && waited < TOKEN_WAIT_MS; waited += 250) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const result = await startGuest(token.current);
    // A Turnstile answer works once: ask for a fresh one in case this drop fails.
    token.current = null;
    if (widget.current) window.turnstile?.reset(widget.current);
    return result.ok ? null : result.error;
  }, []);

  return (
    <div>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        onReady={() => setScriptReady(true)}
      />
      <UploadForm heading="Make a quiz from your slides" prepare={prepare} />
      <div ref={container} className="mt-3 empty:hidden" />
    </div>
  );
}
