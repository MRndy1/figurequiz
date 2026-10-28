import type { Metadata } from "next";

import {
  gradeDiagramAnswers,
  gradeMcqChoice,
  gradeShortAnswerResponse,
  gradeTableAnswers,
  rateFlashcard,
} from "@/app/demo/actions";
import { StudySession } from "@/components/study-session";
import { studyQuestions, toPublic } from "@/lib/questions";

export const metadata: Metadata = { title: "Study the demo deck" };

export default function DemoStudyPage() {
  // toPublic drops every answer key, and every image that shows one, before the data crosses
  // into the client component.
  const questions = studyQuestions().map(toPublic);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <StudySession
        questions={questions}
        actions={{ gradeDiagramAnswers, gradeMcqChoice, gradeShortAnswerResponse, gradeTableAnswers, rateFlashcard }}
        backHref="/demo"
        backLabel="Demo deck"
      />
    </main>
  );
}
