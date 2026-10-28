import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  gradeDiagramAnswers,
  gradeMcqChoice,
  gradeShortAnswerResponse,
  gradeTableAnswers,
  rateFlashcard,
} from "@/app/demo/actions";
import { QuestionCard } from "@/components/question-card";
import { Card } from "@/components/ui";
import { getQuestion, toPublic } from "@/lib/questions";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: getQuestion(id)?.title };
}

/** A single question on its own page, for deep links. The continuous run lives at /demo/study. */
export default async function DemoQuestionPage({ params }: Props) {
  const { id } = await params;
  const question = getQuestion(id);
  if (!question) notFound();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <Link href="/demo" className="inline-flex min-h-11 items-center font-semibold text-ink">
        ← All questions
      </Link>
      <Card className="mt-4 p-[clamp(18px,3vw,30px)]">
        <QuestionCard
          question={toPublic(question)}
          actions={{ gradeDiagramAnswers, gradeMcqChoice, gradeShortAnswerResponse, gradeTableAnswers, rateFlashcard }}
        />
      </Card>
    </main>
  );
}
