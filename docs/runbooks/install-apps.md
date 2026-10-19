# Installable app releases (v0.4.0)

## Build installers

GitHub Actions → **Build installable apps** (`.github/workflows/release-installers.yml`) → **Run workflow**. Both jobs build from source with no repository secrets required:
- Android runs `expo prebuild` plus `gradlew assembleRelease` on `ubuntu-latest`.
- Windows runs `tauri build --bundles nsis` on `windows-latest`.

Download artifacts from the completed Actions run:
- `personal-ai-os-android-apk` → `personal-ai-os.apk` (Versi 0.4.0)
- `personal-ai-os-windows-installer` → `Personal AI OS - Windows Agent_0.4.0_x64-setup.exe` (Versi 0.4.0)

No installer is committed to the Git repository. Windows may display a Windows Defender SmartScreen ("Windows protected your PC") warning because the binary is unsigned by an EV certificate (see `docs/windows/code-signing-runbook.md` for production signing options), and the APK carries the debug keystore for easy sideloading.

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

Verified end to end against production on 2026-10-14 with a real Google account and the real OAuth
client: the browser round trip returned a genuine authorization code, `POST /v1/auth/exchange`
answered `200`, the access token authenticated `GET /v1/me`, `POST /v1/auth/refresh` rotated both
tokens, and `user_identities` gained one row for the Google subject. A wrong `codeVerifier` on that
same code answers `400 INVALID_LOGIN_CODE`.

While the OAuth consent screen is still **Testing**, only accounts listed under **Test users** can
sign in; anyone else gets `403 access_denied` from Google before ever reaching this server. Add each
person there, or press **Publish app** — the `openid email` scopes need no Google review.

An account that already exists under the same email is reused rather than duplicated, and its
password keeps working. Google has verified that email, which is what makes the link safe; if an
independent email-verification flow is added later, revisit that ordering.

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

The start URL is handed to the browser through `cmd /C start "" "<url>"` with the whole command
line passed as one raw argument. `cmd` splits an unquoted command line on `&`, so dropping either
quote truncates the query string to `redirect_uri` alone and the API answers
`400 VALIDATION_ERROR "querystring must have required property 'code_challenge'"`. The Rust test
`browser_command_line_keeps_every_query_separator_inside_quotes` pins that.

Windows Agent connects as a local device agent. It does not run OMP/Hermes locally and does not receive Android coding-runtime tasks; those run on the VPS.

## Security and production

Rotate previously exposed production secrets before routine use. Do not embed credentials in either installer. Protect artifact downloads and avoid public sharing of personal-server APKs/installers.

---

## 📋 Skenario End-to-End Verifikasi Klien (Checklist Pengujian Manual)

Berikut adalah panduan langkah demi langkah yang dapat diulang secara mandiri untuk menguji fungsionalitas penuh Personal AI OS pada perangkat klien Windows dan Android:

### A. Checklist Verifikasi Windows Agent (`Personal AI OS - Windows Agent`)

- [ ] **1. Instalasi Bersih (*Fresh Install*)**:
  - Unduh `Personal AI OS - Windows Agent_0.3.0_x64-setup.exe` dari rilis Actions.
  - Jalankan installer. Jika muncul SmartScreen ("Windows protected your PC"), klik *More info* → *Run anyway*.
  - Selesaikan instalasi NSIS ke direktori pengguna (`%LOCALAPPDATA%\Programs\personal-ai-os-windows`).
  - *Alternatif pengujian senyap via CI/PowerShell*:
    ```powershell
    powershell -ExecutionPolicy Bypass -File scripts/windows-installer-smoke.ps1
    ```
- [ ] **2. Single-Step Login (Google PKCE / Email)**:
  - Buka aplikasi. Jendela 1024x720 terbuka dengan tema sistem default.
  - Klik **Masuk dengan Google**: browser sistem terbuka secara otomatis ke alur OAuth PKCE (`GET /v1/auth/google/start`).
  - Lakukan otorisasi di browser; browser mengalihkan kembali ke loopback agent (`127.0.0.1:<port>/auth`).
  - Aplikasi Windows langsung masuk ke dashboard utama tanpa perlu klik "Hubungkan" secara manual. Kunci privat ECDSA P-256 dibuat dan diamankan di Rust DPAPI.
- [ ] **3. Chat Awal dengan Mode Auto**:
  - Pastikan chip model pada komposer obrolan menunjukkan **Auto (Disarankan)**.
  - Ketik pesan: `"Halo, jelaskan arsitektur Personal AI OS dan prinsip izin keamanannya."`
  - Tekan **Enter** untuk mengirim. Streaming teks muncul *real-time*. Pada gelembung jawaban asisten, pastikan label menampilkan `Dijawab oleh <model>`.
- [ ] **4. Pemilihan Model Spesifik (*Model Selector Popover*)**:
  - Klik chip Model pada komposer. Popover pemilih model terbuka dengan pengelompokan provider (OpenAI, Anthropic, Google, DeepSeek).
  - Verifikasi badge kapabilitas terverifikasi (*Stream*, *Tools*, *Vision*) dan indikator latensi.
  - Pilih salah satu model spesifik. Kirim pertanyaan tindak lanjut. Pastikan respons mencantumkan model yang dipilih.
- [ ] **5. Task Coding via OMP dengan Langkah Live**:
  - Pada baris chip komposer, ubah chip Runtime dari `Auto` menjadi `omp`.
  - Berikan instruksi coding: `"Buat file scratch/calc.ts yang mengekspor fungsi tambah dan kurang dengan TypeScript strict."`
  - Tekan Kirim. Tugas durabel dibuat (`kind: 'coding_runtime'`).
  - Panel samping Aktivitas (*Activity Panel*) otomatis menampilkan kartu tugas dengan langkah-langkah live streaming (`task.tool_call`, `file_edit` diff preview).
- [ ] **6. Persetujuan Aksi HIGH Risk (*Risk Approvals*)**:
  - Jika tugas meminta perintah PowerShell atau tool berskala sistem (`powershell_execute` atau akses file di luar workspace), status tugas beralih ke `waiting_approval`.
  - Notifikasi toast peringatan muncul di desktop.
  - Di panel Aktivitas, kartu persetujuan menampilkan tingkat risiko (oranye/merah), deskripsi aksi, dan konsekuensi.
  - Klik **Setujui**. Dialog konfirmasi modal sekunder muncul meminta penegasan. Konfirmasi persetujuan; tugas langsung melanjutkan eksekusi dari checkpoint terakhir.
- [ ] **7. Peninjauan Artefak (*Artifact Preview*)**:
  - Setelah tugas selesai (`completed` 100%), periksa tab **Artefak** di panel samping.
  - Buka artefak file yang dihasilkan. Verifikasi bahwa isi file, ukuran byte, dan checksum SHA-256 ditampilkan dengan rapi.
- [ ] **8. Memori Usulan (*Proposed Memories*)**:
  - Buka layar **Memori** (ikon otak di navigasi).
  - Bagian **Usulan Memori Baru** menampilkan fakta atau preferensi yang diekstraksi dari sesi obrolan/tugas sebelumnya (misal: preferensi bahasa atau proyek).
  - Klik **Setujui** untuk memindahkan memori usulan menjadi memori aktif (tier 30d/permanen), atau **Tolak** untuk menghapusnya.
- [ ] **9. Manajemen Skill & MCP**:
  - Buka layar **Skill & MCP**.
  - Lihat manifes dari 3 skill bawaan (`plan-before-act`, `verify-with-evidence`, `security-review`).
  - Uji tombol toggle per-proyek untuk mengaktifkan/menonaktifkan skill.
  - Tinjau daftar server MCP yang terdaftar (misal: `echo` server) beserta alat-alat yang diekspos di baliknya.
- [ ] **10. Logout dan Login Ulang (*Session Persistence*)**:
  - Di footer sidebar, klik menu akun → **Keluar Akun**. Token lokal dihapus.
  - Tutup aplikasi dan buka kembali. Aplikasi menampilkan layar login bersih.
  - Masuk kembali menggunakan akun yang sama. Riwayat percakapan sebelumnya termuat kembali dengan benar.
- [ ] **11. Simulasi Restart API di Tengah Task (*Fault-Tolerance*)**:
  - Mulai tugas baru yang berjalan agak panjang (misal: riset multi-langkah).
  - Saat tugas berada dalam status `running`, hentikan atau restart kontainer API backend di VPS / terminal:
    ```bash
    docker compose restart api
    ```
  - Amati indikator koneksi di Windows: dot beralih kuning (koneksi terputus/mencoba menyambung kembali), lalu kembali hijau dalam waktu <30 detik.
  - Tugas di panel Aktivitas tidak gagal atau hilang; aliran event tersambung kembali dan melanjutkan pembaruan progress menggunakan checkpoint terakhir.

---

### B. Checklist Verifikasi Android Client (`Personal AI OS Mobile`)

- [ ] **1. Instalasi Bersih APK**:
  - Salin `personal-ai-os.apk` ke perangkat fisik Android atau Android Emulator (API 34/35).
  - Izinkan instalasi dari sumber tidak dikenal (*Install unknown apps*) dan pasang APK.
- [ ] **2. Login Google PKCE & Server URL**:
  - Buka aplikasi **Personal AI OS**. Layar onboarding gelap bertema Tailwind/Slate muncul dengan tombol hero **Masuk dengan Google**.
  - *(Opsional)* Jika menggunakan server backend lokal, buka *Pengaturan Lanjutan (Server)* dan masukkan IP VPS/PC (`http://10.0.2.2:3000` di emulator atau `https://ai.ojixx.my.id`).
  - Ketuk **Masuk dengan Google**. Browser Android (Chrome/Custom Tab) terbuka, lakukan sign-in, dan aplikasi secara otomatis menerima callback melalui deep link `personal-ai://auth`.
- [ ] **3. Tab Navigasi & Chat Interaktif**:
  - Pastikan 3 bottom tabs tampil di bagian bawah: **Chat**, **Aktivitas**, dan **Lainnya**.
  - Pada tab **Chat**, ketuk salah satu dari 4 kartu contoh instruksi berbahasa Indonesia pada state kosong.
  - Pesan terkirim secara instan; asisten membalas dengan streaming respons yang rapi dalam MarkdownView.
- [ ] **4. Pemilih Model & Chip Mode**:
  - Di atas komposer pesan, ketuk chip Model. Bottom sheet terbuka menampilkan daftar model yang dikelompokkan berdasarkan provider.
  - Pilih model dan ubah mode (misal: *Coding* atau *Riset*). Kirim pesan baru dan pastikan mode aktif diterapkan.
- [ ] **5. Peluncuran Task & Pemantauan Live di Tab Aktivitas**:
  - Minta tugas riset: `"Lakukan riset komprehensif tentang algoritma pencarian hybrid PostgreSQL pgvector."`
  - Navigasi ke tab **Aktivitas**. Badge notifikasi angka menampilkan jumlah tugas aktif.
  - Ketuk kartu tugas untuk membuka *TaskDetailScreen*. Perhatikan timeline tahapan, log perkiraan, dan sumber referensi yang dikutip.
- [ ] **6. Persetujuan Risiko (HIGH Risk Approval Bottom Sheet)**:
  - Saat agen memerlukan akses tool berisiko, kartu persetujuan muncul di tab Aktivitas dan Chat.
  - Ketuk **Tinjau Persetujuan**. Bottom sheet muncul menampilkan tingkat risiko, target aksi, dan penjelasan bahasa Indonesia.
  - Ketuk **Setujui**. Dialog konfirmasi peringatan risiko muncul. Ketuk **Ya, Lanjutkan**.
- [ ] **7. Tab Lainnya (Memori, Skill, & Pengaturan Sistem)**:
  - Buka tab **Lainnya**.
  - Ketuk **Kelola Memori**: tinjau daftar memori aktif dan daftar usulan memori (*proposed*). Uji fitur setujui/tolak usulan.
  - Ketuk **Skill & MCP**: tinjau skill aktif dan status server MCP eksternal.
  - Ubah tema tampilan di bagian *Tampilan* (Sistem / Gelap / Terang) dan pastikan UI bertransisi mulus tanpa kedip.
- [ ] **8. Pengujian Deep Link & Notifikasi**:
  - Simulasikan pembukaan deep link melalui ADB:
    ```bash
    adb shell am start -W -a android.intent.action.VIEW -d "personal-ai://tasks/<task-id>" com.personalai.os
    ```
  - Aplikasi langsung mengarahkan pengguna ke layar detail tugas yang bersangkutan.
- [ ] **9. Logout & Login Ulang**:
  - Pada tab **Lainnya**, ketuk **Keluar Akun**. Konfirmasi logout.
  - Masuk kembali menggunakan email/password atau Google untuk memastikan sesi SecureStore dibersihkan dan dipulihkan dengan benar.

