// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");
const reactNativePlugin = require('eslint-plugin-react-native');

// --- i18n extraction guard ---
// Every user-facing string in this app must come from src/locales/*.json via
// t(), not from a hardcoded literal. These rules exist so that guard doesn't
// rot as new screens are added — see .superpowers/sdd/2026-07-29-localisation
// for the extraction history and why each rule below exists.
const I18N_JSX_ATTRS = '^(title|label|placeholder|subtitle|caption|cta)$';
const MOVE_STRING_MSG =
  "Move this string to src/locales/en.json (and the other locale files) and reference it with t() instead of a hardcoded literal.";

// JSX prop literal: <Foo title="Bar" /> or <Foo title={'Bar'} />. Covers the
// title/label/placeholder/subtitle/caption/cta props that miss #2 (prop
// literals) and miss #4 (navigator `options={{ title: '...' }}` when the
// literal is the prop's own value rather than nested in an object — the
// nested-object case is the Property selector below) escaped through.
const JSX_PROP_SELECTORS = [
  `JSXAttribute[name.name=/${I18N_JSX_ATTRS}/] > Literal[raw=/^['"]/]`,
  `JSXAttribute[name.name=/${I18N_JSX_ATTRS}/] > JSXExpressionContainer > Literal[raw=/^['"]/]`,
];

// Alert.alert('Some sentence', ...) — miss #3. Only matches the direct
// title/message arguments, not strings nested inside the buttons array, to
// avoid drowning in false positives on button config objects.
const ALERT_SELECTOR = "CallExpression[callee.object.name='Alert'][callee.property.name='alert'] > Literal[raw=/^['\"]/]";

// A `title:` or `label:` object property whose value is a capitalised string
// literal — miss #4 (navigator `options={{ title: 'Bar' }}`, where the
// literal is nested inside an object rather than being the prop value
// itself) and miss #5 (module-level constant arrays like the profile-menu
// ITEMS bug). Restricted to a leading capital letter so it does not fire on
// this codebase's convention of lowercase dotted i18n KEYS stored under the
// same property names, e.g. `{ label: 'media.emotions.shocked' }`.
const PROPERTY_SELECTOR = "Property[key.name=/^(title|label)$/] > Literal[raw=/^['\"][A-Z]/]";

// Hardcoded English sentences typed directly as children of <Text>, e.g.
// <Text>Some words</Text> — miss #1 in spirit (a whole screen's copy shipped
// in English), but note react-native/no-raw-text below does NOT catch this
// case: that rule only flags text OUTSIDE a <Text> (an RN crash risk), and
// text properly wrapped in <Text> — hardcoded or not — is invisible to it.
// This is the rule that actually would have caught it. Requires two
// consecutive letters so single-character badge glyphs ('T', 'O', 'X') don't
// trip it, and excludes the literal brand name so `<Text>OpenTV</Text>` /
// `<Text>OPENTV</Text>` isn't flagged — a brand name is not translated copy.
const TEXT_CHILD_SELECTOR =
  "JSXElement[openingElement.name.name='Text'] > JSXText[value=/[A-Za-z]{2,}/]:not([value=/^\\s*(OpenTV|OPENTV|YouTube)\\s*$/])";

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    plugins: {
      'react-native': reactNativePlugin,
    },
    rules: {
      // Structural RN rule: text that is NOT inside an allowed element
      // (Text/TSpan/StyledText/Animated.Text) crashes React Native. It does
      // NOT check whether text properly wrapped in <Text> is translated —
      // that gap is what TEXT_CHILD_SELECTOR below is for. Kept because it's
      // still a real, cheap guard against a different class of bug, and the
      // brief asked for it.
      'react-native/no-raw-text': ['error', { skip: ['Trans'] }],

      'no-restricted-syntax': [
        'error',
        ...[...JSX_PROP_SELECTORS, ALERT_SELECTOR, TEXT_CHILD_SELECTOR].map((selector) => ({
          selector,
          message: `Hardcoded string that looks user-facing. ${MOVE_STRING_MSG}`,
        })),
        {
          selector: PROPERTY_SELECTOR,
          message: `Hardcoded, capitalised string in a title/label object property (this is how the profile-menu ITEMS array shipped in English, and how a navigator's options={{ title: '...' }} would too) — if this is user-facing text, ${MOVE_STRING_MSG} If it is an i18n key string (lowercase, dotted), this rule already ignores it — no action needed.`,
        },
      ],
    },
  },
  {
    // Test fixtures legitimately hold capitalised `title`/`label` values that
    // are not app UI copy — TV show and episode names (e.g. 'Severance',
    // 'Noddy Loses Sixpence') used as sample data. Real app code never
    // hardcodes show/episode titles (INSTRUCTIONS.md: "Don't hardcode
    // show/movie data" — it always comes from import or TMDB), so this
    // exemption cannot hide a real miss; only the object-property selector is
    // dropped here; JSX props and Alert.alert still apply if tests ever grow
    // that shape.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...[...JSX_PROP_SELECTORS, ALERT_SELECTOR].map((selector) => ({
          selector,
          message: `Hardcoded string that looks user-facing. ${MOVE_STRING_MSG}`,
        })),
      ],
    },
  },
]);
