# ADR 0039: Coding Precision Tools — Hashline Anchor Edit dan LSP Diagnostics

## Status
DITERIMA

## Tanggal
2026-10-19

## Konteks
Pada pengembangan AI coding agent dalam Personal AI OS, manipulasi file dan verifikasi sintaks/diagnostik menghadapi dua risiko utama:
1. **Line Drift & Race Conditions**: Model LLM sering menghasilkan edit file berdasarkan nomor baris dari pembacaan sebelumnya. Jika file berubah di disk atau jika ada beberapa modifikasi bersamaan, nomor baris bergeser (drift). Tool edit bawaan OMP (`edit`) hanya melakukan pencocokan string sederhana (`find_replace`) tanpa verifikasi hash baris dan tanpa proteksi drift, sehingga rawan salah edit (spekulatif) atau menimpa konten yang tidak diinginkan.
2. **Ketergantungan Eksternal LSP yang Tidak Terprediksi**: Container worker atau host VPS ARM64 tidak dapat diasumsikan memiliki seluruh compiler atau language server (`typescript-language-server`, `rust-analyzer`, `pyright`, `gopls`) terpasang. Mengasumsikan LSP selalu berjalan dapat menyebabkan worker menggantung (hang), crash, atau memberikan ilusi kelulusan palsu (*false pass*).

## Investigasi Runtime & Mekanisme yang Ada
- **OMP v18.8.4**: Menyediakan tool bawaan `edit` (string search & replace) dan konfigurasi `lsp.enabled`, namun tidak memiliki proteksi optimistic concurrency berbasis hash baris (`hashline`) dan sangat bergantung pada ketersediaan binary language server eksternal pada host.
- **Packages Tools Monorepo**: Mengembangkan precision tools yang terisolasi, deterministik, dan terlindungi oleh `ToolRegistry`, `SecuredCapabilityGuard`, serta `ExecutionLimiter`.

## Keputusan Arsitektur

### 1. Hashline Anchor Edit (`hashline_edit`)
- **Format Anchor**: Setiap segmen baris ditargetkan menggunakan format `<nomor_baris>#<hash>` (contoh: `42#a1f`), di mana hash dihitung menggunakan SHA-256 dari konten baris (case-insensitive hex).
- **Proteksi Drift Tanpa Spekulasi**: Jika hash baris aktual tidak cocok dengan `expectedHash`, sistem **menolak** edit secara atomik dan melempar error terstruktur `HashlineCollisionError` dengan atribut `status: 'stale_anchor'`. Sistem **dilarang menebak** posisi baru secara spekulatif. File di disk dijamin tidak tersentuh.
- **Batas Sumber Daya**:
  - Ukuran file maksimum: `MAX_FILE_SIZE_BYTES = 5 MB` (5.242.880 bytes).
  - Jumlah edit per batch: `MAX_EDITS_PER_BATCH = 100`.
  - Ukuran penggantian per baris: `MAX_REPLACEMENT_BYTES = 64 KB` (65.536 bytes).
  - Batas timeout: 10.000 ms.
  - Batas ukuran output: 32.768 bytes.
- **Keamanan Workspace & Symlink**:
  - Menolak path traversal di luar workspace root (`startsWith(rootDir)`).
  - Menolak symbolic link secara eksplisit menggunakan pemeriksaan `lstat` (`isSymbolicLink()`).
  - Menolak akses atau penulisan ke file kredensial/sensitif (`.env*`, `*secret*`, `*credential*`, `*id_rsa*`, `*id_ed25519*`).
- **Encoding & Newline**:
  - Menolak file biner atau file yang mengandung *null bytes* (`\0`).
  - Mendeteksi konvensi baris dominan (CRLF `\r\n` vs LF `\n`) dan menjaga keutuhan format newline asli.
  - Mendukung karakter multi-byte UTF-8 (Unicode, Emoji, aksara non-Latin) secara deterministik.
- **Diff & Identitas Versi**:
  - Menghasilkan diff unifikasi sebelum-dan-sesudah (`--- a/...`, `+++ b/...`, `@@ -line,1 +line,count @@`).
  - Menghitung SHA-256 versi file baru (`fileVersionHash`) untuk pelacakan konkurensi.
  - Tidak menyimpan konten rahasia dalam audit log.

### 2. Read-Only LSP Diagnostics (`lsp_diagnostics`)
- **Tujuan**: Memberikan evaluasi diagnostik statis read-only untuk file dalam workspace tanpa memodifikasi file disk.
- **Allowlist Bahasa**:
  - `typescript` / `javascript`: `typescript-language-server`, `vtsls`
  - `python`: `pyright-langserver`, `pylsp`, `ruff`
  - `rust`: `rust-analyzer`
  - `go`: `gopls`
- **Probe Ketersediaan Transparan**:
  - Sebelum eksekusi, runtime melakukan probe read-only untuk mendeteksi binary language server.
  - **Jika server bahasa tidak tersedia**: tool mengembalikan status eksplisit `serverStatus: 'unconfigured'`, pesan deskriptif, dan `diagnostics: []`. Sistem **dilarang keras** mengklaim bahwa LSP "lulus" atau "0 error ditemukan" jika server bahasa belum dikonfigurasi.
- **Ketahanan Worker (Robustness)**:
  - Batas timeout 15.000 ms dengan pembersihan proses (process tree cleanup / kill) saat abort/timeout.
  - Pembatasan konkurensi via `ExecutionLimiter` (maksimum 2 proses paralel per bahasa).
  - Menangani process crash (misal SIGSEGV) dan output malformed secara aman tanpa menggantung worker.
- **Keamanan**:
  - Mengisolasi pembacaan di dalam workspace, menolak symlink escape dan file kredensial (`.env*`).

## Konsekuensi & Bukti Pengujian
1. **Keandalan Modifikasi Kode**: Agen AI tidak lagi dapat merusak codebase akibat desinkronisasi nomor baris atau modifikasi file yang sudah usang (*stale*).
2. **Keamanan Host & Worker**: File sensitif, symlink traversal, file biner tak terduga, dan proses diagnostik yang menggantung tertangani secara deterministik.
3. **Verifikasi Kualitas**:
   - 79 unit test pada `@personal-ai-os/tools` lulus 100%.
   - Typecheck TypeScript strict lulus di seluruh 14 package monorepo.
   - ESLint lulus dengan 0 warning dan 0 error.
   - `verify:audit` lulus 100% untuk semua referensi path monorepo.
