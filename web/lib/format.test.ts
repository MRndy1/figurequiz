import { describe, expect, it } from "vitest";

import { MAX_UPLOAD_BYTES, PDF_MIME, PPTX_MIME } from "@/lib/contracts";
import { megabytes, pageCount } from "@/lib/format";

describe("pageCount", () => {
  it("counts a deck's slides and a PDF's pages", () => {
    expect(pageCount(1, PPTX_MIME)).toBe("1 slide");
    expect(pageCount(12, PPTX_MIME)).toBe("12 slides");
    expect(pageCount(1, PDF_MIME)).toBe("1 page");
    expect(pageCount(40, PDF_MIME)).toBe("40 pages");
  });
});

describe("megabytes", () => {
  it("keeps one decimal below 10 MB", () => {
    expect(megabytes(180_276)).toBe("0.2 MB");
    expect(megabytes(5.25 * 1024 * 1024)).toBe("5.3 MB");
    expect(megabytes(MAX_UPLOAD_BYTES)).toBe("50 MB");
  });
});
