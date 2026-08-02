/**
 * What a server comment is ABOUT, named from the local library.
 *
 * Lived in `user-comments.tsx` until three screens needed it: the profile feed
 * labels its cards with it, the permalink screen needs it to write the comment
 * into the phone's own archive, and the thread stores it as `entity` when you
 * post. One copy, because a comment that is labelled "Riverdale S1E1" on one
 * screen and "#82716" on another is two answers to one question.
 */
import type { Comment } from '@/community-comments';
import { getMovies, getShowNames } from '@/db';
import { t } from '@/i18n';
import { episodeMeta } from '@/metadata';
import { slug } from '@/pure';

/**
 * The title a server comment is about, resolved against the local library.
 *
 * The server stores an IDENTITY, not a name: `tvdb:121361` or
 * `title:toy-story-5|1994`. That is right — names are ambiguous and change —
 * but it means the phone has to say what it means, and only the phone has the
 * library to say it with. When it cannot, the key itself is shown rather than
 * a blank: an unrecognised row is still a row somebody wrote.
 */
export function targetLabel(c: Comment): string {
  if (c.target_source === 'tvdb') {
    const show = getShowNames().find((s) => String(s.tvdbId) === c.target_key);
    const name = show?.name ?? `#${c.target_key}`;
    if (c.season == null) return name;
    if (c.episode == null) return `${name} S${c.season}`;
    // The SAME words the episode page uses, so the two screens never disagree
    // about an episode no catalogue carries.
    const known = show ? episodeMeta(show.tvdbId, c.season, c.episode)?.title : null;
    if (!known && c.episode === 0) return `${name} · ${t('show.episodeUnknownTitle')}`;
    return `${name} S${c.season}E${c.episode}`;
  }
  const bare = c.target_key.split('|')[0] ?? '';
  const film = getMovies().find((m) => slug(m.name) === bare);
  return film?.name ?? bare.replace(/-/g, ' ');
}

