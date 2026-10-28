import type { Metadata } from "next";
import { Bricolage_Grotesque, Caveat, Instrument_Sans } from "next/font/google";
import "./globals.css";

// The Field Guide type: Bricolage for headings, Instrument Sans for the interface, and Caveat
// only where a student would write by hand (docs/design/field-guide.dna.json).
const display = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"] });
const sans = Instrument_Sans({ variable: "--font-instrument-sans", subsets: ["latin"] });
const hand = Caveat({ variable: "--font-caveat", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "FigureQuiz", template: "%s · FigureQuiz" },
  description:
    "Turn lecture slides into quizzes: fill in the blanked-out labels on your own diagrams, " +
    "plus multiple choice, fill-in-the-blank and flashcards from the text.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${hand.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
