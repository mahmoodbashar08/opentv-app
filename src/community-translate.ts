/**
 * Translating one comment into the reader's own language, on demand.
 *
 * THE APP SHIPS IN SIX LANGUAGES AND THE COMMENTS DO NOT. A thread where half
 * the words are unreadable is the gap that made the six locales a translation
 * of the buttons rather than of the community.
 *
 * A MEMORY CACHE ON TOP OF THE SERVER'S. The server stores every translation
 * for ever, so a second tap is cheap — but it is still a round trip, and a row
 * scrolling out of a FlatList and back would lose its translation and ask
 * again. Keyed by comment AND language, because the reader can change language
 * in Settings without the app restarting.
 *
 * IN-FLIGHT REQUESTS ARE SHARED. Two rows for the same comment — a thread and
 * its permalink — must not become two calls, and a double tap must not either.
 */

import { api } from '@/api';
import { getToken } from '@/community-session';
import { currentLocale } from '@/i18n';

export type Translation = { text: string; sourceLang: string | null; same: boolean };

const cache = new Map<string, Translation>();
const inflight = new Map<string, Promise<Translation>>();

/**
 * The language to translate INTO: the app's own, reduced to its base tag.
 *
 * `pt-BR` becomes `pt` because the server accepts the six the app ships and a
 * regional tag is not one of them — the translation is the same either way, and
 * a stored row per region would be the same text under two keys.
 */
export function readerLanguage(): string {
  return currentLocale().slice(0, 2);
}

/** What is already known, without asking anybody. Null means "not yet". */
export function cachedTranslation(commentId: string, lang = readerLanguage()): Translation | null {
  return cache.get(`${commentId}|${lang}`) ?? null;
}

export async function translateComment(commentId: string, lang = readerLanguage()): Promise<Translation> {
  const key = `${commentId}|${lang}`;
  const known = cache.get(key);
  if (known) return known;
  const running = inflight.get(key);
  if (running) return running;

  const p = (async () => {
    const token = await getToken();
    const r = await api<{ text: string; source_lang: string | null; same?: boolean }>(
      `/v1/comments/${encodeURIComponent(commentId)}/translate`,
      { method: 'POST', body: { lang }, token },
    );
    const out: Translation = { text: r.text, sourceLang: r.source_lang, same: r.same === true };
    cache.set(key, out);
    return out;
  })().finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p;
}
