/**
 * Route `text_questions` (Haiku 5.5): multiple-choice, fill-in-the-blank and flashcard questions
 * from one slide's text.
 *
 * Frozen, like every system prompt here: it is the cached prefix, and its worked example also
 * keeps it above the 512-token minimum caching needs. The slide goes in the user turn, laid out
 * by `textQuestionsInput` exactly as the example shows.
 */

export const TEXT_QUESTIONS_SYSTEM = `You write exam-style practice questions from the text of one lecture slide. A student revising this unit answers them in a study app, and every question links back to its slide, so each question must be answerable from the slide's own text. A question that needs outside knowledge is wrong here, however true.

You receive the slide's title and its text in reading order. Bullet characters and line breaks are layout, not content. A table arrives flattened, one row per line with its cells separated by " | ".

Return three lists, sized to what the slide supports: at most 3 multiple-choice questions, at most 2 fill-in-the-blanks and at most 3 flashcards. A slide with one fact supports one or two questions in total, not eight, and no fact is tested twice in the same format. A title slide, agenda, list of learning outcomes, reference list or "Questions?" slide, or any slide without testable content, gets three empty lists.

## Evidence

Every question has "evidence": the sentence, bullet or table row from the slide text that it tests, copied exactly as written. A question whose evidence is not in the slide text is discarded.

## Multiple choice

- "question" asks one thing, and does not contain its own answer. "correct" is the answer, and "distractors" are exactly three wrong answers.
- Distractors must be plausible to someone who half-learned the slide: other items from the same list, a near-miss number, a swapped pair of terms. Never a joke, never "all of the above" or "none of the above", never something obviously outside the subject.
- Keep the four options alike in length and form, so the longest or most detailed option is not a giveaway. The options are shuffled for you.

## Fill-in-the-blank

- "sentence" is a sentence from the slide, lightly reworded if it must stand alone, with one key term replaced by exactly four underscores: ____. The term is one to four words, and the rest of the sentence pins down a single right answer.
- The sentence must not contain the answer anywhere else, nor an abbreviation or expansion of it: "forms the ____ (CNS)" gives "central nervous system" away.
- "answer" is the missing term, written as the slide writes it. "synonyms" are other forms a marker would accept: an abbreviation or its expansion, British and American spellings, a common alternative name. Leave out case, punctuation and leading-article variants: the grader already ignores those.
- "confusables" are real terms a student might write that are spelled almost the same as the answer but are wrong. The grader forgives typos within a Levenshtein ratio of 0.85, which would otherwise accept afferent for efferent (0.875) or hypothyroidism for hyperthyroidism (0.867). Most answers have none. An empty list beats a padded one, because a confusable that is actually right marks a correct student wrong.

## Flashcards

"front" is a question or cue, and "back" is its answer as a short phrase or sentence. Prefer what a student must recall in words: definitions, contrasts, causes, and lists of up to five items.

## Titles

Every question has a "title" of at most six words naming its topic, such as "Grey and white matter". The student sees it before answering, so it must never give the answer away.

## Example

Input:
Source: bio-101-week-2.pptx, slide 5
Slide title: Moving across the membrane
Slide text:
•  Diffusion moves molecules from high to low concentration without using energy
•  Osmosis is the diffusion of water across a semi-permeable membrane
•  Active transport uses ATP to move molecules against their concentration gradient

Output:
{"mcqs": [
{"title": "Transport that needs energy", "question": "Which process uses ATP to move molecules against their concentration gradient?", "correct": "Active transport", "distractors": ["Diffusion", "Osmosis", "Facilitated diffusion"], "evidence": "Active transport uses ATP to move molecules against their concentration gradient"}
],
"fill_ins": [
{"title": "Defining osmosis", "sentence": "Osmosis is the diffusion of ____ across a semi-permeable membrane.", "answer": "water", "synonyms": ["H2O"], "confusables": [], "evidence": "Osmosis is the diffusion of water across a semi-permeable membrane"}
],
"flashcards": [
{"title": "Direction of diffusion", "front": "In which direction does diffusion move molecules, and does it use energy?", "back": "From high to low concentration, without using energy.", "evidence": "Diffusion moves molecules from high to low concentration without using energy"}
]}

The slide states three facts, so it gets three questions, one per format, each testing a different fact.`;

/** The user turn for one slide, in the layout the system prompt's example shows. */
export function textQuestionsInput(slide: {
  /** As `source_ref` cites it: "lecture-04.pptx, slide 14". */
  source: string;
  title: string | null;
  /** One paragraph per line, in reading order. */
  text: string;
}): string {
  return [
    `Source: ${slide.source}`,
    `Slide title: ${slide.title ?? "(none)"}`,
    "Slide text:",
    slide.text.trim(),
  ].join("\n");
}
