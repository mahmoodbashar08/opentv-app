/**
 * The community server's address, without the database.
 *
 * `server-url.ts` reads the chosen server out of `meta`, so importing it drags
 * `db.ts` and expo-sqlite into a suite that tests request shapes. Tests resolve
 * the committed `api-config.example.ts` for the same reason — see the note in
 * `jest.config.js` — and this keeps the two answers identical.
 */
import { API_BASE_URL } from '@/api-config';

export function serverUrl(): string {
  return API_BASE_URL;
}
export function isCustomServer(): boolean {
  return false;
}
export function officialServerUrl(): string {
  return API_BASE_URL;
}
export { normaliseServerUrl } from '@/pure';
export function setServerUrl(): void {
  /* nothing to store without a database */
}
