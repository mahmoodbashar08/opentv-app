import { bannerHeight, CENTRE_FRAME, coverFrameString, isGifCover, parseCoverFrame } from '@/pure';

describe('banner frame', () => {
  it('round-trips and falls back to the centre on anything malformed', () => {
    const f = { x: 0.25, y: 0.75, zoom: 1.5, tall: true };
    expect(parseCoverFrame(coverFrameString(f))).toEqual(f);
    expect(parseCoverFrame(null)).toEqual(CENTRE_FRAME);
    expect(parseCoverFrame('a,b,c,d')).toEqual(CENTRE_FRAME);
    expect(parseCoverFrame('2,-1,9,0')).toEqual({ x: 1, y: 0, zoom: 3, tall: false });
  });
  it('makes only a GIF tall; artwork keeps the normal height', () => {
    expect(bannerHeight('classic', true, true, 400)).toBe(360);
    expect(bannerHeight('classic', true, false, 400)).toBe(196);
    expect(bannerHeight('cards', false, true, 400)).toBe(252);
  });
  it('knows a GIF by its name', () => {
    expect(isGifCover('file:///x/cover-1.gif')).toBe(true);
    expect(isGifCover('https://media.giphy.com/media/abc/giphy.gif?cid=1')).toBe(true);
    expect(isGifCover('https://image.tmdb.org/t/p/w1280/a.jpg')).toBe(false);
  });
});
