import { Redirect } from 'expo-router';

/** The app opens on Profile — where your stats and library live, and what a
 *  tester asked for over landing on Movies. The root layout's route guards
 *  handle onboarding. */
export default function IndexRedirect() {
  return <Redirect href="/profile" />;
}
