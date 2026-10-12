# Installable app releases

## Build installers

GitHub Actions → **Build installable apps** → **Run workflow**. Workflow requires repository secret `EXPO_TOKEN` from an authorized Expo account. Android job builds a preview APK using EAS; Windows job builds a self-signed NSIS installer. Download artifacts from the completed Actions run:

- `personal-ai-os-android-apk` → `personal-ai-os.apk`
- `personal-ai-os-windows-installer` → `.exe`

No installer is committed to the repository. No signing secret is required. Windows may show SmartScreen warnings because the installer is not signed by a trusted code-signing certificate.

## Android

Transfer APK to device, allow installation from the source used to open it, install. Sign in or create an account. Server defaults to `https://ai.ojixx.my.id`. Updates require installing a later APK. APK sideloading is not Google Play distribution.

## Windows

Run the downloaded `.exe`, accept the Windows SmartScreen warning only after verifying it came from the repository's Actions artifact, then install. Open Personal AI OS — Windows Agent. Server defaults to `https://ai.ojixx.my.id`. Sign in is not built into Windows Agent: get a short-lived access token by signing into Android or calling `/v1/auth/login`, enter it in Settings, keep capabilities off by default, choose an allowed workspace folder, then connect. Token lifetime is short; reconnect after expiry with a fresh token. Do not save, share, or commit the token.

Windows Agent connects as a local device agent. It does not run OMP/Hermes locally and does not receive Android coding-runtime tasks; those run on the VPS.

## Security and production

Rotate previously exposed production secrets before routine use. Do not embed credentials in either installer. Protect artifact downloads and avoid public sharing of personal-server APKs/installers.
