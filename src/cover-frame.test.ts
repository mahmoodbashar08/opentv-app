import { bannerHeight, CENTRE_FRAME, coverFrameString, isGifCover, parseCoverFrame } from '@/pure';

describe('banner frame', () => {
  it('round-trips and falls back to the centre on anything malformed', () => {
    const f = { x: 0.25, y: 0.75, zoom: 1.5, size: 0.9, bg: true };
    expect(parseCoverFrame(coverFrameString(f))).toEqual(f);
    expect(parseCoverFrame(null)).toEqual(CENTRE_FRAME);
    expect(parseCoverFrame('a,b,c,d')).toEqual(CENTRE_FRAME);
    expect(parseCoverFrame('2,-1,9,0')).toEqual({ x: 1, y: 0, zoom: 3, size: 0, bg: false });
    expect(parseCoverFrame('0.5,0.5,1,1').size).toBe(1);
  });
  it('is as tall as it was dragged, never shorter than normal, never past the cap', () => {
    expect(bannerHeight('classic', 0.9, 400)).toBe(360);
    expect(bannerHeight('classic', 0.3, 400)).toBe(196);
    expect(bannerHeight('cards', 0, 400)).toBe(252);
    expect(bannerHeight('classic', 2, 400)).toBe(640);
  });
  it('knows a GIF by its name', () => {
    expect(isGifCover('file:///x/cover-1.gif')).toBe(true);
    expect(isGifCover('https://media.giphy.com/media/abc/giphy.gif?cid=1')).toBe(true);
    expect(isGifCover('https://image.tmdb.org/t/p/w1280/a.jpg')).toBe(false);
  });
});

import { bannerGeometry } from '@/pure';

describe('banner geometry', () => {
  it('lets a wide picture move sideways only, within its own edges', () => {
    const g = bannerGeometry({ w: 400, h: 200 }, 4, 1);
    expect(g.w).toBe(800);
    expect(g.xMin).toBeCloseTo(0.25);
    expect(g.xMax).toBeCloseTo(0.75);
    expect(g.yMin).toBe(0.5);
    expect(g.yMax).toBe(0.5);
  });
  it('gives a square picture in a square box room only once zoomed', () => {
    expect(bannerGeometry({ w: 300, h: 300 }, 1, 1).xMin).toBe(0.5);
    expect(bannerGeometry({ w: 300, h: 300 }, 1, 2).xMin).toBeCloseTo(0.25);
  });
});

import { backdropImage } from '@/pure';

describe('background flows under the page', () => {
  it('is one picture at its own shape, from the top', () => {
    const b = backdropImage(400, 250, 0.5, 1, 0.5, 0);
    expect(b.h).toBe(800);
    expect(b.top).toBe(0);
    expect(b.left).toBe(0);
  });
  it('always covers the banner, even when the picture is wide', () => {
    const b = backdropImage(400, 300, 2, 1, 0.5, 0);
    expect(b.h).toBe(300);
    expect(b.w).toBe(600);
  });
  it('lifts by y as far as it is taller than the banner, and slides by x when zoomed', () => {
    expect(backdropImage(400, 250, 0.5, 1, 0.5, 1).top).toBe(-550);
    expect(backdropImage(400, 250, 2, 2, 1, 0).left).toBe(-600);
  });
});
