import { describe, expect, it } from "vitest";
import { arpeggio, THEMES } from "./music";

describe("background music", () => {
  it("every game has a theme with four chords", () => {
    for (const t of Object.values(THEMES)) {
      expect(t.chords).toHaveLength(4);
      expect(t.bpm).toBeGreaterThan(60);
    }
  });

  it("arpeggio notes come from the bar's chord and always start on the downbeat", () => {
    const t = THEMES.dice;
    for (let bar = 0; bar < 16; bar++) {
      const notes = arpeggio(t, bar, 42);
      expect(notes).toHaveLength(8);
      expect(notes[0]).not.toBeNull();
      const chord = t.chords[bar % 4];
      for (const n of notes) {
        if (n === null) continue;
        const rel = n - t.root;
        expect(chord.some((c) => rel === c + 12 || rel === c + 24)).toBe(true);
      }
    }
    expect(arpeggio(t, 3, 42)).toEqual(arpeggio(t, 3, 42));
  });
});
