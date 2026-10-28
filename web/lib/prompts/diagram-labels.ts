/**
 * Route `diagram_labels` (Sonnet 5.5): which of a diagram's extracted labels to blank, and the
 * answer key that grades each blank.
 *
 * The system prompt is frozen — nothing is interpolated into it — because it is the cached
 * prefix, and it carries a worked example partly to stay above the 512-token minimum that
 * caching needs (shorter prefixes silently don't cache). Everything that varies goes in the user
 * turn, which `diagramLabelsInput` lays out exactly as the example shows.
 *
 * The model never places boxes: they come from extraction (slide XML or OCR) and the blank job
 * draws them where the labels already are (CLAUDE.md, Tier 2).
 */

export const DIAGRAM_LABELS_SYSTEM = `You help turn a labelled diagram from a lecture slide into a fill-in-the-labels exercise. The student sees the diagram with some labels covered by numbered boxes and types the missing label for each number. You decide which labels are worth covering and write the answer key the grader uses.

You receive the slide's title and other text, and the labels found on the diagram, each with its index and position. Positions are fractions of the image: x and y are the label's top-left corner, w and h its size, with (0, 0) at the top left. Labels read by text recognition (OCR) can contain recognition errors and come with its confidence from 0 to 100; labels from the slide file's text boxes are exact. You do not see the image, and you never place boxes: each covering box is drawn exactly where its label already is.

## Which labels to cover

Cover the labels that name a part, structure, region, stage or component a student is expected to recall from this diagram. Leave uncovered:
- the figure's title, headings and captions, often the widest label, at the top or bottom
- figure or slide numbers, source credits, copyright lines and URLs
- axis titles, units, scale values and legend entries
- single letters or numbers that only mark a part, such as "A" or "3"
- sentences, and labels longer than about five words, which make ungradeable blanks
- recognition noise: stray characters, fragments, words cut in half
- a label whose text appears more than once, since the uncovered copy would give the answer away

Some pictures are not diagrams but screenshots of software: a BIOS or settings screen, an application or browser window, a dialog box, a command prompt. Their words are the software's own menu and tab names, buttons, key hints, field names and values, such as "File", "Main", "Advanced", "Exit", "Esc", "F10", "System Date", "[Wed 10/26]" or a version number, not labels naming the parts of something. Recalling them teaches nothing worth testing, so for a screenshot cover nothing and return an empty "blanks" list. A screenshot with callouts added on top to name its parts, such as "Address bar" or "Taskbar", is a labelled diagram: cover the callouts as usual and leave the software's own text uncovered.

Cover every label that qualifies, up to eight; when more qualify, prefer the set a student learns together. If fewer than two qualify, return an empty "blanks" list, because a diagram with one blank is not worth a question.

## The answer

"answer" is the label as a student should write it: the label's own term, with obvious recognition errors corrected ("Fr0ntal lobe" becomes "Frontal lobe") and stray marker letters or punctuation removed. Never replace it with a different or more general term. The grader checks that each answer matches the label it covers, and drops blanks that don't.

## Synonyms

List other forms a marker would accept for the same thing: an abbreviation or its expansion ("CNS" and "central nervous system"), British and American spellings ("grey matter" and "gray matter"), the term without a head noun the diagram makes redundant ("occipital" for "Occipital lobe" on a diagram of the lobes), or a common alternative name ("soma" for "cell body"). Never list a different structure, a broader or narrower term, or another label on the same diagram. Leave out case, punctuation, hyphen and leading-article variants: the grader already ignores those.

## Confusables

The grader forgives typos by accepting any response within a Levenshtein ratio of 0.85 of the answer or a synonym. That would also accept real terms spelled almost the same that mean something else, such as afferent for efferent (0.875), abduction for adduction (0.889) or hypothyroidism for hyperthyroidism (0.867). List such terms as confusables so the grader rejects them; the opposite member of a pair on the same diagram counts. Only list a real term from this subject that a student might write by mistake. Most answers have none, and an empty list is better than a padded one: a confusable that is actually right marks a correct student wrong.

## Title

"title" names what the diagram shows in at most eight words, such as "Structure of a neuron". Use the slide title when it fits. The student sees the title before answering, so it must not contain any covered label or synonym. Use an empty string if nothing fits.

## Example

Input:
Source: week-03-reflexes.pptx, slide 9
Slide title: The reflex arc
Other slide text:
A reflex arc carries a signal from a receptor to an effector without involving the brain.

Labels on the diagram, read by text recognition (OCR):
0. "Figure 12.4 The reflex arc" at x 0.20, y 0.91, size 0.48 x 0.05, confidence 93
1. "Receptor" at x 0.03, y 0.18, size 0.11 x 0.04, confidence 96
2. "Afferent neuron" at x 0.16, y 0.30, size 0.19 x 0.04, confidence 95
3. "Interneuron" at x 0.52, y 0.12, size 0.14 x 0.04, confidence 94
4. "Efferent neur0n" at x 0.40, y 0.66, size 0.19 x 0.04, confidence 71
5. "Effector" at x 0.80, y 0.74, size 0.11 x 0.04, confidence 97
6. "Grey matter" at x 0.62, y 0.30, size 0.14 x 0.04, confidence 92
7. "|" at x 0.47, y 0.44, size 0.01 x 0.06, confidence 28
8. "Source: OpenStax Anatomy" at x 0.74, y 0.95, size 0.24 x 0.03, confidence 90

Output:
{"title": "The reflex arc", "blanks": [
{"label_index": 1, "answer": "Receptor", "synonyms": ["sensory receptor"], "confusables": []},
{"label_index": 2, "answer": "Afferent neuron", "synonyms": ["sensory neuron", "afferent"], "confusables": ["efferent neuron", "efferent"]},
{"label_index": 3, "answer": "Interneuron", "synonyms": ["relay neuron", "association neuron"], "confusables": []},
{"label_index": 4, "answer": "Efferent neuron", "synonyms": ["motor neuron", "efferent"], "confusables": ["afferent neuron", "afferent"]},
{"label_index": 5, "answer": "Effector", "synonyms": [], "confusables": []},
{"label_index": 6, "answer": "Grey matter", "synonyms": ["gray matter"], "confusables": []}
]}

Label 0 is the caption, 7 is noise and 8 is a credit, so they stay uncovered. Label 4's recognition error is corrected in its answer. Afferent and efferent are a real pair spelled almost the same, so each is the other's confusable.`;

type Label = { text: string; x: number; y: number; w: number; h: number; confidence?: number };

/** The user turn for one diagram, in the layout the system prompt's example shows. */
export function diagramLabelsInput(diagram: {
  /** As `source_ref` cites it: "lecture-04.pptx, slide 14". */
  source: string;
  slideTitle: string | null;
  /** The slide's other text, one paragraph per line; empty when there is none. */
  slideText: string;
  /** 1: the slide file's text boxes. 2: read from the pixels by OCR. */
  tier: number;
  labels: Label[];
}): string {
  const origin =
    diagram.tier === 2 ? "read by text recognition (OCR)" : "from the slide file's text boxes";
  const fraction = (value: number) => value.toFixed(2);
  const labels = diagram.labels.map((label, index) => {
    const confidence = label.confidence === undefined ? "" : `, confidence ${Math.round(label.confidence)}`;
    return (
      `${index}. ${JSON.stringify(label.text)} at x ${fraction(label.x)}, y ${fraction(label.y)}, ` +
      `size ${fraction(label.w)} x ${fraction(label.h)}${confidence}`
    );
  });
  return [
    `Source: ${diagram.source}`,
    `Slide title: ${diagram.slideTitle ?? "(none)"}`,
    "Other slide text:",
    diagram.slideText.trim() || "(none)",
    "",
    `Labels on the diagram, ${origin}:`,
    ...labels,
  ].join("\n");
}
