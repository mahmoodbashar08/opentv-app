import { describe, expect, it } from '@jest/globals';

import { displayTitle, parseAltTitles } from '@/pure';

const ANGELS_EGG = JSON.stringify({ en: "Angel's Egg", orig: '天使のたまご' });
const RED_TURTLE = JSON.stringify({ en: 'The Red Turtle', orig: 'La Tortue rouge', loc: 'السلحفاة الحمراء' });

describe('displayTitle', () => {
  it('shows the English title to an English reader, not the stored original', () => {
    // The row is keyed by what the import wrote, which for this film is the
    // Japanese title. That is exactly the case the reader complained about.
    expect(displayTitle('天使のたまご', ANGELS_EGG, 'en-GB')).toBe("Angel's Egg");
  });

  it("shows the reader's own language before English", () => {
    // "Always English" would be the same mistake pointed the other way.
    expect(displayTitle('La Tortue rouge', RED_TURTLE, 'ar')).toBe('السلحفاة الحمراء');
  });

  it('falls back to English when the reader has no translation', () => {
    expect(displayTitle('天使のたまご', ANGELS_EGG, 'fr-FR')).toBe("Angel's Egg");
  });

  it('never returns nothing — an untranslated film keeps its stored name', () => {
    expect(displayTitle('Some Obscure Film', null, 'en')).toBe('Some Obscure Film');
    expect(displayTitle('Some Obscure Film', '{}', 'ar')).toBe('Some Obscure Film');
  });

  it('survives the first version’s unlabelled array without mislabelling it', () => {
    // The old shape stored a bag of strings with no idea which was English.
    // It must not be mistaken for a translation.
    expect(displayTitle('La Tortue rouge', '["The Red Turtle"]', 'en')).toBe('La Tortue rouge');
    expect(parseAltTitles('["The Red Turtle"]')).toEqual({ orig: 'The Red Turtle' });
  });

  it('ignores malformed JSON rather than throwing at render time', () => {
    expect(displayTitle('A Film', '{not json', 'en')).toBe('A Film');
  });
});
