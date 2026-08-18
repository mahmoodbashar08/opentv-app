import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { File, Paths } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, I18nManager, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { track } from '@/analytics';
import { ApiError } from '@/api';
import { GifSearch, saveGif, type GifHit } from '@/components/gif-search';
import { TitlePicker } from '@/components/title-picker';
import { appearanceChanged } from '@/community-appearance';
import { isPlus, usePlus } from '@/plus';
import { communityErrorText } from '@/community-error-text';
import { pushProfileTheme } from '@/community-profiles';
import { listsChanged } from '@/community-publish';
import { Screen } from '@/components/ui';
import db, { getCustomLists, getMovies, setListCover, setMeta, getMeta } from '@/db';
import { paletteFromJpeg } from '@/theme-from-art';
import { tmdb } from '@/tmdb';
import { colors, setThemeAccentHex, space } from '@/theme';
import { t } from '@/i18n';


/**
 * TV Time's cover flow: pick one of your shows/movies, then one of its fanart
 * backdrops becomes your profile cover.
 *
 * OR A LIST'S COVER — `?list=<name>` — which is the same two pages, the same
 * artwork sources and the same fallbacks, differing only in where the URL is
 * written at the end. A second picker would have been a second copy of the
 * TheTVDB-then-TMDB ladder, drifting from this one on the first change to
 * either. In list mode the choice is narrowed to that list's own titles: a
 * cover for "Comfort watches" comes from the comfort watches.
 *
 * NOTHING IS DOWNLOADED for a list. The profile cover is written to disk
 * because it is shown before the network is up; a list cover is a URL from the
 * same catalogue every poster on the screen already comes from.
 */
type Item = { key: string; name: string; poster: string | null; kind: 'show' | 'movie'; tvdbId?: number; tmdbId?: number | null };
type Backdrop = { path: string };

export default function CoverPickerScreen() {
  const { list: listParam, theme: themeParam } = useLocalSearchParams<{ list?: string; theme?: string }>();
  const listName = listParam != null ? decodeURIComponent(listParam) : null;
  /**
   * `?theme=1` — the SAME two pages, one extra outcome. The backdrop chosen
   * here becomes the cover exactly as always, AND its palette becomes the
   * published profile theme: the colour is extracted from the very frame the
   * user is looking at, which is what "themed on The Matrix" means. A third
   * picker would have been a third copy of the artwork ladder.
   */
  const themeMode = themeParam === '1' && listName == null;
  /**
   * THE COLOUR FOLLOWS THE PICTURE, WHICHEVER DOOR YOU CAME THROUGH.
   *
   * This used to be `themeMode` — only the Appearance route themed anything,
   * and changing your banner from Edit Profile left the palette of whatever
   * show you picked last month. A banner and a theme that disagree do not read
   * as two settings; they read as broken, and the person who reported it wrote
   * the rule that produced it.
   *
   * A LIST COVER IS STILL EXEMPT. `listName != null` means this is artwork for
   * one list, which is not the profile and must never repaint it.
   */
  const themesProfile = listName == null;
  const { width: W } = useWindowDimensions();
  // this screen's lists run full width (image grid + rows, not prose) — the
  // full-bleed backdrop image sizes off the same raw window width as its
  // full-width row, or it would leave dead space beside it on a tablet
  const CONTENT_W = W;
  const [selected, setSelected] = useState<Item | null>(null);
  const [backdrops, setBackdrops] = useState<Backdrop[] | null>(null);
  const [saving, setSaving] = useState(false);
  // Subscribed, so the GIF tab appears the moment Plus does.
  const plus = usePlus();
  const [tab, setTab] = useState<'art' | 'gif'>('art');
  const [gifSaving, setGifSaving] = useState<string | null>(null);

  /**
   * A moving banner.
   *
   * The cover has always been a file in Documents drawn by `expo-image`, which
   * animates GIFs — so this needs no new rendering anywhere, only a different
   * file behind the same key.
   *
   * NO THEME COLOUR IS TAKEN. `paletteFromJpeg` reads a JPEG; a GIF is not one,
   * and a theme derived from whatever those bytes happened to decode to would
   * be worse than none. Artwork themes a profile; a GIF moves it.
   */
  const chooseGif = async (hit: GifHit) => {
    if (gifSaving) return;
    setGifSaving(hit.id);
    try {
      const name = await saveGif(hit, 'profile-cover');

      /*
       * THE THEME, FROM A STILL FRAME OF THE GIF.
       *
       * A GIF banner used to leave the palette alone, because `paletteFromJpeg`
       * needs JPEG bytes and nothing here can decode a GIF. GIPHY publishes one
       * frame of every GIF as an actual photograph (`480w_still`, a .jpg), so
       * the colours can come out of the banner somebody actually chose rather
       * than out of a decoder this app would otherwise have to grow.
       *
       * Best effort: a theme that fails must not cost somebody their banner.
       * The GIF is saved by the time this runs, and a frame with no usable
       * colour -- a greyscale one -- simply leaves the theme as it was.
       */
      if (themesProfile && isPlus() && hit.still) {
        try {
          const stillRes = await fetch(hit.still);
          if (stillRes.ok) {
            const stillBytes = new Uint8Array(await stillRes.arrayBuffer());
            const { accent, secondary } = paletteFromJpeg(stillBytes);
            if (accent != null) {
              await pushProfileTheme(accent);
              setMeta('profileThemeColor', accent);
              setMeta('profileThemeSecondary', secondary ?? '');
              setMeta('profileThemeName', '');
              setThemeAccentHex(accent);
              track('profile_theme_set', { on: 1 });
            }
          }
        } catch {
          /* the banner is set; the colour can wait for another pick */
        }
      }
      const old = getMeta('coverFile');
      /*
       * THE STILL ONE IS KEPT, NOT DELETED — unlike every other cover change,
       * where the old file goes because nothing will ever want it again.
       *
       * A GIF banner is Plus. When a subscription lapses the profile has to
       * stop animating, and falling back to no banner at all would read as a
       * loss rather than as a feature ending. So the artwork underneath waits
       * here, and a resubscribe puts the GIF straight back.
       */
      if (old && !old.toLowerCase().endsWith('.gif')) setMeta('coverStillFile', old);
      setMeta('coverFile', name);
      setMeta('coverUrl', hit.full);
      appearanceChanged();
      router.back();
    } catch (err) {
      Alert.alert(t('pickGif.failedTitle'), err instanceof Error ? err.message : String(err));
    } finally {
      setGifSaving(null);
    }
  };

  const items = useMemo<Item[]>(() => {
    if (listName != null) {
      // The list's OWN titles. A show carries the id it is keyed by, so the
      // TheTVDB path below works unchanged; a film has only a name, and
      // `tmdbId` is looked up from the movies table where there is one.
      const list = getCustomLists().find((l) => l.name === listName);
      const byName = new Map(getMovies().map((m) => [m.name, m.tmdbId]));
      return (list?.items ?? []).map((it, i) => ({
        key: `${it.kind}${it.tvdbId ?? it.name}${i}`,
        name: it.name,
        poster: it.poster,
        kind: it.kind,
        ...(it.tvdbId != null ? { tvdbId: it.tvdbId } : {}),
        tmdbId: byName.get(it.name) ?? null,
      }));
    }
    const shows = db
      .getAllSync<{ tvdbId: number; name: string; posterUrl: string | null }>('SELECT tvdbId, name, posterUrl FROM shows')
      .map((s) => ({ key: `s${s.tvdbId}`, name: s.name, poster: s.posterUrl, kind: 'show' as const, tvdbId: s.tvdbId }));
    const movies = getMovies().map((m) => ({
      key: `m${m.name}`,
      name: m.name,
      poster: m.poster,
      kind: 'movie' as const,
      tmdbId: m.tmdbId,
    }));
    return [...shows, ...movies].sort((a, b) => a.name.localeCompare(b.name));
  }, [listName]);

  const openItem = async (item: Item) => {
    setSelected(item);
    setBackdrops(null);
    // TheTVDB first — a tracked show already carries the id it is keyed by,
    // so there is no lookup, and it returns full URLs rather than paths
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const t = require('@/tvdb') as typeof import('@/tvdb');
      if (item.kind === 'show' && item.tvdbId != null) {
        const art = await t.tvdbArtworks(item.tvdbId, 'series', t.TVDB_ART_BACKGROUND, 40);
        if (art.length) {
          setBackdrops(art.map((url) => ({ path: url })));
          return;
        }
      }
    } catch {
      // fall through to TMDB
    }
    try {
      let tmdbId = item.tmdbId ?? null;
      const kind: 'tv' | 'movie' = item.kind === 'show' ? 'tv' : 'movie';
      if (item.kind === 'show' && item.tvdbId != null) {
        const found = await tmdb<{ tv_results: { id: number }[] }>(`/find/${item.tvdbId}?external_source=tvdb_id`);
        tmdbId = found.tv_results?.[0]?.id ?? null;
      }
      if (tmdbId == null) {
        setBackdrops([]);
        return;
      }
      const res = await tmdb<{ backdrops: { file_path: string; vote_count?: number }[] }>(`/${kind}/${tmdbId}/images`);
      const sorted = [...(res.backdrops ?? [])]
        .sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0))
        .slice(0, 40)
        .map((b) => ({ path: `https://image.tmdb.org/t/p/w1280${b.file_path}` }));
      setBackdrops(sorted);
    } catch {
      setBackdrops([]);
    }
  };

  const pick = async (path: string) => {
    if (saving) return;
    // A LIST COVER IS JUST THE URL. Nothing to fetch, nothing to write to disk,
    // nothing to clean up after — so it is saved and the screen is gone before
    // the profile path's first `await`.
    if (listName != null) {
      setListCover(listName, path);
      track('list_cover_set');
      listsChanged();
      router.back();
      return;
    }
    setSaving(true);
    try {
      // `path` is a full URL now — TheTVDB's own, or the TMDB one built above
      const res = await fetch(path);
      if (!res.ok) throw new Error('download failed');
      const bytes = new Uint8Array(await res.arrayBuffer());
      // unique filename per change — expo-image caches by uri
      const name = `profile-cover-${Date.now()}.jpg`;
      const old = getMeta('coverFile');
      const dest = new File(Paths.document, name);
      if (dest.exists) dest.delete();
      dest.write(bytes);
      setMeta('coverFile', name);
      setMeta('coverUrl', path);
      /*
       * THE THEME STEP IS PLUS, AND ITS ABSENCE IS SILENT.
       *
       * A free user picking artwork asked for a banner and gets one. They are
       * not told their colour could not be saved, because they did not ask for
       * a colour and nothing they asked for failed — and an app that reports a
       * refusal nobody triggered is an advert wearing an error's clothes.
       *
       * `isPlus()` and not the hook: this is a handler, not render.
       */
      if (themesProfile && isPlus()) {
        /**
         * The theme, from the bytes already in hand — no second download. The
         * server is told FIRST: it is the copy every visitor reads, and a
         * publish that fails must fail the pick loudly rather than let this
         * phone believe in a theme nobody else sees. A greyscale frame yields
         * no colour and says so.
         */
        // BOTH COLOURS FROM ONE DECODE. The second is what stops the theme
        // reading as a filter: one hue used for every accent on a page is a
        // tint, two in different roles is an identity. Null for artwork that
        // genuinely has one colour, and the profile falls back to the primary.
        const { accent, secondary } = paletteFromJpeg(bytes);
        if (accent == null) {
          // ONLY WHEN THEY CAME TO SET A COLOUR. From Edit Profile the request
          // was "change my banner", and it succeeded — telling somebody their
          // picture has no usable colour is an answer to a question they did
          // not ask, about something that did not fail.
          if (themeMode) Alert.alert(t('plus.appearance.noColourTitle'), t('plus.appearance.noColourBody'));
        } else {
          /*
           * THE COLOUR FAILING MUST NOT BE REPORTED AS THE BANNER FAILING.
           *
           * `coverFile` is written above, so by the time this runs the banner
           * HAS changed. Letting a rejected theme fall through to the outer
           * catch produced "Could not set cover" over a cover that was sitting
           * there, correctly, behind the alert — and the real reason, that the
           * server does not believe this account is Plus, was printed
           * underneath a heading that contradicted it.
           *
           * The server is still told FIRST and still decides: a phone must not
           * keep a theme nobody else can see, and the entitlement check belongs
           * on the server precisely because a client can lie about it.
           */
          try {
            await pushProfileTheme(accent);
          } catch (e) {
            Alert.alert(
              t('coverPicker.coverSetThemeFailedTitle'),
              e instanceof ApiError ? communityErrorText(e) : t('coverPicker.coverSetThemeFailedBody'),
            );
            appearanceChanged();
            router.back();
            return;
          }
          setMeta('profileThemeColor', accent);
          setMeta('profileThemeSecondary', secondary ?? '');
          setMeta('profileThemeName', selected?.name ?? '');
          // ONE CHOICE MOVES EVERYTHING. Theming a profile on a show and then
          // finding the app still painted in the old accent — a pink bell on a
          // blue profile — is two settings where the user thought they had
          // one. The profile changes now because it is data; the app follows
          // on the next launch because it is a stylesheet.
          setThemeAccentHex(accent);
          track('profile_theme_set', { on: 1 });
        }
      }
      // STRAIGHT TO THE SERVER, not on the next launch. Writing meta and
      // waiting for a foreground cycle is how the lists behaved before
      // `listsChanged()` existed, and it looks identical from the outside: you
      // pick a banner, everybody else keeps seeing the old header, and nothing
      // anywhere says why. Fire and forget — it is fingerprinted, so a second
      // call costs one `getMeta`.
      appearanceChanged();
      if (old) {
        try {
          const f = new File(Paths.document, old);
          if (f.exists) f.delete();
        } catch {}
      }
      router.back();
    } catch (err) {
      Alert.alert(
        t('coverPicker.couldNotSetCoverTitle'),
        err instanceof ApiError ? communityErrorText(err) : err instanceof Error ? err.message : String(err),
      );
    } finally {
      setSaving(false);
    }
  };

  // ---- page 2: the chosen title's fanart ---------------------------------------
  if (selected) {
    return (
      <Screen>
        <View style={styles.head}>
          <Pressable onPress={() => setSelected(null)} hitSlop={8}>
            <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.headTitle} numberOfLines={1}>
            {selected.name}
          </Text>
          <View style={{ width: 24 }} />
        </View>
        {backdrops == null ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.yellow} />
          </View>
        ) : backdrops.length === 0 ? (
          <View style={styles.center}>
            <Text style={{ color: colors.dim, fontSize: 15 }}>{t('coverPicker.noArtwork')}</Text>
          </View>
        ) : (
          <FlatList
            data={backdrops}
            keyExtractor={(b) => b.path}
            contentContainerStyle={{ paddingHorizontal: space.lg, gap: 14, paddingBottom: 40, paddingTop: 8 }}
            renderItem={({ item }) => (
              <Pressable onPress={() => pick(item.path)} disabled={saving}>
                <Image
                  source={{ uri: item.path }}
                  style={{ width: CONTENT_W - 2 * space.lg, aspectRatio: 16 / 9, borderRadius: 4, backgroundColor: colors.raise }}
                  contentFit="cover"
                />
              </Pressable>
            )}
          />
        )}
        {saving && (
          <View style={[StyleSheet.absoluteFill as object, styles.center, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
            <ActivityIndicator color={colors.yellow} size="large" />
          </View>
        )}
      </Screen>
    );
  }

  // ---- page 1: your shows and movies, searchable --------------------------------
  return (
    <Screen>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headTitle}>
          {listName != null ? t('plus.lists.chooseCover') : t('editProfile.chooseCover')}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {/*
        TWO TABS, NOT A LINK TO ANOTHER SCREEN.
        
        The GIF search used to be a push from here, and this screen is presented
        over the profile — so the pushed one rendered UNDERNEATH it, the same
        transparent-modal trap that has caught three screens on this branch. A
        tab has no stack to get wrong, and it says the true thing anyway: these
        are two sources for one choice, not two places.
        
        Profile only. A list cover is a still by design; a screen of lists all
        animating would flicker.
      */}
      {/*
        THE GIF TAB IS NOT SHOWN WITHOUT PLUS, rather than shown and refused.
        It used to be there for everybody and answered a tap with the paywall,
        which reads as the app dangling something; and a free user choosing
        artwork does not need to be told twice what they cannot have. The
        Appearance screen is where Plus is offered, once.
      */}
      {listName == null && plus && (
        <View style={styles.tabs}>
          {(['art', 'gif'] as const).map((k) => (
            /* A MOVING BANNER IS PLUS, a still one is not — the same line the
               profile theme already draws. Both are cosmetics other people see;
               choosing a cover at all is not. */
            <Pressable
              key={k}
              style={[styles.tab, tab === k && styles.tabOn]}
              // The row only exists for a Plus user now, so there is nothing
              // left to refuse here.
              onPress={() => setTab(k)}>
              <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>
                {k === 'art' ? t('coverPicker.tabArt') : t('pickGif.gif')}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {tab === 'gif' && listName == null ? (
        <GifSearch onPick={(h) => void chooseGif(h)} busyId={gifSaving} />
      ) : (
      <>
      {/* THE SHARED LIST. Both tabs choose a title the same way and differ only
          in what happens next — artwork opens this title's fanart, GIF searches
          for its name. */}
      <TitlePicker
        items={items}
        empty={listName != null ? t('plus.lists.coverNeedsItems') : undefined}
        onPick={openItem}
      />
      </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    gap: 12,
  },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: space.lg, paddingBottom: 10 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.card },
  tabOn: { backgroundColor: colors.yellow },
  tabText: { color: colors.dim, fontSize: 14, fontWeight: '700' },
  tabTextOn: { color: colors.onYellow },
  headTitle: { color: colors.text, fontSize: 17, fontWeight: '600', flex: 1, textAlign: 'center' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2E',
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 17, paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1B1B1E',
  },
  thumb: { width: 46, height: 68, borderRadius: 3, backgroundColor: colors.raise },
  rowName: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
