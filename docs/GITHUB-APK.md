# The GitHub APK

Every release tagged `v<version>` gets `OpenTV-<version>.apk` attached by
`.github/workflows/github-apk.yml`. That is what [Komi Store](https://github.com/komi-store/komi-store)
and [Obtainium](https://github.com/ImranR98/Obtainium) install from, and what a
phone without Google Play can download by hand.

**It is a second channel, not a second app.** Same code, same package name,
signed with a key of our own instead of Play's. Android treats two signatures
as two owners, so:

- a phone with the Play version cannot install the GitHub APK over it, and the
  other way round. The installer says "package conflicts" or just fails;
- Plus cannot be bought on it — Google Play Billing does not exist outside Play.
  The paywall says so and points at the Play version (`sideload.*` strings);
- it updates from GitHub Releases, never from Play (`update-gate.tsx`).

Play keeps shipping through EAS (`production` profile, Play App Signing) and
nothing here touches that.

## One-time setup

### 1. The key

Made once, kept for ever. Lose it and every GitHub install is orphaned: a new
key is a new owner, and nobody can update without uninstalling first. Google
has a reset form for a lost Play upload key; GitHub has nothing.

```bash
mkdir -p ~/Keys
keytool -genkeypair -v -keystore ~/Keys/opentv-github.jks -alias opentv \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=OpenTV, O=Insightfy LLC"
```

`keytool` ships with any JDK; without one it is at
`/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool`.
It asks for one password. Modern keystores are PKCS12 and hold one password
for the store and the key alike, so the two password secrets below get the
same value. Keep the file in the password manager too — `*.jks` is gitignored
and must stay that way.

### 2. Fingerprints, or Google sign-in fails on this build

Google checks the signing certificate of the app asking to sign in. The Play
build's certificate is registered; this one's is not, and the failure is the
unhelpful `DEVELOPER_ERROR` (code 10) — the same one `gdrive-backup.ts`
reports as "unauthorised". Google Drive backup goes through the same check, so
this step fixes both.

```bash
keytool -list -v -keystore ~/Keys/opentv-github.jks -alias opentv
```

Copy the `SHA1` and `SHA256` lines, then:

1. Firebase console → Project settings → Your apps → the Android app
   `com.insightfy.opentv` → **Add fingerprint**, once for each. The SHA-1 is
   the one Google sign-in checks (Firebase creates an Android OAuth client in
   the Google Cloud project for it); the SHA-256 is what App Links and App
   Check use. `google-services.json` does not need re-downloading — sign-in
   reads the web client id from `src/auth-config.ts`, not that file.
2. Google Cloud console → APIs & Services → Credentials: the new **Android**
   client for `com.insightfy.opentv` is there now. Add its id to
   `vars.GOOGLE_CLIENT_IDS` in `backend/wrangler.jsonc` (comma-separated, the
   rule in `src/auth-config.example.ts`) and deploy the Worker.

A phone without Google Play services cannot do Google sign-in at all, whatever
key signed the app; on such a phone the community is email sign-up or nothing.

### 3. The secrets

GitHub → the `opentv-app` repository → Settings → Secrets and variables →
Actions. Five, and the workflow refuses to run without the two blobs.

| secret | value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -i ~/Keys/opentv-github.jks \| pbcopy` |
| `ANDROID_KEYSTORE_PASSWORD` | the password from step 1 |
| `ANDROID_KEY_ALIAS` | `opentv` |
| `ANDROID_KEY_PASSWORD` | the same password (PKCS12, see above) |
| `APP_CONFIG_BASE64` | the gitignored config files, see below |

The bundle imports seven files the repository does not carry — the same ones
`.easignore` lets through to EAS. One secret holds them all:

```bash
cd mobile
tar czf - src/tmdb-token.ts src/tvdb-key.ts src/rc-keys.ts src/api-config.ts \
  src/auth-config.ts src/giphy-key.ts src/trakt-keys.ts | base64 | pbcopy
```

Re-run that and paste again whenever one of the keys changes. `.env` is not in
it on purpose: the build does not need it, and `EXPO_PUBLIC_DEV_PLUS_SECRET`
must never reach a public APK.

## Releasing

1. `app.json` → `expo.version` is the new version (it is, if Play's build
   happened first).
2. Tag and push: `git tag v2.0.0 && git push origin v2.0.0`. Creating the
   release in GitHub's UI with a new tag does the same push.
3. Watch the **GitHub APK** run under Actions, ~20–30 minutes. When it ends the
   release for the tag — created with generated notes if none existed, left
   alone otherwise — carries `OpenTV-2.0.0.apk` and `OpenTV-2.0.0.apk.sha256`.
4. Write or tidy the notes. The workflow never changes them.

The tag must be `v` + the version in `app.json`, or the run stops before
building: Obtainium compares the tag to the installed versionName, and Komi
Store looks for the tag's version inside the asset's file name. Both skip
drafts and pre-releases, so a release must be published and ordinary to count.

**Version code.** This channel's is computed from the version — `2.0.0` →
`20000`, `2.0.1` → `20001`, `2.1.0` → `20100` — so it rises with every tag.
Play's is EAS's own counter (`appVersionSource: remote`, double digits). They
never need to agree, because the two channels never update each other. Re-running
the workflow on the same tag replaces the asset but keeps the code, so phones
that already installed it are not offered it again: a broken APK gets a patch
version, not a re-run.

**A build by hand** — `eas build -p android --profile github --local` — makes
the same APK on your Mac, signed with the same key through a `credentials.json`
(gitignored) that names `~/Keys/opentv-github.jks` and its password. It takes
Play's version code, not the tag's, so it is for trying the GitHub build on
your own phone, never for attaching to a release.

## What to tell a user

- **Moving between the two versions** is export → uninstall → install → import:
  Settings → Your data → Export my data, then the other version, then Settings
  → Your data → Import your data. The export is the TV Time-format ZIP and
  merges safely. Nothing is lost if the export happens first; everything is
  lost if it does not.
- **Plus** is bought on the Play version. A subscription already bought there
  follows the community account: signed in on the GitHub build, the server's
  grant applies (`refreshSession`), the store is never asked.
- **Updates** come from GitHub Releases, Komi Store or Obtainium — not Play.
- **Verifying a download:** `sha256sum -c OpenTV-2.0.0.apk.sha256`.

## What only a real run can confirm

Nothing here has been built on a runner yet. The first tag is the test.

1. `npm ci` and `npx expo prebuild --platform android --no-install` on Ubuntu
   (the template downloads from npm on first use).
2. The signing: `apksigner verify --print-certs OpenTV-2.0.0.apk` must show the
   SHA-256 from step 2, not the debug key's. If it shows the debug key, the
   `apply from` in the workflow lost to the generated `build.gradle` and the
   `signingConfig` line needs moving into it with `sed` instead.
3. `EXPO_PUBLIC_DISTRIBUTION` reached the bundle: on the installed APK the
   paywall shows "OpenTV Plus is available in the Google Play version" and no
   buy button.
4. The version code: `aapt dump badging OpenTV-2.0.0.apk | head -1` says
   `versionCode='20000' versionName='2.0.0'`.
5. Google sign-in and Drive backup on that APK, after the fingerprint step.
6. Obtainium: add `https://github.com/mahmoodbashar08/opentv-app`, install, then
   after the next tag it offers the update. Komi Store: search finds OpenTV
   (its index is its own backend and may take time to pick the repo up).
