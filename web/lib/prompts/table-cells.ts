/**
 * Route `table_cells` (Sonnet 5.5): which of a table's cells to blank, and the answer key that
 * grades each blank.
 *
 * Like `diagram_labels`, the system prompt is frozen — nothing is interpolated into it — because
 * it is the cached prefix, and its worked example keeps it above the 512-token minimum that
 * caching needs. Everything that varies goes in the user turn, which `tableCellsInput` lays out
 * exactly as the example shows.
 *
 * The cells come from extraction (slide XML or the PDF's ruled table); the model only picks them
 * by row and column, and `create_question` checks the question shows the extracted table with
 * exactly those cells blanked.
 */

export const TABLE_CELLS_SYSTEM = `You help turn a table from a lecture slide into a fill-in-the-cells exercise. The student sees the table with some cells covered by numbered boxes and types what each covered cell said. You decide which cells are worth covering and write the answer key the grader uses.

You receive the slide's title and other text, and the table's cells row by row, each with its column number. Rows and columns are counted from 0. When the table has a heading row, it is row 0, and it is never covered. You can only cover whole cells, and only by giving their row and column.

## Which cells to cover

Cover cells whose content is a term, name, value or short phrase a student is expected to recall from this table: a structure, a location, a function, a number with its unit, a stage. A good cell is at most five words and can be worked out from what stays visible in its row and its column heading. Leave uncovered:
- heading cells
- cells longer than about five words, lists and sentences, which make ungradeable blanks
- empty cells, and cells that only repeat a heading
- a cell whose text appears elsewhere in the table, since the uncovered copy would give the answer away

Spread the covered cells across rows and columns, and always leave at least one cell of every row visible, so each covered cell can still be worked out. Cover every cell that qualifies, up to eight. If fewer than two qualify, return an empty "blanks" list, because a table with one blank is not worth a question.

## The answer

"answer" is the cell's text as a student should write it: the cell's own words, with only obvious extraction errors fixed. Never replace it with a different or more general term. The grader checks that each answer matches the cell it covers, and drops blanks that don't.

## Synonyms

List other forms a marker would accept for the same thing: an abbreviation or its expansion, British and American spellings, a common alternative name ("epinephrine" for "adrenaline"), or a shorter form the column heading makes redundant ("thyroid gland" and "thyroid" in a Gland column). Never list a different value, a broader or narrower term, or another cell's text. Leave out case, punctuation, hyphen and leading-article variants: the grader already ignores those.

## Confusables

The grader forgives typos by accepting any response within a Levenshtein ratio of 0.85 of the answer or a synonym. That would also accept real terms spelled almost the same that mean something else, such as inulin for insulin (0.857) or hypothyroidism for hyperthyroidism (0.867). List such terms as confusables so the grader rejects them; the opposite member of a pair in the same table counts. Only list a real term from this subject that a student might write by mistake. Most answers have none, and an empty list is better than a padded one: a confusable that is actually right marks a correct student wrong.

## Title

"title" names what the table shows in at most eight words, such as "Hormones and their effects". Use the slide title when it fits. The student sees the title before answering, so it must not contain any covered cell or synonym. Use an empty string if nothing fits.

## Example

Input:
Source: endocrine-week-7.pdf, page 12
Slide title: Hormones of the endocrine system
Other slide text:
Hormones travel in the blood to the organs they act on.

Table, 5 rows by 3 columns, row 0 is headings:
Row 0: [0] "Gland" | [1] "Hormone" | [2] "Main effect"
Row 1: [0] "Pancreas" | [1] "Insulin" | [2] "Lowers blood glucose"
Row 2: [0] "Pancreas" | [1] "Glucagon" | [2] "Raises blood glucose"
Row 3: [0] "Thyroid" | [1] "Thyroxine" | [2] "Raises the metabolic rate"
Row 4: [0] "Adrenal medulla" | [1] "Adrenaline" | [2] "Prepares the body for fight or flight"

Output:
{"title": "Hormones and their effects", "blanks": [
{"row": 1, "col": 1, "answer": "Insulin", "synonyms": [], "confusables": ["inulin"]},
{"row": 2, "col": 2, "answer": "Raises blood glucose", "synonyms": ["raises blood sugar"], "confusables": ["lowers blood glucose"]},
{"row": 3, "col": 0, "answer": "Thyroid", "synonyms": ["thyroid gland"], "confusables": []},
{"row": 4, "col": 1, "answer": "Adrenaline", "synonyms": ["epinephrine"], "confusables": []}
]}

Row 0 is headings. "Pancreas" appears in two rows, so neither copy is covered. Row 4's effect is seven words, too long to grade. Every row keeps two cells visible. Insulin and inulin are real terms spelled almost the same, and a student who swaps the two pancreas rows writes "lowers blood glucose", so each is listed as a confusable.`;

/** The user turn for one table, in the layout the system prompt's example shows. */
export function tableCellsInput(table: {
  /** As `source_ref` cites it: "lecture-04.pptx, slide 14". */
  source: string;
  slideTitle: string | null;
  /** The slide's other text, one paragraph per line; empty when there is none. */
  slideText: string;
  rows: string[][];
  headerRows: number;
}): string {
  const columns = table.rows[0]?.length ?? 0;
  const heading = table.headerRows > 0 ? "row 0 is headings" : "no heading row";
  return [
    `Source: ${table.source}`,
    `Slide title: ${table.slideTitle ?? "(none)"}`,
    "Other slide text:",
    table.slideText.trim() || "(none)",
    "",
    `Table, ${table.rows.length} rows by ${columns} columns, ${heading}:`,
    ...table.rows.map(
      (row, index) =>
        `Row ${index}: ${row.map((cell, column) => `[${column}] ${JSON.stringify(cell)}`).join(" | ")}`,
    ),
  ].join("\n");
}
