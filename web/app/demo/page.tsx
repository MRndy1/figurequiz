import type { Metadata } from "next";
import Link from "next/link";

import { questions, questionSummary, TYPE_LABEL } from "@/lib/questions";

export const metadata: Metadata = { title: "Demo" };

/** The prototype, kept as a no-login fallback: one sample deck, graded on the server. */
export default function DemoPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/" className="text-sm text-gray-600 hover:underline">
        ← FigureQuiz
      </Link>

      <p className="mt-6 text-xs font-medium uppercase tracking-wide text-gray-500">Demo deck</p>
      <h1 className="mt-1 text-2xl font-semibold text-gray-900">Anatomy of the Brain</h1>
      <p className="mt-2 text-sm text-gray-600">
        Questions generated from a lecture deck: label the diagram, answer multiple choice, fill
        in the blanks, and review the flashcards. No account needed, and nothing is saved.
      </p>

      <Link
        href="/demo/study"
        className="mt-6 inline-block rounded-md bg-gray-900 px-5 py-2.5 text-white"
      >
        Start studying
      </Link>

      <h2 className="mt-10 text-sm font-medium uppercase tracking-wide text-gray-500">
        All {questions.length} questions
      </h2>

      <ul className="mt-3 space-y-3">
        {questions.map((question) => {
          const locked = question.type === "essay";
          return (
            <li key={question.id}>
              <Link
                href={`/demo/questions/${question.id}`}
                className={`block rounded-lg border p-4 ${
                  locked
                    ? "border-gray-200 bg-gray-50 hover:border-gray-300"
                    : "border-gray-200 hover:border-gray-400"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    {TYPE_LABEL[question.type]}
                  </span>
                  {locked && (
                    <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-700">
                      Locked
                    </span>
                  )}
                </span>
                <span className="mt-1 block font-medium text-gray-900">{question.title}</span>
                <span className="mt-1 block text-sm text-gray-600">
                  {questionSummary(question)} · {question.sourceRef}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
