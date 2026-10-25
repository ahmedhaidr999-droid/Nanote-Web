# Nanote (Web) — the complete browser app as an independent Android APK

Nanote is a local-first handwriting notes app: pressure-sensitive pens, highlighters,
shapes, rulers, text, images, PDF import & annotation, synced audio notes, edge tabs
with nested folders, tags, search, laser pointer (normal + timed), long-press PDF text
selection with highlight / underline / copy, a full translation platform (online engines
+ downloadable offline language packs), PDF/PNG export and `.nanote` backups.
**100% free — no accounts, no analytics. Notes never leave the device; the only
internet use is translation, and only when the user asks for it.**

The APK is an INDEPENDENT platform: the browser version of this repo is the
feature-staging platform where features are tested before being ported to the app.
The app itself is packaged with Capacitor: the WebView serves the static export from
local assets (`https://localhost`), so ink, audio, PDF, exports and backups behave
identically to the browser.

- App ID: `com.nanote.web`
- Min Android: 7.0 (API 24) · Target: 36
- Permissions: microphone (voice notes; requested on first use), internet (translation
  engines + language-pack downloads — nothing else ever goes online), vibrate
  (haptic tick on long-press word selection). Storage is UNLIMITED on the device's disk.

## Install & updates · التثبيت والتحديث

**English**
1. Download `Nanote-vX.Y.Z-release.apk` from [Releases](../../releases).
2. Install it (allow "install unknown apps" once if your browser asks).
3. Future versions: just download the newer APK and install it **over** the old one —
   your notes stay exactly where they are. No uninstall needed, ever.
4. Inside the app: Settings → About → *Check for updates* opens the releases page.

**العربية**
1. حمّل ملف `Nanote-vX.Y.Z-release.apk` من صفحة [الإصدارات](../../releases).
2. ثبّته (اسمح بـ«تثبيت تطبيقات غير معروفة» مرة واحدة إذا طلب المتصفح).
3. التحديثات القادمة: حمّل الإصدار الأحدث وثبّته **فوق** القديم مباشرة —
   ملاحظاتك تبقى كما هي تماماً. لا حاجة للحذف أبداً.
4. داخل التطبيق: الإعدادات ← حول ← «التحقق من التحديثات» يفتح صفحة الإصدارات.

> Keep the release signing key safe: it is stored in GitHub Secrets (`NANOTE_*`).
> A different key would force users to uninstall first — with the same key every
> release updates in place.

## Releasing a new version (maintainer)

1. Update `package.json` `version` **and** `src/lib/nanote/version.ts` `APP_VERSION` to the same `X.Y.Z`.
2. Commit to `main`, then tag and push:
   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
3. CI builds, signs and publishes the release automatically. The `versionCode` is
   `X*10000 + Y*100 + Z` — always increasing, so Android installs over the old version.

## Building locally

```bash
bun install
bun run build          # static export → out/
bunx cap sync android
cd android && ./gradlew assembleDebug
```

## Project layout

- `src/` — the whole app (features, editor engine, ink codec, i18n EN/AR)
- `android/` — Capacitor Android platform (app icon, splash, signing, versioning)
- `scripts/gen-android-icons.ts` — regenerates launcher icons from `src/app/icon.svg`
- `.github/workflows/apk.yml` — build → sign → release pipeline
