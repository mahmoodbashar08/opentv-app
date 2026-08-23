/**
 * The links on a profile: which services, and where they point.
 *
 * THIS IS THE ONE SCREEN IN THE APP THAT PUBLISHES SOMETHING A USER TYPED.
 * Everything else a profile shows is a fact derived from their own library —
 * a count, a date, a poster. A link is a destination a stranger taps, which
 * makes this a moderation surface rather than a preference, and it is built
 * accordingly:
 *
 *   - the SERVICE is chosen from a list, never typed, so the app always knows
 *     what it is drawing and nothing arbitrary can hide behind an icon;
 *   - the URL must be plain `https://`, checked by `isSafeLinkUrl` here, again
 *     when it is drawn, and again on the phone that opens it;
 *   - the count is capped by the widget's size, because a profile with sixteen
 *     links is not a profile.
 *
 * A user who wants a colour picker and a text box everywhere will find this
 * narrow. That is the trade: the first open text field on a public surface is
 * the first thing abuse finds, and this app is about to be reviewed for an age
 * rating with user-generated content already on it.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { linkServiceIcon } from '@/components/profile-widgets';
import { NavHeader, Screen } from '@/components/ui';
import { getProfileLayout, setProfileLayout } from '@/db';
import { tapLight } from '@/haptics';
import { t } from '@/i18n';
import { newUid, normalise, notifyLayoutSaved, parseLayout, serialise, specOf, type WidgetSpan } from '@/profile-layout';
import {
  isSafeLinkUrl,
  LINK_SERVICES,
  linkCapacity,
  parseProfileLinks,
  serialiseProfileLinks,
  type LinkService,
  type ProfileLink,
} from '@/pure';
import { colors, radius, space } from '@/theme';

/** What a service's URL usually looks like, so the field is not a blank stare. */
const PLACEHOLDER: Record<LinkService, string> = {
  instagram: 'https://instagram.com/you',
  tiktok: 'https://tiktok.com/@you',
  x: 'https://x.com/you',
  youtube: 'https://youtube.com/@you',
  reddit: 'https://reddit.com/user/you',
  discord: 'https://discord.gg/…',
  letterboxd: 'https://letterboxd.com/you',
  website: 'https://…',
};

export default function EditLinksScreen() {
  const { uid, span: spanParam } = useLocalSearchParams<{ uid?: string; span?: string }>();
  /* All three, listed. '2x1' was missing and only worked because the fallback
     happens to be the same value -- a coincidence, not a decision. */
  const span: WidgetSpan =
    spanParam === '1x1' || spanParam === '2x1' || spanParam === '2x2' ? spanParam : specOf('links').span;
  const cap = linkCapacity(span);

  const [links, setLinks] = useState<ProfileLink[]>(() => {
    const items = normalise(parseLayout(getProfileLayout()), []);
    const mine = items.find((i) => i.uid === uid);
    return parseProfileLinks(mine?.data, span);
  });
  const [service, setService] = useState<LinkService>('instagram');
  const [url, setUrl] = useState('');
  /**
   * WHICH LINK THE FIELDS ARE CURRENTLY ABOUT.
   *
   * Null means a new one. Saved links could only be REMOVED before, so a typo
   * in a url cost the whole row and retyping it -- and eight links meant eight
   * chances to pay that. Tapping a row loads it here; the same fields and the
   * same button then change it instead of adding another.
   */
  const [editing, setEditing] = useState<number | null>(null);

  const commit = () => {
    const trimmed = url.trim();
    if (!isSafeLinkUrl(trimmed)) {
      Alert.alert(t('editLinks.badUrlTitle'), t('editLinks.badUrlBody'));
      return;
    }
    tapLight();
    if (editing != null) {
      setLinks((cur) => cur.map((l, i) => (i === editing ? { service, url: trimmed } : l)));
      setEditing(null);
    } else {
      if (links.length >= cap) return;
      setLinks((cur) => [...cur, { service, url: trimmed }]);
    }
    setUrl('');
  };

  const startEditing = (i: number) => {
    tapLight();
    setEditing(i);
    setService(links[i].service);
    setUrl(links[i].url);
  };

  const save = () => {
    const raw = getProfileLayout();
    const items = normalise(parseLayout(raw), []);
    /*
     * NO LINKS MEANS NO WIDGET, and this is a removal rather than an empty save.
     *
     * `renderWidget` draws nothing for an empty list — correctly, since a card
     * labelled "Find me" with nothing under it says nothing. But the block
     * stayed in the LAYOUT, so while arranging it held a slot with a minus
     * badge floating over blank space, and the only way to be rid of it was to
     * find and remove a widget that was invisible. Reported exactly that way:
     * "under favourite movies it shows me an empty widget, I don't know it".
     *
     * So emptying the list is how somebody deletes this widget, which is also
     * what they meant by taking the last link out of it.
     */
    const next =
      links.length === 0
        ? items.filter((i) => i.uid !== uid)
        : items.some((i) => i.uid === uid)
          ? items.map((i) => (i.uid === uid ? { ...i, data: serialiseProfileLinks(links) } : i))
          : // No uid means this is a brand-new widget being added from the picker.
            [...items, { uid: newUid('links'), id: 'links', span, data: serialiseProfileLinks(links) }];
    setProfileLayout(serialise(next, raw));
    notifyLayoutSaved();
    router.back();
  };

  return (
    <Screen>
      <NavHeader title={t('profile.widgetLinks')} close />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={s.note}>{t('editLinks.note', { count: cap })}</Text>

        {links.length > 0 && (
          <View style={s.list}>
            {links.map((l, i) => (
              /* THE ROW IS THE EDIT BUTTON. A separate pencil beside a
                 separate minus on a row this narrow is two small targets where
                 one large one will do. */
              <Pressable
                key={`${l.service}-${i}`}
                style={[s.row, editing === i && s.rowEditing]}
                onPress={() => startEditing(i)}>
                <Ionicons name={linkServiceIcon(l.service)} size={20} color={colors.text} />
                <Text style={s.rowUrl} numberOfLines={1}>
                  {l.url}
                </Text>
                <Pressable
                  hitSlop={10}
                  onPress={() => {
                    tapLight();
                    if (editing === i) {
                      setEditing(null);
                      setUrl('');
                    }
                    setLinks((cur) => cur.filter((_, n) => n !== i));
                  }}>
                  <Ionicons name="remove-circle" size={22} color={colors.danger} />
                </Pressable>
              </Pressable>
            ))}
            {links.length > 0 && <Text style={s.hint}>{t('editLinks.editHint')}</Text>}
          </View>
        )}

        {(links.length < cap || editing != null) && (
          <>
            <Text style={s.label}>{editing != null ? t('editLinks.editHint') : t('editLinks.addOne')}</Text>
            {/* The service is TAPPED, never typed — that is what keeps the icon
                honest and the destination inside a known shape. */}
            <View style={s.services}>
              {LINK_SERVICES.map((sv) => (
                <Pressable
                  key={sv}
                  onPress={() => {
                    tapLight();
                    setService(sv);
                  }}
                  style={[s.service, service === sv && s.servicePicked]}>
                  <Ionicons
                    name={linkServiceIcon(sv)}
                    size={20}
                    color={service === sv ? colors.onYellow : colors.text}
                  />
                </Pressable>
              ))}
            </View>
            <TextInput
              style={s.input}
              value={url}
              onChangeText={setUrl}
              placeholder={PLACEHOLDER[service]}
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onSubmitEditing={commit}
            />
            {/* "Add" and "Update" rather than "Done": this button acts on the
                LINE, and the one at the bottom saves the widget. Two buttons
                both saying done is what made the screen confusing. */}
            <View style={s.actions}>
              <Pressable style={s.add} onPress={commit}>
                <Text style={s.addText}>
                  {editing != null ? t('editLinks.updateButton') : t('editLinks.addButton')}
                </Text>
              </Pressable>
              {editing != null && (
                <Pressable
                  style={s.add}
                  onPress={() => {
                    setEditing(null);
                    setUrl('');
                  }}>
                  <Text style={s.cancelText}>{t('editLinks.cancelEdit')}</Text>
                </Pressable>
              )}
            </View>
          </>
        )}

        <Pressable style={s.save} onPress={save}>
          <Text style={s.saveText}>{t('editLinks.save')}</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  note: { color: colors.dim, fontSize: 13, lineHeight: 19, paddingHorizontal: space.lg, paddingBottom: 8 },
  label: { color: colors.text, fontSize: 13, fontWeight: '800', paddingHorizontal: space.lg, paddingTop: 18, paddingBottom: 8 },
  list: { paddingHorizontal: space.lg, paddingTop: 8, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: radius.card,
    padding: 12,
  },
  rowUrl: { color: colors.dim, fontSize: 13, flex: 1 },
  rowEditing: { borderWidth: 1, borderColor: colors.yellow },
  hint: { color: colors.faint, fontSize: 12, paddingTop: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  cancelText: { color: colors.dim, fontSize: 15, fontWeight: '600' },
  services: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: space.lg },
  service: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  servicePicked: { backgroundColor: colors.yellow },
  input: {
    marginHorizontal: space.lg,
    marginTop: 12,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
  },
  add: { alignSelf: 'flex-start', paddingHorizontal: space.lg, paddingTop: 12 },
  addText: { color: colors.blue, fontSize: 15, fontWeight: '700' },
  save: {
    marginTop: 28,
    marginHorizontal: space.lg,
    backgroundColor: colors.yellow,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
  },
  saveText: { color: colors.onYellow, fontSize: 16, fontWeight: '800' },
});
