import { orderDevices, pickDeviceName, syncRefusal } from './devices';

describe('what this phone calls itself', () => {
  it('prefers the name the owner gave it', () => {
    expect(pickDeviceName("Mahmood's iPhone", 'iPhone 15 Pro')).toBe("Mahmood's iPhone");
    expect(pickDeviceName('Pixel of Sara', 'Pixel 8')).toBe('Pixel of Sara');
  });
  it('passes over the bare "iPhone" iOS 16 answers for the model', () => {
    expect(pickDeviceName('iPhone', 'iPhone 15 Pro')).toBe('iPhone 15 Pro');
    expect(pickDeviceName('iPad', 'iPad Air (5th generation)')).toBe('iPad Air (5th generation)');
    expect(pickDeviceName('iPhone 15', 'iPhone 15 Pro')).toBe('iPhone 15 Pro');
  });
  it('falls back to whatever is there, and to nothing', () => {
    expect(pickDeviceName(null, 'Pixel 8')).toBe('Pixel 8');
    expect(pickDeviceName('iPhone', null)).toBe('iPhone');
    expect(pickDeviceName('  ', '')).toBeNull();
    expect(pickDeviceName(undefined, undefined)).toBeNull();
  });
});

describe('the list', () => {
  it('puts this phone first and keeps the rest in the order given', () => {
    const list = [{ device: 'a' }, { device: 'b' }, { device: 'me' }, { device: 'c' }];
    expect(orderDevices(list, 'me').map((d) => d.device)).toEqual(['me', 'a', 'b', 'c']);
    expect(orderDevices(list, 'zz').map((d) => d.device)).toEqual(['a', 'b', 'me', 'c']);
  });
});

describe('being turned away', () => {
  it('is only the two codes that mean it', () => {
    expect(syncRefusal('device_removed')).toBe('device_removed');
    expect(syncRefusal('device_limit')).toBe('device_limit');
    expect(syncRefusal('plus_required')).toBeNull();
    expect(syncRefusal('network')).toBeNull();
    expect(syncRefusal('')).toBeNull();
  });
});
