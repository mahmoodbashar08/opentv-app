const meta: Record<string, string> = {};
let icon = 'default';
let event: string | null = 'halloween';
const alerts: string[] = [];
jest.mock('@/db', () => ({ getMeta: (k: string) => meta[k] ?? null, setMeta: (k: string, v: string) => void (meta[k] = v) }));
jest.mock('@/i18n', () => ({ t: (k: string) => k }));
jest.mock('@/season', () => ({ seasonalOn: () => true, activeEvent: () => (event ? { id: event } : null) }));
jest.mock('@/app-icon', () => ({
  supported: () => true,
  currentIcon: () => icon,
  setIcon: async (n: string) => {
    icon = n;
    return true;
  },
}));
jest.mock('react-native', () => ({
  Alert: {
    alert: (title: string, _b: string, buttons: { onPress?: () => void }[]) => {
      alerts.push(title);
      buttons[1]?.onPress?.();
    },
  },
}), { virtual: true });

import { freeIcons, iconChosenByHand, offerSeasonIcon } from '@/season-icon';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the season icon', () => {
  it('is free while its season runs, offered once, and put back when the season ends', async () => {
    expect(freeIcons()).toEqual(['default', 'halloween']);
    await offerSeasonIcon();
    await flush();
    expect(icon).toBe('halloween');
    await offerSeasonIcon();
    expect(alerts).toHaveLength(1);
    event = null;
    expect(freeIcons()).toEqual(['default']);
    await offerSeasonIcon();
    expect(icon).toBe('default');
  });

  it('never takes back an icon chosen by hand', async () => {
    event = 'christmas';
    await offerSeasonIcon();
    await flush();
    expect(icon).toBe('christmas');
    iconChosenByHand();
    event = null;
    await offerSeasonIcon();
    expect(icon).toBe('christmas');
  });
});
