/**
 * "Message the developer" — one private thread with Noddy (1.6.7).
 *
 * Before this nobody could reach the developer from inside the app: the
 * dashboard's Message was one-way, and the other doors were Discord and
 * Reddit, which most people never open. A reply arrives as a notification
 * whose tap opens this screen (`/support` is in MESSAGE_ROUTES).
 *
 * Needs an account — a reply is addressed to one — so without one this is a
 * sign-in that comes straight back here.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api';
import { getProfileId, getToken } from '@/community-session';
import { NavHeader, Screen } from '@/components/ui';
import { tapLight } from '@/haptics';
import { currentLocale, t } from '@/i18n';
import { colors, space } from '@/theme';

type Msg = { id: number; fromDev: boolean; body: string; at: string };

const MAX = 2000;

export default function SupportScreen() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Msg[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const list = useRef<FlatList<Msg>>(null);
  const signedIn = getProfileId() != null;

  // Re-read on every visit: a reply may have landed since, and the tap on its
  // notification is how most people will arrive here.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      void (async () => {
        const token = await getToken();
        if (!token) return;
        try {
          const r = await api<{ messages: Msg[] }>('/v1/support', { token });
          if (live) setMessages(r.messages);
        } catch {
          if (live) setMessages((m) => m ?? []);
        }
      })();
      return () => {
        live = false;
      };
    }, []),
  );

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const token = await getToken();
      if (!token) return;
      const r = await api<{ message: Msg }>('/v1/support', { method: 'POST', token, body: { body } });
      tapLight();
      setText('');
      setMessages((m) => [...(m ?? []), r.message]);
    } catch {
      Alert.alert(t('support.failedTitle'), t('support.failedBody'));
    } finally {
      setSending(false);
    }
  };

  if (!signedIn) {
    return (
      <Screen>
        <NavHeader title={t('support.title')} close />
        <View style={s.gate}>
          <Ionicons name="chatbubbles-outline" size={40} color={colors.yellow} />
          <Text style={s.gateText}>{t('support.needAccount')}</Text>
          <Pressable style={s.gateCta} onPress={() => router.replace('/sign-in?next=/support')}>
            <Text style={s.gateCtaText}>{t('support.signIn')}</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <NavHeader title={t('support.title')} close />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {messages == null ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.dim} />
        ) : (
          <FlatList
            ref={list}
            data={messages}
            keyExtractor={(m) => String(m.id)}
            contentContainerStyle={s.list}
            onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
            keyboardDismissMode="interactive"
            ListHeaderComponent={<Text style={s.intro}>{t('support.intro')}</Text>}
            renderItem={({ item }) => (
              <View style={[s.bubble, item.fromDev ? s.them : s.me]}>
                {item.fromDev && <Text style={s.from}>{t('support.from')}</Text>}
                <Text style={[s.body, !item.fromDev && s.bodyMe]}>{item.body}</Text>
                <Text style={[s.at, !item.fromDev && s.atMe]}>
                  {new Date(item.at).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' })}
                </Text>
              </View>
            )}
          />
        )}
        <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
          <TextInput
            style={s.input}
            value={text}
            onChangeText={setText}
            placeholder={t('support.placeholder')}
            placeholderTextColor={colors.faint}
            multiline
            maxLength={MAX}
          />
          <Pressable
            style={[s.send, (!text.trim() || sending) && s.sendOff]}
            disabled={!text.trim() || sending}
            accessibilityLabel={t('support.send')}
            onPress={() => void send()}>
            <Ionicons name="arrow-up" size={20} color={colors.onYellow} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const s = StyleSheet.create({
  list: { padding: space.lg, gap: space.sm },
  intro: { color: colors.dim, fontSize: 14, lineHeight: 20, marginBottom: space.md, textAlign: 'center' },
  bubble: { maxWidth: '82%', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 16 },
  me: { alignSelf: 'flex-end', backgroundColor: colors.yellow },
  them: { alignSelf: 'flex-start', backgroundColor: colors.card },
  from: { color: colors.yellow, fontSize: 12, fontWeight: '800', marginBottom: 2 },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  bodyMe: { color: colors.onYellow },
  at: { color: colors.faint, fontSize: 11, marginTop: 4 },
  atMe: { color: 'rgba(0,0,0,0.55)' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, paddingHorizontal: space.md, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.card },
  input: { flex: 1, maxHeight: 140, minHeight: 40, color: colors.text, fontSize: 15, backgroundColor: colors.card, borderRadius: 20, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10 },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.yellow, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.35 },
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  gateText: { color: colors.dim, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  gateCta: { backgroundColor: colors.yellow, borderRadius: 999, paddingVertical: 13, paddingHorizontal: 28 },
  gateCtaText: { color: colors.onYellow, fontSize: 16, fontWeight: '800' },
});
