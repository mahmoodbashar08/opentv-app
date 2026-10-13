/**
 * Screen-reader plumbing the screens share.
 *
 * WHY A CARD NEEDS THIS. A `Pressable` is ONE accessibility element: VoiceOver
 * treats it as a leaf and never descends into it, so a ✕ inside a banner, or
 * the "open the show" pill inside a watch-next card, could not be reached at
 * all — the three `ui.dismiss` labels on the profile banners sat on buttons
 * VoiceOver could never land on. The secondary control stays exactly where it
 * is for sighted fingers and is offered to the screen reader as a custom
 * action on the card (iOS: the rotor's Actions; Android: TalkBack's local
 * menu), which is how Mail offers "delete" on a row.
 *
 * Where the nested control is the PRIMARY one — the mark-watched circle on a
 * watch-next card — the card is instead made `accessible={false}` so the
 * circle is a first-class element; see `(tabs)/shows.tsx`.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Platform, type AccessibilityActionEvent } from 'react-native';

import { t } from '@/i18n';

/**
 * Every icon in the app is decoration, said once.
 *
 * An Ionicon is a `Text` holding one private-use glyph, and a screen reader
 * treats it like any other text: a silent stop between every row and its
 * label, and a glyph character glued onto the front of every aggregated
 * button label. Ninety-four files draw them; the one honest place to say
 * "not content" is the component's own defaults. A control that is ONLY an
 * icon gets its words from an explicit `accessibilityLabel` — that is the
 * whole sweep — so hiding the glyph costs nothing it had.
 *
 * `defaultProps` still works for class components, which the icon set is.
 */
export function markIconsDecorative(): void {
  const icon = Ionicons as unknown as { defaultProps?: Record<string, unknown> };
  icon.defaultProps = {
    ...icon.defaultProps,
    accessible: false,
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no',
  };
}

/** Spread onto the element: `{...a11yAction('dismiss', t('ui.dismiss'), dismiss)}`. */
export function a11yAction(name: string, label: string, run: () => void) {
  return {
    accessibilityActions: [{ name, label }],
    onAccessibilityAction: (e: AccessibilityActionEvent) => {
      if (e.nativeEvent.actionName === name) run();
    },
  };
}

/**
 * Out of the screen reader's way, on BOTH platforms.
 *
 * `importantForAccessibility="no-hide-descendants"` is Android-only: iOS
 * ignores it, and `accessible={false}` on a View does not hide what is inside
 * it either. So the initials on a still-less thumb, the "All aired" tag on a
 * poster and a row's › were all read aloud by VoiceOver while TalkBack skipped
 * them (VoiceOver audit, 14 Oct). `accessibilityElementsHidden` is the iOS
 * half; this spreads the two together so neither can be forgotten again.
 */
export function a11yHidden(hidden = true) {
  return hidden
    ? ({ accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as const)
    : ({ accessibilityElementsHidden: false, importantForAccessibility: 'auto' } as const);
}

/**
 * One tab of a row of tabs — TopTabs, the Explore pills.
 *
 * `accessibilityRole="tab"` IS NOTHING ON iOS. React Native 0.86 maps it to no
 * trait at all (`accessibilityPropsConversions.h` knows `tabbar`, not `tab`),
 * so VoiceOver read "ABOUT" as plain text: no button, no tab, no position. The
 * bottom tab bar has the same problem and react-navigation's answer is in its
 * own source — role `button` on iOS ("FIXME: role: 'tab' doesn't seem to work
 * as expected on iOS") and "tab, 2 of 4" spelled into the label. The same
 * here, in the reader's language. Android keeps the real role, which TalkBack
 * does announce.
 */
export function tabA11y(label: string, index: number, count: number, selected: boolean) {
  return Platform.OS === 'ios'
    ? ({
        accessibilityRole: 'button',
        accessibilityLabel: t('a11y.tabOf', { label, n: index + 1, total: count }),
        accessibilityState: { selected },
      } as const)
    : ({ accessibilityRole: 'tab', accessibilityLabel: label, accessibilityState: { selected } } as const);
}
