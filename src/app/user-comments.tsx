/**
 * Everything one person has written — the `comments` count's destination.
 *
 * WHY IT IS ITS OWN SCREEN. It used to hang off the bottom of their profile,
 * below four shelves, which put a stranger's writing somewhere nobody scrolls
 * to and made their profile a different shape from your own. On YOUR profile
 * the comments count is a button that opens your archive; on theirs it now
 * opens this. Same band, same third cell, same gesture — different data, which
 * is the only thing that should differ.
 *
 * NO PICTURES FROM THIS PHONE. The server stores comment images and serves
 * none of them yet — they sit at `scan_status = 'pending'` until scanning is
 * live — and the local files belong to this phone's owner alone. A caption is
 * shown where a picture-only comment would be, which is the honest rendering.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text } from 'react-native';

import { fetchProfileComments, type Comment } from '@/community-comments';
import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import { getMovies, getShowNames } from '@/db';
import { episodeMeta } from '@/metadata';
import { currentLocale, t } from '@/i18n';
import { slug } from '@/pure';
import { colors, radius, space } from '@/theme';

/**
 * The title a server comment is about, resolved against the local library.
 *
 * The server stores an IDENTITY, not a name: `tvdb:121361` or
 * `title:toy-story-5|1994`. That is right — names are ambiguous and change —
 * but it means the phone has to say what it means, and only the phone has the
 * library to say it with. When it cannot, the key itself is shown rather than
 * a blank: an unrecognised row is still a row somebody wrote.
 */
function targetLabel(c: Comment): string {
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

/** Open what the comment is ABOUT — the episode itself where there is one. */
function openTarget(c: Comment): void {
  if (c.target_source === 'tvdb') {
    const id = Number(c.target_key);
    if (!(id > 0)) return;
    const known = c.season != null && c.episode != null ? episodeMeta(id, c.season, c.episode)?.title : null;
    const unknown = c.episode === 0 && !known;
    router.push(
      c.season != null && c.episode != null && !unknown ? `/episode/${id}-s${c.season}e${c.episode}` : `/show/${id}`,
    );
    return;
  }
  const bare = c.target_key.split('|')[0] ?? '';
  const film = getMovies().find((m) => slug(m.name) === bare);
  if (film) router.push(`/movie/${encodeURIComponent(film.name)}`);
}

/** "2 Apr 2019" — the same short form the archive screen uses. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(currentLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function UserCommentsScreen() {
  const { handle: raw } = useLocalSearchParams<{ handle?: string }>();
  const handle = raw ?? '';
  const [items, setItems] = useState<Comment[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchProfileComments(handle).then((page) => {
      if (cancelled) return;
      setItems(page.items);
      setCursor(page.next_cursor);
    });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  // Paged rather than loaded whole: seven imported years is thousands of rows,
  // and the count band above already says how many there are.
  const more = () => {
    if (!cursor) return;
    const at = cursor;
    setCursor(null);
    void fetchProfileComments(handle, at).then((page) => {
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setCursor(page.next_cursor);
    });
  };

  return (
    <Screen>
      <NavHeader close title={t('profile.statComments')} />
      {items === null ? (
        <ActivityIndicator style={styles.spinner} color={colors.dim} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingBottom: 40 }}
          onEndReachedThreshold={0.5}
          onEndReached={more}
          renderItem={({ item }) => (
            <ContentColumn>
              <Pressable style={styles.row} onPress={() => openTarget(item)}>
                <Text style={styles.where} numberOfLines={1}>
                  {targetLabel(item)}
                </Text>
                {item.body.length > 0 ? (
                  <Text style={styles.body}>{item.body}</Text>
                ) : (
                  <Text style={styles.photo}>{t('community.profile.photoComment')}</Text>
                )}
                <Text style={styles.meta}>{shortDate(item.created_at)}</Text>
              </Pressable>
            </ContentColumn>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  spinner: { marginTop: 60 },
  row: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: space.lg,
    marginTop: 10,
    gap: 6,
  },
  where: { color: colors.yellow, fontSize: 12.5, fontWeight: '800' },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  photo: { color: colors.dim, fontSize: 15, fontStyle: 'italic' },
  meta: { color: colors.faint, fontSize: 12 },
});
