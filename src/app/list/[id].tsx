/**
 * A published list, from the community.
 *
 * NOT `lists/[id]` — that route is the user's OWN lists, which live in SQLite,
 * are editable, and are keyed by name. This one is somebody else's, lives on
 * the server, is read-only, and is keyed by the server's id. Two different
 * things that happen to share a word, kept as two routes rather than one screen
 * with a mode flag.
 *
 * THE TITLES ARE DENORMALISED, and rendering leans on that entirely. Every item
 * carries the title it had when it was added, so a list of films this device
 * has never heard of reads correctly on the first frame, offline, with no TMDB
 * lookup. That is the whole reason the column exists server-side, and adding a
 * metadata fetch here would quietly undo it.
 *
 * EVERY REFUSAL IS THE SAME 404 — private, deleted owner, blocked in either
 * direction, or never existed. The id space must not become an oracle, so this
 * screen has exactly one thing to say about all four.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api';
import { fetchList, type ListDetail } from '@/community-profiles';
import { SortablePosterGrid } from '@/components/sortable-poster-grid';
import { ContentColumn, NavHeader, Screen } from '@/components/ui';
import { t } from '@/i18n';
import { movieRoute, commentErrorKey } from '@/pure';
import { colors, space } from '@/theme';

type State =
  | { phase: 'loading' }
  | { phase: 'missing' }
  | { phase: 'failed'; message: string }
  | { phase: 'ready'; list: ListDetail };

export default function CommunityListScreen() {
  const { id: raw } = useLocalSearchParams<{ id?: string }>();
  const id = raw ?? '';
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void fetchList(id)
      .then((list) => {
        if (!cancelled) setState({ phase: 'ready', list });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const code = e instanceof ApiError ? e.code : 'unknown';
        setState(
          code === 'not_found' ? { phase: 'missing' } : { phase: 'failed', message: t(commentErrorKey(code)) },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.phase === 'loading') {
    return (
      <Screen>
        <NavHeader close />
        <ActivityIndicator style={styles.spinner} color={colors.dim} />
      </Screen>
    );
  }

  if (state.phase !== 'ready') {
    return (
      <Screen>
        <NavHeader close />
        <View style={styles.notFound}>
          <Text style={styles.notFoundEmoji}>📄</Text>
          <Text style={styles.notFoundText}>
            {state.phase === 'missing' ? t('community.list.notFound') : state.message}
          </Text>
        </View>
      </Screen>
    );
  }

  const list = state.list;

  /**
   * OPEN WHAT WAS TAPPED. Somebody else's list is a recommendation — the whole
   * point is to go and look at the thing — and the rows were inert, so the
   * screen was a wall you could read and not use.
   */
  const openItem = (it: { kind: 'show' | 'movie'; name: string; tvdbId?: number }) => {
    if (it.kind === 'show' && it.tvdbId != null) {
      router.push(`/show/${it.tvdbId}`);
      return;
    }
    router.push(movieRoute(it.name) as never);
  };

  return (
    <Screen>
      <NavHeader title={list.name} close />
      {/* THE SAME GRID THE OWNER'S OWN LIST DRAWS — `SortablePosterGrid` with
          both edit affordances off. Somebody else's list was a numbered list of
          words while your own was a wall of posters, which made the same object
          look like two different features. Read-only here: no ✕ badges, no
          drag, because it is not yours to change.

          Already ordered by position server-side; the client does not re-sort,
          because the order IS the list and second-guessing it would make two
          devices disagree about somebody else's arrangement. */}
      <ScrollView contentContainerStyle={styles.content}>
        <ContentColumn>
          <Text style={styles.by}>{t('community.list.by', { handle: list.owner.handle })}</Text>
          {list.description != null && list.description.length > 0 && (
            <Text style={styles.desc}>{list.description}</Text>
          )}
          <Text style={styles.count}>{t('community.list.items', { count: list.items.length })}</Text>
        </ContentColumn>
        {list.items.length === 0 ? (
          <ContentColumn>
            <Text style={styles.empty}>{t('community.list.empty')}</Text>
          </ContentColumn>
        ) : (
          <SortablePosterGrid
            items={list.items.map((it) => ({
              kind: it.target_source === 'tvdb' ? ('show' as const) : ('movie' as const),
              name: it.title ?? it.target_key,
              poster: it.poster,
              ...(it.target_source === 'tvdb' && Number(it.target_key) > 0
                ? { tvdbId: Number(it.target_key) }
                : {}),
            }))}
            editing={false}
            draggable={false}
            onOpen={openItem}
            onRemove={() => {}}
            onReorder={() => {}}
          />
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  spinner: { marginTop: 60 },
  content: { paddingBottom: 32 },

  notFound: { alignItems: 'center', gap: 14, marginTop: 80, paddingHorizontal: 40 },
  notFoundEmoji: { fontSize: 44 },
  notFoundText: { color: colors.dim, fontSize: 15.5, textAlign: 'center', lineHeight: 21 },

  by: { color: colors.dim, fontSize: 14, paddingHorizontal: space.lg, paddingTop: 4 },
  desc: { color: colors.text, fontSize: 15, lineHeight: 21, paddingHorizontal: space.lg, marginTop: 10, textAlign: 'left' },
  count: { color: colors.faint, fontSize: 12.5, paddingHorizontal: space.lg, marginTop: 10, marginBottom: 6 },
  empty: { color: colors.faint, fontSize: 14, textAlign: 'center', marginTop: 40 },

});
