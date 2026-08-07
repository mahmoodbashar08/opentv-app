import { Redirect } from 'expo-router';

import { getMeta } from '@/db';

/** The app opens on Profile by default — where your stats and library live —
 *  but a Settings choice ("Opening tab") lets each user pick their own, after
 *  a heavy TV watcher asked to land on Shows instead. The root layout's route
 *  guards handle onboarding. */
const HREFS = {
  profile: '/profile',
  shows: '/shows',
  movies: '/movies',
  explore: '/explore',
} as const;

export default function IndexRedirect() {
  const pref = getMeta('startTab');
  const href = HREFS[(pref ?? 'profile') as keyof typeof HREFS] ?? '/profile';
  return <Redirect href={href} />;
}
