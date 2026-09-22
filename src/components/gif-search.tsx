/**
 * GIF search, and the only place in the app that sends a query to a third party.
 *
 * Shows do not come with GIFs — TheTVDB and TMDB carry posters and stills,
 * nothing animated — so the only source of "a GIF of this show" is a GIF
 * service, and the query has to go to it. That is a real exception to how this
 * app behaves, so it is SAID here, above the search box, not buried in a
 * policy. Nobody who never opens this ever contacts GIPHY.
 *
 * GIPHY AND NOT TENOR, and not for taste: Tenor's API was shut down for good on
 * 30 June 2026. `rating=g` on every request — these land on public profiles,
 * and an age-rating review with user-picked imagery is strict exactly here.
 *
 * ONE COMPONENT, TWO CALLERS: the widget picker and the banner picker. Two
 * copies of a screen that talks to a third party is two places to get the
 * content rating wrong.
 *
 * NO FREE TYPING. The search term is always the name of something in the user's
 * own library, chosen from a list, the way the poster picker works. Two reasons,
 * and the second is the important one:
 *
 *   - it is what people want anyway — "a GIF of the thing I watch" — and typing
 *     a title you already own is work the app can do for you;
 *   - an open text box is an open text box. Whatever GIPHY returns for an
 *     arbitrary phrase ends up on a public profile, and `rating=g` is a filter,
 *     not a guarantee. Restricting the query to titles somebody actually tracks
 *     narrows the result space to roughly "screenshots of television".
 */

import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { CONTENT_MAX_WIDTH } from '@/components/ui';
import { titleChoices } from '@/db';
import { GIPHY_API_KEY } from '@/giphy-key';
import { t } from '@/i18n';
import { colors, radius, space } from '@/theme';

/**
 * `still` is a JPEG frame of the GIF, which GIPHY serves as `480w_still` -- and
 * it is the whole reason a moving banner can carry a theme. `paletteFromJpeg`
 * needs JPEG bytes, nothing in this app can decode a GIF to pixels, and adding
 * a decoder to read one frame would be absurd when the service already
 * publishes that frame as a photograph.
 */
export type GifHit = { id: string; preview: string; full: string; still: string };

export function GifSearch({ onPick, busyId }: { onPick: (hit: GifHit) => void; busyId?: string | null }) {
  /*
   * THERE IS NO `mode` ANY MORE, and the reason it went is worth keeping.
   *
   * Two of the three screens made you choose a show from your own library
   * before you were allowed to look at anything; the third handed you an open
   * text box. The restriction had a written reason and it was a real one --
   * an open text box is an open text box, whatever GIPHY returns for an
   * arbitrary phrase can end up on a public profile, and `rating=g` is a
   * filter rather than a guarantee.
   *
   * But COMMENTS ARE PUBLIC TOO and already had the open box. So the rule
   * actually in force was not "protect the public surfaces", it was
   * "whichever screen was written last". A rule kept in two places out of
   * three protects nobody; it is just inconsistent, and the inconsistency was
   * paid for by everyone who wanted a GIF of something that is not a show.
   *
   * So the box is everywhere and the protection moved to where it can work:
   * the asset is approved once, not the person, every time. The titles are
   * still here -- as one-tap suggestions above the results, which is what they
   * were useful as. They are no longer a gate.
   */
  const W = Math.min(useWindowDimensions().width, CONTENT_MAX_WIDTH);
  const cell = (W - space.lg * 2 - 8) / 2;

  /* Read once into state, never during render: the React Compiler memoises a
     render-time call against its arguments, and this one takes none. */
  const [titles] = useState(() => titleChoices().map((c) => ({ key: c.ref, name: c.name, poster: c.uri })));
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<GifHit[]>([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const q = query;
    if (timer.current) clearTimeout(timer.current);
    /*
     * EVERY STATE CHANGE GOES THROUGH THE TIMER, including clearing.
     *
     * Setting state synchronously inside an effect makes React render, run the
     * effect again and render again — cheap here, but the lint rule is right
     * that it is a habit worth not having, and the debounce was already the
     * natural place for it. One path in, one path out.
     */
    timer.current = setTimeout(() => {
      if (!GIPHY_API_KEY) {
        setHits([]);
        setBusy(false);
        return;
      }
      setBusy(true);
      /*
       * AN EMPTY BOX SHOWS WHAT IS TRENDING rather than nothing. A grid of
       * GIFs invites a tap; a blank screen with a search field asks somebody
       * to think of a word first, which is the harder start.
       */
      const url = q.trim()
        ? 'https://api.giphy.com/v1/gifs/search' +
          `?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(q.trim())}` +
          '&limit=24&rating=g'
        : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=24&rating=g`;
      type GiphyImage = { url?: string };
      type GiphyHit = {
        id: string;
        images?: {
          fixed_width?: GiphyImage;
          downsized?: GiphyImage;
          original?: GiphyImage;
          '480w_still'?: GiphyImage;
        };
      };
      fetch(url)
        .then((r) => r.json())
        .then((j: { data?: GiphyHit[] }) => {
          setHits(
            (j.data ?? [])
              .map((r) => ({
                id: r.id,
                preview: r.images?.fixed_width?.url ?? '',
                // `downsized` is capped around 2 MB; `original` can be tens.
                // A profile widget does not need the tens.
                full: r.images?.downsized?.url ?? r.images?.original?.url ?? '',
                still: r.images?.['480w_still']?.url ?? '',
              }))
              .filter((h) => h.preview && h.full),
          );
        })
        .catch(() => setHits([]))
        .finally(() => setBusy(false));
    }, 60);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  if (!GIPHY_API_KEY) return <Text style={s.empty}>{t('pickGif.noKey')}</Text>;

  // ── step two: its GIFs ────────────────────────────────────────────────────
  return (
    <>
      <TextInput
        style={s.search}
        value={query}
        onChangeText={setQuery}
        placeholder={t('pickGif.searchPlaceholder')}
        placeholderTextColor={colors.faint}
        autoCorrect={false}
        returnKeyType="search"
      />
      {/* WHAT THE GATE BECAME. The same titles, one tap, and skippable --
          useful to somebody who does want a GIF of the show they are decorating
          a widget with, and invisible to somebody who does not. */}
      {!query.trim() && titles.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {titles.slice(0, 12).map((c) => (
            <Pressable key={c.key} style={s.chip} onPress={() => setQuery(c.name)}>
              <Text style={s.chipText} numberOfLines={1}>
                {c.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <Text style={s.notice}>{!query.trim() ? t('pickGif.trending') : t('pickGif.notice')}</Text>
      {busy && hits.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.dim} />
      ) : hits.length === 0 ? (
        <Text style={s.empty}>{t('pickGif.none')}</Text>
      ) : (
        <FlatList
          data={hits}
          keyExtractor={(h) => h.id}
          numColumns={2}
          contentContainerStyle={{ padding: space.lg, gap: 8 }}
          columnWrapperStyle={{ gap: 8 }}
          renderItem={({ item }) => (
            <Pressable onPress={() => onPick(item)} style={{ width: cell }}>
              <Image source={{ uri: item.preview }} style={[s.gif, { width: cell }]} contentFit="cover" />
              {busyId === item.id && (
                <View style={s.savingVeil}>
                  <ActivityIndicator color={colors.text} />
                </View>
              )}
            </Pressable>
          )}
        />
      )}
    </>
  );
}

/**
 * Download a chosen GIF into Documents and return its filename.
 *
 * THE FILE IS KEPT, NOT THE URL. A CDN link is a lease — the picture must
 * survive the CDN reorganising, the phone being offline, and the service being
 * dropped some day (Tenor proves how real that is). Everything else the profile
 * owns lives in Documents; so does this.
 */
export async function saveGif(hit: GifHit, prefix: 'widget-gif' | 'profile-cover'): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
  const res = await fetch(hit.full);
  const buf = new Uint8Array(await res.arrayBuffer());
  const name = `${prefix}-${Date.now()}.gif`;
  new File(Paths.document, name).write(buf);
  return name;
}

const s = StyleSheet.create({
  chips: { flexDirection: 'row', gap: 8, paddingHorizontal: space.lg, paddingBottom: 10 },
  chip: {
    maxWidth: 170,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  chipText: { color: colors.dim, fontSize: 13, fontWeight: '600' },
  notice: { color: colors.faint, fontSize: 12, paddingHorizontal: space.lg, paddingBottom: 10 },
  search: {
    marginHorizontal: space.lg,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 16,
  },
  empty: { color: colors.dim, fontSize: 15, padding: space.xl, lineHeight: 21 },
  gif: { aspectRatio: 1, borderRadius: 8, backgroundColor: colors.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: 38, height: 57, borderRadius: 4, backgroundColor: colors.card },
  rowName: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1 },
  savingVeil: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
});
