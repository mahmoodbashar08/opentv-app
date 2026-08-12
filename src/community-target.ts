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
import { episodeMeta, showMeta } from '@/metadata';
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
    /**
     * THE LIBRARY FIRST, THEN THE CATALOGUE.
     *
     * Reading somebody else's comments means reading about shows you do not
     * track — that is most of the point — and looking only at the local library
     * labelled every one of them `#465273`. The metadata cache already knows
     * the names of bundled shows and of anything fetched for any reason, so it
     * answers most of the rest for free, with no request.
     *
     * `resolveUnknownTargets` fills in what neither knows.
     */
    const cached = showMeta(Number(c.target_key))?.name;
    /**
     * NO ID ON SCREEN WHILE THE NAME IS ON ITS WAY.
     *
     * `#75897` is not information — it is the app showing its own plumbing, and
     * on a fast scroll through somebody's profile it flickers past on every
     * card before the fetch lands. The season and episode ARE known without
     * any request, so the pill says what it can: "S16E13" now, "THE SIMPSONS
     * S16E13" a moment later, and never a number nobody can read.
     *
     * A show with no season carries nothing else to say, so its pill is empty
     * and the card drops it rather than showing a bare id.
     */
    const name = show?.name ?? cached ?? null;
    if (name == null) {
      if (c.season == null) return '';
      return c.episode == null ? `S${c.season}` : `S${c.season}E${c.episode}`;
    }
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



/**
 * Fetch the names of shows a list of comments is about but this phone has
 * never heard of.
 *
 * WHY IT IS SEPARATE FROM `targetLabel`: that one is called during render, from
 * three screens, and must stay synchronous and free. This is the deliberate
 * round trip, made once per screen for the handful of ids that are genuinely
 * unknown, after which the metadata cache answers them for ever.
 *
 * Silent by design. A name that cannot be fetched leaves `#465273` on screen,
 * which is what it says today — nothing is made worse by a failure, and a
 * comments list must not show an error because a title lookup timed out.
 */
export async function resolveUnknownTargets(comments: readonly Comment[]): Promise<boolean> {
  const known = new Set(getShowNames().map((s) => String(s.tvdbId)));
  const missing = [
    ...new Set(
      comments
        .filter((c) => c.target_source === 'tvdb' && !known.has(c.target_key))
        .map((c) => Number(c.target_key))
        .filter((id) => Number.isFinite(id) && id > 0 && !showMeta(id)),
    ),
  ];
  if (missing.length === 0) return false;

  const { fetchShowMeta } = await import('@/show-meta-fetch');
  // A comments screen holds a few dozen rows; a handful of lookups at a time
  // keeps a cold list from opening thirty connections at once.
  let filled = false;
  for (const id of missing.slice(0, 24)) {
    try {
      if (await fetchShowMeta(id)) filled = true;
    } catch {
      // `#id` stands. See above.
    }
  }
  return filled;
}
