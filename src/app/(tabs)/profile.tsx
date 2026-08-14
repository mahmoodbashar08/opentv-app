import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, I18nManager, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Image } from 'expo-image';

import { icloudAvailableAsync, icloudSupported } from '@/backup';
import { dismissCommunityBanner, useCommunityBannerDismissed } from '@/community-prompt';
import { fetchProfile, pushHiddenSections, type PublicProfile } from '@/community-profiles';
import { ApiError } from '@/api';
import { getHandle, signOutLocally, useJoined } from '@/community-session';
import { Heatmap, monthOf, todayISO } from '@/components/heatmap';
import { PeriodSheet } from '@/components/period-picker';
import { SectionHeader } from '@/components/profile-sections';
import { tapLight } from '@/haptics';
import { manualBackupOverdue, shareLibraryExport } from '@/manual-backup';
import { EmptyState, MenuRow } from '@/components/ui';
import { asProfileLayout, type ProfileLayout, ProfileTemplate } from '@/components/profile-template';
import seed from '@/seed';
import { getCommentCount, getCustomLists, getFavoriteMovies, getFavoriteShows, getMeta, getMovies, getShowProgress, getTotals, setMeta } from '@/db';
import { tvdbKeyFailed, userTvdbKey } from '@/tvdb';
import { isSeedLibrary, profileImageUri } from '@/library';
import { clockOf, computeMovieStats, watchDayCounts } from '@/stats-calc';
import { enableEpisodeNotifications, notificationsEnabled } from '@/notifications';
import { requirePlus, usePlus, usePlusUi } from '@/plus';
import { HIDDEN_SECTIONS_KEY, PRIVATE_PROFILE_KEY, RECONNECT_SEEN_KEY, asHiddenSections, halfEnd, mergedFollowTotal, parseHiddenSections, reconnectBannerCount, sectionHidden, sortLists, topBanner, WRAPPED_SEEN_KEY, wrappedToOffer } from '@/pure';
import { lastFriendMatches } from '@/community-seed';
import { colors, onAccent, radius, space } from '@/theme';
import { currentLocale, monthYear, t } from '@/i18n';
import { formatCount, formatPeriod } from '@/locale-resolve';

const { profile } = seed;

// your real TV Time cover + avatar, rescued from the export into the bundle
const COVER = require('../../../assets/profile/cover.jpg');
const AVATAR = require('../../../assets/profile/avatar.jpg');

// Profile is the one screen NOT wrapped in ContentColumn: it is a dashboard of
// bands and shelves with no prose to protect, so a 700pt column would leave
// half a 13" iPad black while showing FEWER posters than a phone does. The
// geometry that follows from that — poster widths, the list collage, the
// collapsing cover — lives in `components/profile-template.tsx`, which draws
// this screen and everybody else's profile from the same code.

// live from the database — un/marking anything updates these
function movieClockNow() {
  const m = computeMovieStats();
  return { watched: m.watched, ...m.clock };
}

export default function ProfileScreen() {
  // Shows row: the SAME order as the all-shows grid (most recent watch first),
  // so the two screens never disagree. Shows sharing a watch timestamp break
  // the tie by episode count; shows never watched (no date) fall to the end.
  const recentShows = getShowProgress()
    .filter((sp) => (sp.lastWatchedAt ?? sp.addedAt) != null)
    .sort(
      (a, b) =>
        (b.lastWatchedAt ?? '').localeCompare(a.lastWatchedAt ?? '') ||
        Math.max(b.watched, b.episodesSeen) - Math.max(a.watched, a.episodesSeen),
    );
  // re-read the db each time the tab regains focus (photo/name edits, new watches)
  const [, setTick] = useState(0);
  // gentle nudge when the library has no delete-proof copy — re-checked on
  // focus so it disappears right after the user turns iCloud on
  const [cloudOff, setCloudOff] = useState(false);
  // Android has no iCloud auto-backup — nudge to export instead, only when
  // there's new un-exported data (clears right after an export)
  const [backupOverdue, setBackupOverdue] = useState(false);
  // one-time nudge when the app's shared TheTVDB key stops working and the user
  // hasn't added their own — dismissible, and clears itself if the key recovers
  const [tvdbFailed, setTvdbFailed] = useState(false);
  // reminders off — the third possible banner. Re-read on focus so it clears
  // as soon as they're switched on from Settings.
  const [notifOff, setNotifOff] = useState(false);
  // The community half of this screen, when there is one. The handle is read
  // synchronously from `meta` (it is already on the device); the counts are the
  // one thing only the server knows, so they arrive after a round trip and the
  // row simply shows the handle until they do.
  const [community, setCommunity] = useState<PublicProfile | null>(null);
  // Read on focus into state, never in render: the Compiler memoises a bare
  // getMeta() against its arguments and the swatch picked in Appearance would
  // not appear here until a full relaunch. See CLAUDE.md.
  const [themeColor, setThemeColor] = useState<string | null>(() => getMeta('profileThemeColor') || null);
  // The partner colour, when the artwork had one. See `secondaryAccent`.
  const [themeSecondary, setThemeSecondary] = useState<string | null>(() => getMeta('profileThemeSecondary') || null);
  // A padlock beside the name. The switch is three screens away in Edit
  // profile, so without this the only way to know it is still on is to go and
  // look — which is a poor state for a privacy control to leave somebody in.
  const [isPrivate, setIsPrivate] = useState(() => getMeta(PRIVATE_PROFILE_KEY) === '1');
  // Read on focus, never in render: a walk of every watch date is not a thing
  // to repeat on each re-render, and the Compiler would cache it stale anyway.
  const [dayCounts, setDayCounts] = useState<Map<string, number>>(() => new Map());
  // In state rather than read during render: the lint rule against reading the
  // clock in render is right, and the grid only has to be correct per focus.
  const [today, setToday] = useState(todayISO);
  // Which month the grid is showing. Starts at the current one and is NOT
  // reset on focus — coming back from a show should not throw away the month
  // somebody navigated to.
  // The half of the year today is in — Jan–Jun or Jul–Dec — not "the last six
  // months", which is six months of nothing in particular and slides under the
  // reader every month.
  const [heatEnd, setHeatEnd] = useState(() => halfEnd(monthOf(todayISO())));
  const [profileLayout, setProfileLayout] = useState<ProfileLayout>(() => asProfileLayout(getMeta('profileThemeLayout')));
  /**
   * The reconnection matches and how many of them have been acknowledged, in
   * ONE piece of state so they cannot disagree with each other for a frame.
   *
   * In state and re-read on focus, not read during render, for the reason the
   * swatch above gives: the Compiler memoises a bare `getMeta` against its
   * arguments, and `setTick` does not invalidate it — so a banner dismissed
   * here, or matches found by the screen this banner opens, would go on
   * showing the old answer until a relaunch. See CLAUDE.md.
   */
  const [friendState, setFriendState] = useState(() => ({
    matches: lastFriendMatches(),
    seen: getMeta(RECONNECT_SEEN_KEY),
  }));
  /**
   * ACTIVITY, SWITCHED OFF IN EDIT PROFILE.
   *
   * The one entry in `hidden_sections` that acts here rather than on a
   * visitor's screen, and it has to: the heatmap is never published, so there
   * is no public Activity band for the server to withhold. Hidden means hidden
   * from the only person who can see it — which is exactly what somebody who
   * hands their phone to a friend is asking for.
   *
   * Read on focus into state, never in render, for the reason the swatch above
   * gives: the Compiler memoises a bare `getMeta`.
   */
  const [pickingPeriod, setPickingPeriod] = useState(false);
  const [activityHidden, setActivityHidden] = useState(() =>
    sectionHidden(parseHiddenSections(getMeta(HIDDEN_SECTIONS_KEY)), 'activity'),
  );
  // Only for a joined profile: without an account there is no joining date to
  // state, and the local library's age is a different fact.
  const joinedLabel = community?.created_at ? t('profile.joined', { date: monthYear(community.created_at) }) : null;
  useFocusEffect(
    useCallback(() => {
      setTick((t) => t + 1);
      setThemeColor(getMeta('profileThemeColor') || null);
      setThemeSecondary(getMeta('profileThemeSecondary') || null);
      setIsPrivate(getMeta(PRIVATE_PROFILE_KEY) === '1');
      setDayCounts(watchDayCounts());
      setToday(todayISO());
      setProfileLayout(asProfileLayout(getMeta('profileThemeLayout')));
      setActivityHidden(sectionHidden(parseHiddenSections(getMeta(HIDDEN_SECTIONS_KEY)), 'activity'));
      setFriendState({ matches: lastFriendMatches(), seen: getMeta(RECONNECT_SEEN_KEY) });
      setTvdbFailed(tvdbKeyFailed() && !userTvdbKey() && getMeta('tvdbNudgeDismissed') !== '1');
      setNotifOff(!notificationsEnabled() && getMeta('notifyNudgeDismissed') !== '1');
      if (icloudSupported()) {
        void icloudAvailableAsync()
          .then((on) => setCloudOff(!on))
          .catch(() => {});
      } else {
        setBackupOverdue(manualBackupOverdue());
      }
      // A no-op when not joined: `fetchProfile` needs a handle there is none
      // of, and it never rejects into this screen.
      const handle = getHandle();
      if (handle) {
        void fetchProfile(handle)
          .then((p) => {
            setCommunity(p);
            /**
             * MIRROR WHAT THE SERVER SAYS ABOUT US, so the switches in Edit
             * profile and Settings are right on their first frame — offline
             * included, and on a phone that has just signed in to an account
             * whose privacy was set somewhere else. The server is the
             * authority; these two keys are only its echo.
             */
            setMeta(PRIVATE_PROFILE_KEY, p.is_private ? '1' : '');
            setMeta(HIDDEN_SECTIONS_KEY, JSON.stringify(asHiddenSections(p.hidden_sections)));
          })
          .catch((e: unknown) => {
            /**
             * THE ONLY PLACE A DELETED ACCOUNT CAN BE NOTICED.
             *
             * `signOutLocally()` is otherwise reached only from the `write()`
             * wrappers, on `unauthenticated`. Neither half of that fires when an
             * account is deleted server-side, which is what moderation does:
             * the session token is verified with zero I/O (see
             * backend/src/middleware.ts) so it stays cryptographically valid,
             * and the handler then finds no row and answers `not_found` — which
             * is not `needsSignIn`. Reads swallow it, this catch swallowed it,
             * and the phone went on claiming to be signed in until the token
             * expired. `community-session.ts` says the mismatch "resolves
             * itself"; it does not, and this is where it now does.
             *
             * ONLY FOR YOUR OWN HANDLE, which is what `getHandle()` returns. A
             * 404 for somebody else means they blocked you, you blocked them,
             * or they are gone — none of which says anything about your
             * session, and signing you out for it would be a stranger's account
             * ending yours.
             *
             * Everything else — a tunnel, a captive portal, a 502 — still falls
             * through to the handle alone, which is true and still tappable.
             */
            if (e instanceof ApiError && e.code === 'not_found') void signOutLocally();
          });
      }
    }, []),
  );

  // Only ONE banner at a time: three stacked yellow bars read as nagging.
  // Ordered by what ignoring it costs — see topBanner.
  const banner = topBanner({ cloudOff, backupOverdue, notificationsOff: notifOff });
  // Deliberately NOT part of topBanner's one-at-a-time rule: that rule ranks
  // three warnings about data the user could lose, and this is an invitation.
  // Shown to anyone not already in the community who has not closed it —
  // including someone who tapped "Not now", for whom this is the way back.
  // Both hooks read unconditionally — `&&` between two hook calls would
  // short-circuit the second and break the rules of hooks.
  const joinedCommunity = useJoined();
  const communityDismissed = useCommunityBannerDismissed();
  const communityBanner = !joinedCommunity && !communityDismissed;

  const turnOnReminders = () => {
    void enableEpisodeNotifications()
      .then((ok) => {
        if (ok) {
          setNotifOff(false);
          return;
        }
        // iOS already has a "no" on file — the prompt cannot be shown again
        Alert.alert(
          t('settings.app.notificationsOffTitle'),
          t('profile.notifOffBody'),
          [
            { text: t('common.later'), style: 'cancel' },
            { text: t('common.openSettings'), onPress: () => void Linking.openSettings() },
          ],
        );
      })
      .catch(() => {});
  };

  const exportBackup = () => {
    Alert.alert(
      t('profile.backupTitle'),
      t('profile.backupBody'),
      [
        { text: t('common.later'), style: 'cancel' },
        {
          text: t('profile.exportNow'),
          onPress: () =>
            void shareLibraryExport()
              .then(() => setBackupOverdue(false))
              .catch((err) => Alert.alert(t('settings.data.exportFailedTitle'), err instanceof Error ? err.message : String(err))),
        },
      ],
    );
  };

  const movieClock = movieClockNow();
  const totals = getTotals();
  const tvClock = clockOf(totals.minutes);
  const recentMovies = getMovies().filter((m) => m.watchedAt != null);
  // a locally-created profile name overrides the imported one
  const username = getMeta('username') ?? profile.username;
  // seed content stays in the bundle; imported libraries carry their own
  // favorites (from the export's favorite lists) and downloaded photos.
  // a photo chosen in Edit profile wins over both.
  const seedLib = isSeedLibrary();
  // Render-safe subscription, so a purchase or a restore flips the chip on this
  // screen without a navigation — see the React Compiler note in `plus.ts`.
  const plus = usePlus();
  const plusUi = usePlusUi();
  const avatarUri = profileImageUri('avatar');
  const coverUri = profileImageUri('cover');
  // favorites in your original TV Time order (all 9, incl. untracked shows)
  const favShows = seedLib
    ? seed.favoriteShows
    : getFavoriteShows().map((s) => ({ tvdbId: s.tvdbId, name: s.name, poster: s.posterUrl }));
  type PosterItem = { name: string; poster: string | null };
  const favMovies: PosterItem[] = seedLib ? seed.favoriteMovies.items : getFavoriteMovies();
  // EVERY list, in the order the Lists screen shows them — the band is a pager.
  // PINNED FIRST, here too. The band draws the first list, and a pin that only
  // moved a row on the Lists screen would leave the profile — the place the pin
  // is FOR — showing a different one.
  const allLists = sortLists(seedLib ? seed.lists : getCustomLists(), 'custom');
  // social counts: imported libraries carry their own (friend.csv + the
  // followers mined from notifications + the comments table)
  /** The archive's people, as `mergedFollowTotal` wants them. */
  const metaPeople = (key: string): { id: string }[] => {
    try {
      const rows = JSON.parse(getMeta(key) ?? '[]') as { id?: unknown }[];
      return Array.isArray(rows) ? rows.filter((r) => typeof r?.id === 'string').map((r) => ({ id: r.id as string })) : [];
    } catch {
      return [];
    }
  };
  const metaLen = (key: string) => {
    try {
      return (JSON.parse(getMeta(key) ?? '[]') as unknown[]).length;
    } catch {
      return 0;
    }
  };
  /**
   * THE ONLY "you" in the app.
   *
   * These three used to be the imported TV Time numbers and nothing else,
   * while a second screen showed the server's — so a joined user had two
   * profiles that disagreed, and the community one said "0 followers" to
   * somebody with eight. There is one profile now: this band, counting the
   * merged list that `/following` actually shows (see `mergedFollowTotal`).
   *
   * A user who has NOT joined keeps exactly what they had — their own import,
   * read from this phone, with no request made and nothing on a server to ask
   * about. That is the promise, and it is why these are conditionals rather
   * than a single server read.
   */
  const archiveFollowing = metaPeople('tvtimeFollowingNames');
  const archiveFollowers = metaPeople('tvtimeFollowers');
  const matches = friendState.matches;
  const serverCounts = joinedCommunity ? (community?.counts ?? null) : null;

  const followingCount = seedLib
    ? profile.following
    : serverCounts
      ? mergedFollowTotal(archiveFollowing, matches, serverCounts.following)
      : metaLen('tvtimeFriends');
  const followersCount = seedLib
    ? profile.followers
    : serverCounts
      ? mergedFollowTotal(archiveFollowers, matches, serverCounts.followers)
      : metaLen('tvtimeFollowers');
  /**
   * NEVER THE SMALLER OF THE TWO.
   *
   * The server's count is the archive's plus anything written on another
   * device, so once the upload has caught up it is the complete number. But it
   * arrives a moment after the screen paints, and until then the local count is
   * shown — so a server number that is temporarily LOWER (an upload still in
   * flight, a phase that has not run yet) made the figure count DOWN in front
   * of the user: 4 comments on open, 3 a heartbeat later. That reads as "my
   * comments are disappearing", which is the one thing an archive app must
   * never say.
   *
   * Taking the larger is honest in both directions: the local rows exist on
   * this phone whatever the server currently holds, and anything the server
   * knows beyond them is real too.
   */
  /**
   * THE NUMBER THE SCREEN BELOW IT DRAWS, and nothing else.
   *
   * This used to be `max(local, server)`, which was two disagreements wearing
   * one number: the server counts replies and the archive does not, and a
   * comment written in the app reached the server before it reached the phone.
   * So it read five over a list of four, and jumped from four to five while the
   * backfill landed. `addOwnComment` and `syncOwnComments` keep the archive
   * complete now, so the local count is the honest one.
   */
  const commentCount = seedLib ? profile.comments : getCommentCount();

  /**
   * The banners. Owner-only — they are prompts to fix something on THIS phone,
   * so there is nothing to say about them on somebody else's profile.
   */
  /**
   * LAST MONTH'S RECAP, offered on the owner's own profile from the 1st.
   *
   * On the profile rather than as a push because it is a nice thing, not an
   * urgent one, and it belongs where the rest of somebody's own numbers are.
   * Owner-only for free: `banners` is a slot a public profile never fills.
   */
  const offerMonth = wrappedToOffer(today, getMeta(WRAPPED_SEEN_KEY));
  const dismissWrapped = () => {
    if (offerMonth != null) setMeta(WRAPPED_SEEN_KEY, offerMonth);
    setTick((n) => n + 1);
  };

  /**
   * FRIENDS FROM TV TIME WHO ARE HERE NOW.
   *
   * Counted, not flagged: dismissing at two matches must not silence the news
   * when a third arrives. `reconnectBannerCount` holds that rule, and opening
   * the screen stamps the same key, so reading the list counts as being told.
   */
  const reconnectCount = reconnectBannerCount(matches.length, friendState.seen);
  const dismissReconnect = () => {
    const seen = String(matches.length);
    setMeta(RECONNECT_SEEN_KEY, seen);
    setFriendState((s) => ({ ...s, seen }));
  };

  const banners = (
    <>
      {reconnectCount > 0 && (
        <Pressable
          style={styles.wrappedBanner}
          onPress={() => {
            tapLight();
            dismissReconnect();
            router.push('/reconnect');
          }}>
          <Text style={styles.wrappedEmoji}>👋</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.wrappedTitle}>
              {t('community.reconnect.bannerTitle', { count: reconnectCount })}
            </Text>
            <Text style={styles.wrappedBody}>{t('community.reconnect.bannerBody')}</Text>
          </View>
          {/* Its own hit area, like Wrapped's: dismissing must not open the
              thing being dismissed. */}
          <Pressable onPress={dismissReconnect} hitSlop={12}>
            <Ionicons name="close" size={18} color={colors.dim} />
          </Pressable>
        </Pressable>
      )}
      {offerMonth != null && (
        <Pressable
          style={styles.wrappedBanner}
          onPress={() => {
            tapLight();
            dismissWrapped();
            router.push(`/wrapped?month=${offerMonth}`);
          }}>
          <Text style={styles.wrappedEmoji}>🎬</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.wrappedTitle}>
              {t('plus.wrapped.readyTitle', { period: formatPeriod(offerMonth, currentLocale()) })}
            </Text>
            <Text style={styles.wrappedBody}>{t('plus.wrapped.readyBody')}</Text>
          </View>
          {/* Its own hit area: dismissing must not open the thing being
              dismissed, which is what a single tappable row would do. */}
          <Pressable onPress={dismissWrapped} hitSlop={12}>
            <Ionicons name="close" size={18} color={colors.dim} />
          </Pressable>
        </Pressable>
      )}
      {banner === 'cloud' && (
        <Pressable
          style={styles.cloudBanner}
          onPress={() =>
            Alert.alert(
              t('profile.turnOnIcloudTitle'),
              t('profile.turnOnIcloudBody'),
              [
                { text: t('common.later'), style: 'cancel' },
                { text: t('common.openSettings'), onPress: () => void Linking.openSettings() },
              ],
            )
          }>
          <Ionicons name="cloud-offline-outline" size={18} color={colors.onYellow} />
          <Text style={styles.cloudBannerText}>{t('profile.cloudBannerText')}</Text>
          <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={colors.onYellow} />
        </Pressable>
      )}
      {banner === 'backup' && (
        <Pressable style={styles.cloudBanner} onPress={exportBackup}>
          <Ionicons name="save-outline" size={18} color={colors.onYellow} />
          <Text style={styles.cloudBannerText}>{t('profile.backupBannerText')}</Text>
          <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={colors.onYellow} />
        </Pressable>
      )}
      {banner === 'notifications' && (
        <Pressable style={styles.cloudBanner} onPress={turnOnReminders}>
          <Ionicons name="notifications-off-outline" size={18} color={colors.onYellow} />
          <Text style={styles.cloudBannerText}>{t('profile.notifBannerText')}</Text>
          <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={colors.onYellow} />
        </Pressable>
      )}
      {communityBanner && (
        <Pressable
          style={styles.cloudBanner}
          onPress={() => {
            tapLight();
            router.push('/join');
          }}>
          <Ionicons name="people-outline" size={18} color={colors.onYellow} />
          <Text style={styles.cloudBannerText}>{t('community.banner.text')}</Text>
          <Pressable
            hitSlop={10}
            onPress={() => {
              dismissCommunityBanner();
              setTick((n) => n + 1);
            }}>
            <Ionicons name="close" size={17} color={colors.onYellow} />
          </Pressable>
        </Pressable>
      )}
      {tvdbFailed && (
        <Pressable style={styles.cloudBanner} onPress={() => router.push('/tvdb-key')}>
          <Ionicons name="key-outline" size={18} color={colors.onYellow} />
          <Text style={styles.cloudBannerText}>{t('profile.tvdbBannerText')}</Text>
          <Pressable
            hitSlop={10}
            onPress={() => {
              setMeta('tvdbNudgeDismissed', '1');
              setTvdbFailed(false);
            }}>
            <Ionicons name="close" size={17} color={colors.onYellow} />
          </Pressable>
        </Pressable>
      )}
    </>
  );

  /**
   * YOUR profile, drawn by the SAME component that draws everybody else's.
   *
   * See `components/profile-template.tsx`. What this screen supplies is the
   * data — read from SQLite — and the actions: the bell, the ••• menu, Edit.
   * The layout is not written here any more, which is the only way the promise
   * "their profile looks exactly like mine" survives the next change to either.
   */
  return (
    <ProfileTemplate
      coverUri={coverUri}
      coverSource={seedLib ? COVER : null}
      username={username}
      // LOCAL TRUTH FIRST. The entitlement is known on this phone the moment a
      // purchase lands, offline and before any server round trip — waiting for
      // `is_plus` to come back would mean paying and seeing nothing change.
      plus={plus}
      /**
       * THE THEME IS A SUBSCRIPTION, NOT A PURCHASE, so it stops applying when
       * the subscription does. The chosen colour and layout are NOT deleted --
       * they stay in meta and on the server, so resubscribing brings the
       * profile straight back rather than asking somebody to pick it all again
       * as a punishment for having lapsed.
       *
       * Rendering it for a non-supporter was the state this screen was in, and
       * it made the tier meaningless: one paid month bought the look for ever.
       * Wrapped already gated its accent this way; the profile did not, so the
       * same person's cards and profile disagreed about whether they were a
       * supporter.
       */
      themeColor={plus ? themeColor : null}
      themeSecondary={plus ? themeSecondary : null}
      /* THE SERVER'S ANSWER FIRST, the mirrored key second. `PRIVATE_PROFILE_KEY`
         is an echo of the server (see the fetch above) and is written a frame
         after the profile arrives, so reading it alone left the padlock missing
         on the launch that fetched the profile — the launch somebody is most
         likely to be checking on. */
      isPrivate={joinedCommunity && (community?.is_private ?? isPrivate)}
      layout={plus ? profileLayout : 'classic'}
      joined={joinedLabel}
      avatar={
        avatarUri != null ? (
          <Image source={{ uri: avatarUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : seedLib ? (
          <Image source={AVATAR} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <Text style={{ color: colors.yellow, fontSize: 26, fontWeight: '800' }}>
            {username[0]?.toUpperCase() ?? '?'}
          </Text>
        )
      }
      pill={
        <Pressable style={styles.editPill} onPress={() => router.push('/edit-profile')}>
          <Text style={styles.editText}>{t('profile.edit')}</Text>
        </Pressable>
      }
      // NO BADGE. The only thing it ever counted was the community inbox,
      // which is gone (see app/notifications.tsx); the TV Time archive is
      // history and has nothing unread by definition.
      // THE THEME, NOT THE ACCENT. The app accent is painted at launch, so a
      // profile themed a minute ago would still have a bell in the old colour
      // until a relaunch — on the one screen where the new colour is already
      // everywhere else. Reading the profile theme here makes the header agree
      // with the page under it immediately.
      barLeft={
        <Pressable
          style={[styles.bell, plus && themeColor != null && { backgroundColor: themeColor }]}
          onPress={() => router.push('/notifications')}>
          <Ionicons
            name="notifications-outline"
            size={21}
            color={plus && themeColor != null ? onAccent(themeColor) : colors.onYellow}
          />
        </Pressable>
      }
      barRight={
        <Pressable hitSlop={8} onPress={() => router.push('/profile-menu')}>
          <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
        </Pressable>
      }
      banners={banners}
      cells={[
        {
          key: 'following',
          value: String(followingCount),
          label: t('profile.statFollowing'),
          onPress: () => router.push('/following'),
        },
        {
          key: 'followers',
          value: String(followersCount),
          label: t('profile.statFollowers'),
          onPress: () => router.push('/following?type=followers'),
        },
        {
          key: 'comments',
          value: String(commentCount),
          label: t('profile.statComments'),
          onPress: () => router.push('/comments'),
        },
      ]}
      statsCards={[
        { key: 'tv', title: t('profile.tvTimeCard'), kind: 'clock', ...tvClock },
        {
          key: 'eps',
          title: t('profile.episodesWatchedCard'),
          kind: 'number',
          value: formatCount(totals.episodes, currentLocale()),
        },
        { key: 'mv', title: t('profile.movieTimeCard'), kind: 'clock', ...movieClock },
        { key: 'mvn', title: t('profile.moviesWatchedCard'), kind: 'number', value: String(movieClock.watched) },
      ]}
      onStatsPress={() => router.push('/stats')}
      /**
       * ACTIVITY — the heatmap, and the door to the timeline. Own profile only:
       * see the note on the prop. Hidden by a preference the user owns, because
       * a year of evenings is the kind of thing somebody may not want on screen
       * when they hand their phone to a friend.
       */
      activity={
        !plusUi ? undefined : (
        <>
          {/* ONE SWITCH, ONE SOURCE. The inline Hide used to write its own
              `heatmapHidden` key while Edit profile wrote `hidden_sections`,
              so the two could disagree — and hiding it there took away the
              section's own Hide button, leaving no way back from this screen.
              Both now toggle the same 'activity' key, and the header stays put
              so the decision is always reversible from where it was made. */}
          <SectionHeader
            title={t('plus.activity.title')}
            action={activityHidden ? t('plus.activity.show') : t('plus.activity.hide')}
            onPress={() => {
              tapLight();
              const next = !activityHidden;
              setActivityHidden(next);
              const sections = parseHiddenSections(getMeta(HIDDEN_SECTIONS_KEY));
              const updated = next
                ? [...new Set([...sections, 'activity'])]
                : sections.filter((k) => k !== 'activity');
              setMeta(HIDDEN_SECTIONS_KEY, JSON.stringify(updated));
              // Fire and forget: 'activity' changes nothing a visitor can see —
              // the heatmap is never published — but keeping the server's copy
              // in step means Edit profile shows the same answer.
              void pushHiddenSections(updated).catch(() => {});
            }}
          />
          {/* HIDING TAKES THE WHOLE SECTION, heatmap and timeline both. Hiding
              "Activity" and being left with a row that opens every episode you
              have ever watched is not hiding anything. */}
          {!activityHidden && (
            <>
              {plus ? (
                <Heatmap
                  counts={dayCounts}
                  accent={(plus ? themeColor : null) ?? colors.yellow}
                  endMonth={heatEnd}
                  onEndMonth={setHeatEnd}
                  today={today}
                  maxMonth={halfEnd(monthOf(today))}
                />
              ) : (
                <MenuRow
                  trackId="plus.activity.locked"
                  title={t('plus.activity.plusRow')}
                  sub={t('plus.activity.plusRowSub')}
                  onPress={() => requirePlus('heatmap')}
                />
              )}
              <MenuRow
                trackId="timeline.entry"
                title={t('timeline.entry')}
                sub={t('timeline.entrySub')}
                onPress={() => router.push('/timeline')}
              />
              {/* Wrapped opens a PERIOD first, not the screen: "your July" and
                  "your 2025" are different things and the row cannot guess
                  which one was meant. Gated here and again inside the screen. */}
            </>
          )}
        </>
        )
      }
      // ALWAYS PRESENT, and always opening the INDEX. It used to be hidden
      // whenever the first list had no posters, and to jump straight into that
      // one list when it did — so the Lists screen, which holds the only
      // "Create a new list" button and the only view of the others, was
      // unreachable from anywhere in the app.
      list={{
        lists: allLists.map((l) => ({
          name: l.name,
          items: (l.items ?? []) as PosterItem[],
          onPress: () => router.push(`/lists/${encodeURIComponent(l.name)}`),
        })),
        onSeeAll: () => router.push('/lists'),
      }}
      shelves={[
        {
          key: 'shows',
          title: t('stats.headers.shows'),
          items: recentShows.map((sp) => ({ key: String(sp.tvdbId), name: sp.name, uri: sp.posterUrl })),
          onTitlePress: () => router.push('/all-shows'),
          onItemPress: (k: string) => router.push(`/show/${k}`),
        },
        {
          key: 'fav-shows',
          title: t('profile.sectionFavoriteShows'),
          heart: true,
          items: favShows.map((f) => ({ key: String(f.tvdbId), name: f.name, uri: f.poster })),
          onTitlePress: () => router.push('/favorites/shows'),
          onItemPress: (k: string) => router.push(`/show/${k}`),
        },
        {
          key: 'movies',
          title: t('stats.headers.movies'),
          items: recentMovies.map((m) => ({ key: m.name, name: m.name, uri: m.poster })),
          onTitlePress: () => router.push('/all-movies'),
          onItemPress: (k: string) => router.push(`/movie/${encodeURIComponent(k)}`),
        },
        {
          key: 'fav-movies',
          title: t('profile.sectionFavoriteMovies'),
          heart: true,
          items: favMovies.map((m, i) => ({ key: `${m.name}-${i}`, name: m.name, uri: m.poster })),
          onTitlePress: () => router.push('/favorites/movies'),
          onItemPress: (k: string) => router.push(`/movie/${encodeURIComponent(k.replace(/-\d+$/, ''))}`),
        },
      ]}>
      {/* A fresh library used to render "Shows ›" and "Movies ›" over nothing,
          so the very first screen a new user sees was two headings pointing at
          empty lists. Every shelf is gated on having content, so an empty
          library reaches here with nothing above it — point it somewhere. */}
      {recentShows.length === 0 && recentMovies.length === 0 && (
        <EmptyState
          title={t('profile.emptyTitle')}
          caption={t('profile.emptyCaption')}
          cta={t('profile.emptyCta')}
          onPress={() => router.push('/search')}
        />
      )}
      {/* A Modal, so where it sits in the tree does not matter — only that it
          is mounted while the tab is. */}
      <PeriodSheet
        visible={pickingPeriod}
        onClose={() => setPickingPeriod(false)}
        onPick={(key) => {
          setPickingPeriod(false);
          router.push(key.length === 4 ? `/wrapped?year=${key}` : `/wrapped?month=${key}`);
        }}
      />
    </ProfileTemplate>
  );
}

const styles = StyleSheet.create({
  bell: {
    width: 31.5,
    height: 31.5,
    borderRadius: 15.75,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editPill: {
    alignSelf: 'flex-start',
    marginTop: 5,
    borderWidth: 1.5,
    borderColor: colors.text,
    borderRadius: radius.pill,
    paddingVertical: 3,
    paddingHorizontal: 12,
  },
  editText: { color: colors.text, fontSize: 12.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  cloudBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.yellow,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
  },
  cloudBannerText: { color: colors.onYellow, fontSize: 13, fontWeight: '700', flex: 1 },
  // Card, not yellow: a recap is an invitation, and the yellow banners above
  // it are all "something on this phone needs fixing".
  wrappedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    marginHorizontal: space.lg,
    marginBottom: 10,
    padding: 14,
    borderRadius: radius.card,
  },
  wrappedEmoji: { fontSize: 24 },
  wrappedTitle: { color: colors.text, fontSize: 14.5, fontWeight: '800' },
  wrappedBody: { color: colors.dim, fontSize: 12.5, marginTop: 2 },
});
