import { namelessListShow } from './pure';

describe('namelessListShow', () => {
  it('repairs a blank name and a name that is only the TheTVDB id', () => {
    expect(namelessListShow({ kind: 'show', tvdbId: 78857, name: '' })).toBe(true);
    expect(namelessListShow({ kind: 'show', tvdbId: 78857, name: '78857' })).toBe(true);
  });
  it('leaves real names, films and id-less shows alone', () => {
    expect(namelessListShow({ kind: 'show', tvdbId: 402033, name: 'Link Click' })).toBe(false);
    // "1883" is a real show whose name is a number — only its OWN id counts.
    expect(namelessListShow({ kind: 'show', tvdbId: 400000, name: '1883' })).toBe(false);
    expect(namelessListShow({ kind: 'movie', tvdbId: null, name: '' })).toBe(false);
    expect(namelessListShow({ kind: 'show', tvdbId: null, name: '' })).toBe(false);
  });
});
