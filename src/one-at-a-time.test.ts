import { oneAtATime } from '@/one-at-a-time';

describe('oneAtATime', () => {
  it('ignores a second run under the same key while the first is pending', async () => {
    let calls = 0;
    let release!: () => void;
    const slow = () => {
      calls++;
      return new Promise<void>((r) => (release = r));
    };
    const first = oneAtATime('share', slow);
    await oneAtATime('share', slow);
    expect(calls).toBe(1);
    release();
    await first;
    await oneAtATime('share', async () => {
      calls++;
    });
    expect(calls).toBe(2);
  });

  it('lets different keys run side by side', async () => {
    const order: string[] = [];
    let release!: () => void;
    const a = oneAtATime('add:1', () => new Promise<void>((r) => ((release = r), order.push('a'))));
    await oneAtATime('add:2', async () => {
      order.push('b');
    });
    release();
    await a;
    expect(order).toEqual(['a', 'b']);
  });

  it('frees the key when the action throws', async () => {
    await expect(oneAtATime('k', () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    let ran = false;
    await oneAtATime('k', async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
