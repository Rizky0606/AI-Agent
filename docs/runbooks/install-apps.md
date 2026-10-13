# Installable app releases

## Build installers

GitHub Actions → **Build installable apps** → **Run workflow**. Workflow requires repository secret `EXPO_TOKEN` from an authorized Expo account. Android job builds a preview APK using EAS; Windows job builds a self-signed NSIS installer. Download artifacts from the completed Actions run:

- `personal-ai-os-android-apk` → `personal-ai-os.apk`
- `personal-ai-os-windows-installer` → `.exe`

No installer is committed to the repository. No signing secret is required. Windows may show SmartScreen warnings because the installer is not signed by a trusted code-signing certificate.

### Building without GitHub Actions

Both installers can also be produced from the repository checkout, which avoids the `EXPO_TOKEN` secret and the `windows-latest` runner.

Windows NSIS installer, cross-built from Linux aarch64 (no Windows host required):

```bash
cargo install cargo-xwin
rustup target add x86_64-pc-windows-msvc
cd apps/windows
XWIN_CACHE_DIR=/tmp/xwin-cache pnpm exec tauri build --runner cargo-xwin \
  --target x86_64-pc-windows-msvc --bundles nsis
```

Output: `apps/windows/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe`. The bundler skips signing off-Windows.

Android APK:

```bash
cd apps/android
npx expo prebuild --platform android --no-install
cd android
ANDROID_HOME=<sdk> JAVA_HOME=<jdk17> ./gradlew assembleRelease
```

Output: `apps/android/android/app/build/outputs/apk/release/app-release.apk`. On an ARM64 host the Android build-tools `aapt2` is an x86-64 binary, so it needs `binfmt_misc` with `qemu-x86_64-static` plus the amd64 loader (`libc6:amd64`); install both before running Gradle. `apps/android/android/` is generated output and is not committed.

## Android

Transfer APK to device, allow installation from the source used to open it, install. Sign in or create an account. Server defaults to `https://ai.ojixx.my.id`. Updates require installing a later APK. APK sideloading is not Google Play distribution.

## Windows

Run the downloaded `.exe`, accept the Windows SmartScreen warning only after verifying it came from the repository's Actions artifact, then install. Open Personal AI OS — Windows Agent. Server defaults to `https://ai.ojixx.my.id`. Sign in is not built into Windows Agent: get a short-lived access token by signing into Android or calling `/v1/auth/login`, enter it in Settings, keep capabilities off by default, choose an allowed workspace folder, then connect. Token lifetime is short; reconnect after expiry with a fresh token. Do not save, share, or commit the token.

Windows Agent connects as a local device agent. It does not run OMP/Hermes locally and does not receive Android coding-runtime tasks; those run on the VPS.

## Security and production

Rotate previously exposed production secrets before routine use. Do not embed credentials in either installer. Protect artifact downloads and avoid public sharing of personal-server APKs/installers.
