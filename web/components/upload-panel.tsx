import Link from "next/link";
import type { ReactNode } from "react";

import { UploadForm } from "@/components/upload-form";
import type { UploadQuota } from "@/lib/dal/documents";

/** The drop zone; or, when there are no credits or uploads left, why not and what comes next. */
export function UploadPanel({ quota, credits }: { quota: UploadQuota; credits: number }) {
  if (credits < 1) {
    return (
      <Notice title="You're out of credits">
        Each page that gets questions takes one credit.{" "}
        <Link href="/pricing" className="link-marker font-semibold text-ink">
          Top up
        </Link>{" "}
        or{" "}
        <Link href="/credits" className="link-marker font-semibold text-ink">
          see where they went
        </Link>
        .
      </Notice>
    );
  }
  if (quota.left > 0) return <UploadForm />;

  return (
    <Notice title="No uploads left this month">
      You&apos;ve used all {quota.limit}. You can upload again from the first of next month.
    </Notice>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-dash bg-white/70 p-6 sm:p-8">
      <p className="m-0 font-display text-[22px] font-extrabold tracking-[-0.02em]">{title}</p>
      <p className="mt-1 mb-0 text-[15px] text-ink-muted">{children}</p>
    </div>
  );
}
