import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { readReply, reportedCost, userContent } from "./call";

const Capital = z.strictObject({ capital: z.string() });

type Finished = Parameters<typeof readReply>[0];

function reply(text: string | null, stop_reason: Anthropic.StopReason = "end_turn"): Finished {
  return {
    stop_reason,
    stop_details: null,
    content: text === null ? [] : [{ type: "text", text, citations: null }],
  };
}

describe("readReply", () => {
  it("returns the reply checked against the schema", () => {
    expect(readReply(reply('{"capital": "Canberra"}'), Capital)).toEqual({
      ok: true,
      output: { capital: "Canberra" },
    });
  });

  it("reports a refusal with its category", () => {
    const refused: Finished = {
      ...reply(null, "refusal"),
      stop_details: { type: "refusal", category: "bio", explanation: null },
    };
    expect(readReply(refused, Capital)).toEqual({ ok: false, failure: "refusal", detail: "bio" });
  });

  it("reports a reply cut off at max_tokens, even when part of it parses", () => {
    expect(readReply(reply('{"capital": "Can', "max_tokens"), Capital)).toMatchObject({
      ok: false,
      failure: "max_tokens",
    });
  });

  it("treats anything else as invalid", () => {
    expect(readReply(reply("Canberra"), Capital)).toMatchObject({ failure: "invalid", detail: "the reply is not JSON" });
    expect(readReply(reply('{"city": "Canberra"}'), Capital)).toMatchObject({ failure: "invalid" });
    expect(readReply(reply(null), Capital)).toMatchObject({ failure: "invalid" });
    expect(readReply(reply('{"capital": "Canberra"}', "tool_use"), Capital)).toMatchObject({ failure: "invalid" });
  });
});

describe("reportedCost", () => {
  it("reads OpenRouter's dollar cost from the usage", () => {
    expect(reportedCost({ input_tokens: 299, output_tokens: 21, cost: 0.0000404 })).toBe(0.0000404);
  });

  it("is null when there is no usable cost", () => {
    expect(reportedCost({ input_tokens: 299, output_tokens: 21 })).toBeNull();
    expect(reportedCost({ cost: -1 })).toBeNull();
    expect(reportedCost(null)).toBeNull();
  });
});

describe("userContent", () => {
  it("sends the text alone, or the picture before it", () => {
    expect(userContent({ content: "Source: deck.pptx, slide 3" })).toBe("Source: deck.pptx, slide 3");
    expect(
      userContent({ content: "Source: deck.pptx, slide 3", image: { mediaType: "image/png", data: "iVBORw0KGgo=" } }),
    ).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
      { type: "text", text: "Source: deck.pptx, slide 3" },
    ]);
  });
});
