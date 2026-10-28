import { describe, expect, it } from "vitest";

import { markerBoxes } from "@/lib/dal/questions";

/** A diagram's labels, as the worker stores them on its asset. */
const ASSET = {
  labels: [
    { text: "Human Brain Anatomy", x: 0.24, y: 0.02, w: 0.42, h: 0.07 },
    { text: "Frontal lobe", x: 0.1339, y: 0.1872, w: 0.1431, h: 0.0487 },
    { text: "Parietal lobe", x: 0.5413, y: 0.1872, w: 0.1413, h: 0.0487, confidence: 96 },
  ],
  image_width: 1090,
  image_height: 780,
};

/** Its answer key: blank 1 is label 2, blank 2 is label 1. The figure's title is not tested. */
const KEY = {
  blanks: [
    { number: 1, label_index: 2, answer: "Parietal lobe", synonyms: ["parietal"], confusables: [] },
    { number: 2, label_index: 1, answer: "Frontal lobe", synonyms: ["frontal"], confusables: [] },
  ],
};

describe("markerBoxes", () => {
  it("places each blank at its label's box, by label_index", () => {
    const boxes = markerBoxes(KEY, ASSET);
    expect(boxes.get(1)).toEqual({ x: 0.5413, y: 0.1872, w: 0.1413, h: 0.0487 });
    expect(boxes.get(2)).toEqual({ x: 0.1339, y: 0.1872, w: 0.1431, h: 0.0487 });
    expect(boxes.size).toBe(2);
  });

  // The boxes go to the browser before the question is answered, so they must hold positions
  // and nothing else: no label text, no OCR confidence, no answer.
  it("lets out positions only", () => {
    const serialized = JSON.stringify([...markerBoxes(KEY, ASSET).values()]);
    for (const leak of ["Frontal", "Parietal", "Human Brain", "confidence", "frontal", "parietal"]) {
      expect(serialized).not.toContain(leak);
    }
    for (const box of markerBoxes(KEY, ASSET).values()) {
      expect(Object.keys(box).sort()).toEqual(["h", "w", "x", "y"]);
    }
  });

  it("gives nothing when the key or the labels don't parse", () => {
    expect(markerBoxes(null, ASSET).size).toBe(0);
    expect(markerBoxes(KEY, null).size).toBe(0);
    expect(markerBoxes({ blanks: [] }, ASSET).size).toBe(0);
    expect(markerBoxes(KEY, { labels: "nope" }).size).toBe(0);
  });

  it("skips a blank whose label index points past the labels", () => {
    const key = {
      blanks: [
        { number: 1, label_index: 1, answer: "Frontal lobe", synonyms: [], confusables: [] },
        { number: 2, label_index: 9, answer: "Missing", synonyms: [], confusables: [] },
      ],
    };
    const boxes = markerBoxes(key, ASSET);
    expect([...boxes.keys()]).toEqual([1]);
  });
});
