import { normalise, parseLayout } from './profile-layout';

// A layout saved before blocks had ids. The Profile tab normalises it on every
// focus; random ids there rebuilt the whole profile each time (2 Oct 2026).
describe('a layout saved without block ids', () => {
  const old = JSON.stringify({ items: [{ id: 'shelf:movies', span: '2x1' }, { id: 'shelf:shows', span: '2x1' }, { id: 'shelf:movies', span: '2x1' }] });

  it('gets the same ids every time it is read', () => {
    const a = normalise(parseLayout(old), ['movies', 'shows']).map((p) => p.uid);
    const b = normalise(parseLayout(old), ['movies', 'shows']).map((p) => p.uid);
    expect(a).toEqual(b);
  });

  it('still gives two copies of one widget different ids', () => {
    const uids = normalise(parseLayout(old), ['movies', 'shows']).map((p) => p.uid);
    expect(new Set(uids).size).toBe(uids.length);
  });
});
