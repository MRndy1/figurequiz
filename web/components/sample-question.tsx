"use client";

import { DiagramQuestion } from "@/components/diagram-question";
import type { DiagramOutcome } from "@/lib/grade-types";
import type { PublicQuestion } from "@/lib/public-question";

type Props = {
  question: Extract<PublicQuestion, { type: "diagram" }>;
  /** The demo's grading action: graded on the server, nothing saved. */
  grade: (questionId: string, responses: Record<string, string>) => Promise<DiagramOutcome | null>;
};

/** The landing page's live sample: the demo deck's diagram, typed onto and graded for real. */
export function SampleQuestion({ question, grade }: Props) {
  return (
    <DiagramQuestion
      question={question}
      check={(responses) => grade(question.id, responses).catch(() => null)}
    />
  );
}
