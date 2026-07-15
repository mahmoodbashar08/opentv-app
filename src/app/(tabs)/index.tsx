import { Redirect } from 'expo-router';

/** The app opens on Movies — the root layout's route guards handle onboarding. */
export default function IndexRedirect() {
  return <Redirect href="/movies" />;
}
