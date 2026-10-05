import { describe, expect, it } from '@jest/globals';

import { displayTitle, parseAltTitles } from '@/pure';

const ANGELS_EGG = JSON.stringify({ en: "Angel's Egg", orig: '\u5929\u4f7f\u306e\u305f\u307e\u3054' });
const RED_TURTLE = JSON.stringify({
  en: 'The Red Turtle',
  orig: 'La Tortue rouge',
  loc: '\u0627\u0644\u0633\u0644\u062d\u0641\u0627\u0629 \u0627\u0644\u062d\u0645\u0631\u0627\u0621',
});

describe('displayTitle', () => {
  it('shows the English title, not the stored original', () => {
    // The row is keyed by what the import wrote, which for this film is the
    // Japanese title. That is exactly the case the reader complained about.
    expect(displayTitle('\u5929\u4f7f\u306e\u305f\u307e\u3054', ANGELS_EGG)).toBe("Angel's Egg");
    expect(displayTitle('La Tortue rouge', RED_TURTLE)).toBe('The Red Turtle');
  });

  it('shows English even when a localised title exists', () => {
    // NOT the UI language. A library imported from TV Time is already English
    // throughout, and TMDB has a localised title for some films and not others
    // -- following the reader's language would translate half a shelf and
    // leave the rest, which is worse than one language for all of it.
    expect(displayTitle('La Tortue rouge', RED_TURTLE)).toBe('The Red Turtle');
  });

  it('never returns nothing \u2014 an untranslated film keeps its stored name', () => {
    expect(displayTitle('Some Obscure Film', null)).toBe('Some Obscure Film');
    expect(displayTitle('Some Obscure Film', '{}')).toBe('Some Obscure Film');
  });

  it("survives the first version's unlabelled array without mislabelling it", () => {
    // The old shape stored a bag of strings with no idea which was English.
    // It must not be mistaken for a translation.
    expect(displayTitle('La Tortue rouge', '["The Red Turtle"]')).toBe('La Tortue rouge');
    expect(parseAltTitles('["The Red Turtle"]')).toEqual({ orig: 'The Red Turtle' });
  });

  it('ignores malformed JSON rather than throwing at render time', () => {
    expect(displayTitle('A Film', '{not json')).toBe('A Film');
  });

  it('keeps the localised name stored, so search can still find it', () => {
    // Not displayed, but not discarded: somebody who knows the film only by
    // its Arabic name must still be able to find it.
    expect(parseAltTitles(RED_TURTLE).loc).toBe(
      '\u0627\u0644\u0633\u0644\u062d\u0641\u0627\u0629 \u0627\u0644\u062d\u0645\u0631\u0627\u0621',
    );
  });
});
