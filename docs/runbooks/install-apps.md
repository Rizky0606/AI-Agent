# Installable app releases

## Build installers

GitHub Actions → **Build installable apps** → **Run workflow**. Both jobs build from source with no repository secret: Android runs `expo prebuild` plus `gradlew assembleRelease` on `ubuntu-latest`, Windows runs `tauri build --bundles nsis` on `windows-latest`. Download artifacts from the completed Actions run:

- `personal-ai-os-android-apk` → `personal-ai-os.apk`
- `personal-ai-os-windows-installer` → `.exe`

No installer is committed to the repository. No signing secret is required. Windows may show SmartScreen warnings because the installer is not signed by a trusted code-signing certificate, and the APK carries the debug keystore.

### Building without GitHub Actions

Both installers can also be produced from the repository checkout, which avoids the `windows-latest` runner and lets an aarch64 host do the work.

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
rm -rf /tmp/metro-cache /tmp/metro-file-map-*
EXPO_PUBLIC_API_URL=https://ai.ojixx.my.id EXPO_PUBLIC_WS_URL=wss://ai.ojixx.my.id \
  ANDROID_HOME=<sdk> JAVA_HOME=<jdk17> \
  ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

The environment values may also live in `apps/android/.env` (gitignored; `.env.example` documents the keys), which is what `@expo/cli export:embed` reads.

Output: `apps/android/android/app/build/outputs/apk/release/app-release.apk`.

Four things the local path needs spelled out:

- `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_WS_URL` are inlined at bundle time. Without them the APK falls back to `http://10.0.2.2:3000` (`apps/android/src/api/config.ts`), which only works on an emulator host.
- Metro caches the transformed module, so the inlined literal is frozen at the value present when the cache entry was created. Changing `.env` and rebuilding without clearing `/tmp/metro-cache` silently ships the old URL. `rm -rf /tmp/metro-cache /tmp/metro-file-map-*` is required whenever these values change. Confirm the result with `unzip -p app-release.apk assets/index.android.bundle | grep -oE "https://[^\"']+|10\.0\.2\.2:3000" | sort -u`.
- `-PreactNativeArchitectures=arm64-v8a` builds one ABI. The default is all four, which is slow enough to matter.
- The release variant is signed with the generated debug keystore (`apps/android/android/app/build.gradle`), so it installs for sideloading but carries no release identity. Producing a release-signed APK requires creating a keystore and wiring a `release` signing config.

On an ARM64 host the Android build-tools `aapt2` and the NDK's `clang++` are x86-64 binaries, so they need `binfmt_misc` with `qemu-x86_64-static` plus the amd64 loader (`libc6:amd64`); install both before running Gradle. `apps/android/android/` is generated output and is not committed.

## Sign in

Both clients sign in with Google. The browser round trip is Authorization Code + PKCE with the
token exchange on the server (`apps/api/src/auth/google.ts`), so no client secret ships in an
installer and neither app ever handles a Google credential:

1. `GET /v1/auth/google/start?redirect_uri=…&code_challenge=…&state=…` signs a state blob holding
   the redirect target, the client's own `state`, its PKCE challenge and a **server-side** PKCE
   verifier, then redirects to Google.
2. Google returns to `GET /v1/auth/google/callback`, which verifies the ID token against Google's
   JWKS (issuer, audience, `email_verified`) and redirects back to the client's `redirect_uri` with
   a one-minute login code bound to the client's challenge plus the echoed `state`.
3. The client calls `POST /v1/auth/exchange` with `{code, codeVerifier}` and receives the same
   `{accessToken, refreshToken, user}` a password login returns.

Allowed `redirect_uri` values are `personal-ai://auth` (Android) and
`http://127.0.0.1:<port>/auth` (Windows Agent, random port); anything else is refused with
`INVALID_REDIRECT_URI`. Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
`GOOGLE_REDIRECT_URI` (see `.env.example`); with any of them unset the routes answer
`503 NOT_CONFIGURED` and password login keeps working. The OAuth client must be of type **Web
application** in the Google Cloud console with `GOOGLE_REDIRECT_URI` registered — no Android
keystore SHA-1 is involved, so the debug keystore cannot cause `ApiException: 10`.

Email/password login and a manual access token still work and are documented below.

## Android

Transfer APK to device, allow installation from the source used to open it, install. Tap **Masuk
dengan Google**; the browser opens, and the app returns via the `personal-ai://auth` deep link. An
email/password form sits below the button. Server defaults to `https://ai.ojixx.my.id`. Updates
require installing a later APK. APK sideloading is not Google Play distribution.

## Windows

Run the downloaded `.exe`, accept the Windows SmartScreen warning only after verifying it came from
the repository's Actions artifact, then install. Open Personal AI OS — Windows Agent. Server
defaults to `https://ai.ojixx.my.id`. In Settings press **Masuk dengan Google**: the agent binds
`127.0.0.1` on an ephemeral port, opens the system browser, and captures the redirect on that
loopback listener (`google_login` in `apps/windows/src-tauri/src/main.rs`). The session is stored
in the webview's `localStorage` and access tokens are refreshed automatically on `401`, so there is
no token to paste and nothing to re-enter after expiry. Keep capabilities off by default, choose an
allowed workspace folder, then connect. The optional manual token field remains for operators.

Windows Agent connects as a local device agent. It does not run OMP/Hermes locally and does not receive Android coding-runtime tasks; those run on the VPS.

## Security and production

Rotate previously exposed production secrets before routine use. Do not embed credentials in either installer. Protect artifact downloads and avoid public sharing of personal-server APKs/installers.
