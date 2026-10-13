import { withoutEmoji } from './pure';

describe('withoutEmoji — what a screen reader is handed', () => {
  it('drops the emoji in front of a stat title, in every script', () => {
    expect(withoutEmoji('📺 TV time')).toBe('TV time');
    expect(withoutEmoji('🎬 Movies watched')).toBe('Movies watched');
    expect(withoutEmoji('📺 وقت المسلسلات')).toBe('وقت المسلسلات');
    expect(withoutEmoji('🍿')).toBe('');
  });

  it('takes whole sequences: a variation selector and a joiner go with their emoji', () => {
    expect(withoutEmoji('❄️ Freeze')).toBe('Freeze');
    expect(withoutEmoji('Family 👨‍👩‍👧 night')).toBe('Family night');
  });

  it('leaves letters, digits and accents alone', () => {
    expect(withoutEmoji('Épisodes vus — 3 094')).toBe('Épisodes vus — 3 094');
  });
});
