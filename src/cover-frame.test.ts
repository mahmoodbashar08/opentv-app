import { bannerHeight, CENTRE_FRAME, coverFrameString, isGifCover, parseCoverFrame } from '@/pure';

describe('banner frame', () => {
  it('round-trips and falls back to the centre on anything malformed', () => {
    const f = { x: 0.25, y: 0.75, zoom: 1.5, size: 0.9, bg: true, fade: true, strength: 0.6, tint: '#ff00aa' };
    expect(parseCoverFrame(coverFrameString(f))).toEqual(f);
    expect(parseCoverFrame(null)).toEqual(CENTRE_FRAME);
    expect(parseCoverFrame('a,b,c,d')).toEqual(CENTRE_FRAME);
    expect(parseCoverFrame('2,-1,9,0')).toEqual({ x: 1, y: 0, zoom: 3, size: 0, bg: false, fade: false, strength: 1, tint: null });
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

import { decodeBlurhash } from '@/pure';

describe('blurhash decode', () => {
  it('decodes the reference hash to real colours, and refuses junk', () => {
    // The README example from woltapp/blurhash: a warm, mostly brown photo.
    const px = decodeBlurhash('LEHV6nWB2yk8pyo0adR*.7kCMdnj', 8, 8)!;
    expect(px).toHaveLength(8 * 8 * 4);
    expect(px[3]).toBe(255);
    expect(decodeBlurhash('nope', 8, 8)).toBeNull();
  });
});

import { smootherstep } from '@/pure';

describe('smootherstep', () => {
  it('starts and ends flat, and is half way at the middle', () => {
    expect(smootherstep(0)).toBe(0);
    expect(smootherstep(1)).toBe(1);
    expect(smootherstep(0.5)).toBeCloseTo(0.5);
    expect(smootherstep(0.02)).toBeLessThan(0.001);
  });
});
