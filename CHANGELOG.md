# Catatan Perubahan (Changelog)

Semua perubahan penting pada proyek **Personal AI OS** didokumentasikan di berkas ini. Format penulisan mengacu pada [Keep a Changelog](https://keepachangelog.com/id/1.0.0/) dan mematuhi [Semantic Versioning](https://semver.org/).

---

## [0.4.0] - 2026-10-18

### 🚀 QA Akhir dan Rilis 0.4.0 (Sesi 31)
- **Gerbang Kualitas Monorepo 100% Lulus**: Seluruh suite pengujian monorepo lulus:
  - `pnpm -r typecheck`: 14 paket lulus 100% tanpa error kompilasi TypeScript strict.
  - `pnpm -r lint`: 14 paket lulus 100% tanpa pelanggaran atau warning ESLint (`--max-warnings=0`).
  - `pnpm -r test`: Seluruh pengujian paket berhasil (API 114 passed / 1 skipped, Windows 88 passed, Agent Worker 58 passed, Android 54 passed, MCP 21 passed, Scheduler 10 passed, Memori, Tools, Evaluator, Model Gateway, Permissions, Agent Core, Shared, Runtime Bridge).
  - `pnpm test:live`: 7 skenario live API Fastify & fake 9Router, 21 pengujian live worker (17 passed, 4 skipped live database), live scheduler (2 passed, 3 skipped live database).
  - `pnpm check:tokens`: 7 file CSS Windows UI lulus audit tanpa un-tokenized hardcoded colors.
  - `pnpm verify:audit`: 100% referensi audit valid di filesystem.
  - `pnpm -r build`: Bundel Windows Vite (455.31 kB JS, 109.62 kB CSS) dan bundel Android Expo (3.79 MB) selesai tanpa error.
- **Audit Desain & Aksesibilitas**: Kontras WCAG AA/AAA terverifikasi pada tema gelap (14.8:1) dan tema terang (15.6:1), dukungan `prefers-reduced-motion` pada seluruh animasi CSS, label TalkBack / accessibilityLabel pada seluruh layar Android, responsivitas pada resolusi desktop 1366x768 dan display scale 150%.
- **Audit Keamanan & Integritas Lisensi**: Pengujian fail-closed pada registrasi MCP server tidak dikenal/gagal jalan, pelindung SSRF untuk Deep Research dan remote MCP, sanitasi tag `<untrusted_content>` untuk output eksternal/MCP, sensor otomatis data kredensial/token pada tracing dan log, pembatasan izin Android minimal, dan verifikasi independensi lisensi (0 kode disalin dari proyek AGPL Odysseus).
- **Rekonsiliasi ADR**: Perbaikan penomoran dokumen ADR yang unnumbered/bertabrakan menjadi `0019-host-runtime-bridge.md`, penambahan ADR 0032.

### 🧠 Pencarian Memori Hibrida Sejati & Caching Embedding SHA-256 (Sesi 30)
- **Pencarian Hibrida RRF (Reciprocal Rank Fusion)**: Menggabungkan skor vektor pgvector dan skor teks PostgreSQL full-text search (`tsvector` & `websearch_to_tsquery`) dengan pembobotan $k=60$ (65% vektor, 35% teks).
- **Tolok Ukur Evaluasi Memori**: Evaluasi benchmark pada 35 query pasangan menunjukkan keunggulan pencarian hibrida dengan MRR 0.8905 dan Recall@3 97.14% dibandingkan pencarian teks murni (MRR 0.6748, Recall@3 77.14%).
- **Cache Embedding SHA-256 & Sanitasi PII**: `CachedEmbeddingProvider` dengan LRU cache (1.000 entri) dan fungsi `redactSensitiveData` yang otomatis membersihkan secret sebelum pengiriman request embedding.
- **Probe Empiris 9Router**: Pengujian langsung pada endpoint VPS 9Router mendokumentasikan ketiadaan kredensial OpenAI bawaan (HTTP 400), diatasi dengan pemisahan adapter gateway dan fallback teks yang aman.
- **Peredaman Duplikasi Deep Research**: Ambang batas cosine similarity $\ge 0.88$ untuk mereduksi redundansi ringkasan riset mendalam.

### 🖥️ Investigasi Runtime OMP, Hermes, & Usulan pi.dev (Sesi 29)
- **Probe CLI Read-Only VPS**: Verifikasi empiris flag CLI `omp` v18.6.1 (`--model`, `--smol`, `--slow`, `--plan`, `--prewalk`, `--goal`) dan hermes-agent v0.4.0 (`--tools`, `--max-steps`).
- **Analisis pi.dev RPC Protocol**: Desain arsitektur integrasi JSON-RPC headless sub-agent tanpa dependensi biner tidak tepercaya (ADR 0030).

### ⚡ Streaming Eksekusi Runtime & Diff Viewer (Sesi 28)
- **Agregasi Acara Runtime**: Komponen `ToolStep` mengagregasi streaming event `tool_start`, `tool_finish`, `file_edit`, dan `task_progress` secara realtime.
- **Inline Unified Diff Viewer**: Penampil visual baris diff kode dengan pewarnaan token, penanda hunk, dan tombol salin.
- **Badge Status & Runtime Pill**: Penanda visual runtime aktif (`Native`, `OMP`, `Hermes`) dan status eksekusi langkah.

### 🌐 Pengalaman Offline & Ketahanan Jaringan (Sesi 27)
- **Antrean Mutasi Offline**: Klien Windows dan Android menyimpan aksi/pesan saat offline dan menyinkronkan kembali secara otomatis saat koneksi pulih.
- **Indikator Status Koneksi**: Banner offline non-intrusif dan penanganan graceful error di setiap layar.

### 🛡️ Dasbor Admin MCP & Manajemen Kredensial (Sesi 26)
- **Manajemen Server MCP**: Dasbor visual status server MCP (active, starting, failed, stopped) dengan isolasi kredensial di server.
- **SSRF Guard & Fail-Closed Policy**: Larangan akses loopback, link-local, private network, dan metadata cloud pada remote MCP endpoint.

### ⏰ Scheduler Berulang Lanjutan & Ringkasan Harian (Sesi 25)
- **Parser Cron & Kebijakan Missed-Run**: Dukungan ekspresi cron 5-field dengan kebijakan `skip`, `run_once`, dan `catch_up`.
- **Integrasi Ringkasan Harian**: Penjadwalan task backup sistem dan brief harian dengan ringkasan otomatis.

### 🧪 Blind Model Comparison & Mode A/B (Sesi 24)
- **Mode Evaluasi Buta**: Eksekusi paralel dua respons model acak tanpa menampilkan nama model ke pengguna.
- **Tombol Ungkap (Reveal)**: Penilaian objektif preferensi jawaban sebelum identitas model diungkap.

### 🌳 Cabang Percakapan, Ekspor, & Template (Sesi 23)
- **Pencabangan Obrolan (Branching)**: Kemampuan mengedit pesan lama dan membuat cabang alternatif tanpa merusak riwayat utama.
- **Ekspor Dokumen**: Fitur ekspor riwayat obrolan ke format Markdown dan JSON terstruktur.
- **Template Slash Command**: Dukungan shortcut cepat `/plan`, `/summarize`, `/code`, `/fix`.

### 🔍 Deep Research Standar & Mendalam (Sesi 22)
- **Mesin Riset Multi-Langkah**: Siklus pencarian web, crawling guarded, ekstraksi fakta, sintesis terstruktur, dan sitasi transparan.
- **Pembatalan & Pemulihan Riset**: Penghentian aman di tengah pencarian tanpa kehilangan riwayat temuan yang telah terkumpul.

### 💡 Usulan Skill Dinamis (Sesi 21)
- **Deteksi Alur Kerja Berulang**: Evaluasi otomatis riwayat aksi worker untuk menyarankan pembentukan skill kustom baru kepada pengguna.
- **Editor Manifes Skill**: Formulir peninjauan instruksi dan tool allowlist sebelum skill diaktifkan.

### 🔄 Auto-Updater Windows Tauri 2 (Sesi 20)
- **Pembaruan Aman Terverifikasi**: Integrasi `tauri-plugin-updater` dengan tanda tangan kriptografi Ed25519 dan verifikasi hash sha256 rilis.
- **Indikator UI Non-Intrusif**: Notifikasi ketersediaan versi baru di antarmuka Windows dengan opsi tunda atau instal saat restart.

---

## [0.3.0] - 2026-10-16

### 🚀 QA Akhir dan Kesiapan Rilis (Sesi 17)
- **Gerbang Kualitas 100% Lulus**: Menjalankan seluruh pengujian ci (`pnpm test:ci`): 566 pengujian di seluruh 14 package & app dengan 564 lulus, 0 gagal, 2 dilewati (pemeriksaan live database opsional).
- **Pengujian Pemulihan Mandiri (Recovery Drills)**: Seluruh 4 skenario pemulihan tugas (crash -> checkpoint resume exactly once, batas retry loop, deteksi manipulasi checkpoint, dan PostgreSQL advisory lock) terverifikasi lulus.
- **Audit UX & Aksesibilitas**: Verifikasi rasio kontras warna WCAG AA dan AAA pada tema gelap (14.8:1) dan tema terang (15.6:1), tipografi Inter lokal tanpa CDN, navigasi keyboard (Ctrl+N, Ctrl+K), serta label TalkBack pada Android.
- **Audit Keamanan Ringan**: Pemindaian pola regex bebas dari kebocoran secret/API key di repositori dan klien; verifikasi CSP ketat pada Tauri (`default-src 'self'`); pembatasan izin minimal pada Android (`app.json`); dan sensor otomatis data sensitif pada tracing.
- **Penomoran Versi & Alur Installer**: Sinkronisasi versi `0.3.0` di seluruh workspace (`package.json`, Windows Tauri, Android app.json/package.json, Cargo.toml) serta instruksi verifikasi installer NSIS dan APK.

### 🛡️ Operasional VPS, Observabilitas, & Backup Offsite (Sesi 16)
- **Telegram Alerting Realistis**: Modul `VpsAlertChecker` dan `TelegramAlertTransport` memantau kesehatan server, antrean BullMQ, usia backup, kapasitas disk, dan sertifikat TLS dengan peringatan berbahasa Indonesia dan anti-spam cooldown.
- **Observabilitas & Tracing OpenTelemetry**: Implementasi `TelemetryTracer` dengan propagasi W3C `traceparent` (Client -> Fastify API -> BullMQ -> Worker), sampling hemat sumber daya (10%), retensi 100% untuk span error, dan redaksi otomatis kredensial sensitif.
- **Backup Terenkripsi & Uji Pemulihan**: Skrip otomatisasi `scripts/backup-offsite.sh` dan `scripts/restore-offsite.sh` menggunakan enkripsi OpenSSL AES-256-CBC, verifikasi checksum SHA256, dan validasi jumlah baris tabel database utama.
- **Penguatan Edge & Batas Kapasitas**: Konfigurasi header keamanan HTTP (HSTS, X-Content-Type-Options, CSP, Referrer-Policy) pada Caddy dan Fastify, serta tolok ukur batas kapasitas 10 percakapan simultan pada VPS ARM64.

### 🔒 Penguatan Keamanan Agen Windows (Sesi 15)
- **Rust DPAPI Secure Keystore**: Pemindahan kunci privat dari webview `localStorage` ke proses Rust, diamankan dengan Windows DPAPI (`CryptProtectData`) dan kurva ECDSA P-256 murni di Rust.
- **Pencegahan Eksploitasi Jalur Windows**: Menutup celah Alternate Data Stream (ADS), jalur UNC (`\\server\share`), device namespace (`\\.\`), traversal URL-encoded, dan injeksi sub-perintah PowerShell `{...}`.
- **Persistensi Kehadiran & Audit Server**: Penyimpanan status kehadiran perangkat di server dengan jendela toleransi 30 detik saat restart API.
- **Alur CI Windows & Smoke Test**: Pengujian instalasi dan pencopotan senyap (`silent install/uninstall`) installer NSIS di runner GitHub Actions Windows.

### 🧩 Manajer Skill & MCP (Sesi 14)
- **Tiga Skill Utama Terstandarisasi**:
  1. `plan-before-act`: Memastikan rencana langkah dan kriteria penerimaan terstruktur sebelum tindakan dieksekusi.
  2. `verify-with-evidence`: Memvalidasi bukti hasil kerja secara mandiri sebelum tugas dinyatakan selesai.
  3. `security-review`: Memindai diff kode terhadap kebocoran secret, path traversal, dan injeksi perintah.
- **Transport MCP Jarak Jauh & Keamanan SSE**: `SseMcpServerAdapter` dengan pelindung SSRF (memblokir loopback, metadata cloud, dan IP privat) serta allowlist biner eksekusi (`node`, `npx`, `python3`, `docker`, `uvx`).
- **Antarmuka Pengguna Skill & MCP**: Pengaturan skill per proyek, penampil manifes lengkap, dan pencatatan riwayat eksekusi pada Windows dan Android.

### ⚡ Integrasi Hermes & Runtime Picker (Sesi 13)
- **Routing Kebijakan Otomatis**: Klasifikasi intensi cerdas (`coding` -> `omp`, `automation`/skill/cron -> `hermes`, obrolan cepat -> bawaan/native).
- **Runtime Picker Chip**: Kontrol runtime interaktif pada komposer Windows dan Android.
- **Penanganan Fallback & Sanitasi Output**: Peringatan visual transparan jika runtime utama tidak aktif, serta isolasi tag `<untrusted_content>` untuk output eksternal.

### 🧠 Subsistem Memori & Ekstraksi Usulan (Sesi 10)
- **Pencarian Teks Hibrida & Cadangan**: Fallback PostgreSQL full-text search (`tsvector` & `ILIKE`) dengan metadata jujur saat embedding eksternal tidak aktif.
- **Ekstraksi Kandidat Tanpa Penyimpanan Diam-diam**: Deteksi otomatis memori penting dari obrolan dan tugas yang disimpan dengan status `proposed` untuk ditinjau oleh pengguna.
- **Pembersihan Retensi (TTL)**: Pembersihan berkala otomatis untuk tier memori `ephemeral` (1 hari), `session` (7 hari), 30 hari, 90 hari, dan permanen.

### 🔄 Pemulihan Tugas Tahan Gangguan & Batasan Retry (Sesi 9)
- **Batas Percobaan Ulang**: Mencegah loop tanpa henti pada kegagalan berulang (`recoveryExhausted`).
- **Kunci Penasehat Bersaing (Advisory Lock)**: Memastikan hanya satu worker yang memulihkan tugas yang sama saat terjadi restart atau failover.
- **Integritas Checkpoint**: Validasi checksum sha256 pada checkpoint untuk mencegah eksekusi tugas yang statusnya rusak atau termanipulasi.

### 🤖 Loop Agen Generik Otonom (Sesi 8)
- **Siklus Otonom Lengkap**: Siklus Rencana -> Eksekusi Langkah -> Observasi -> Evaluasi dengan batasan ketat langkah (`maxSteps`), batas waktu (`timeoutMs`), dan kuota token.
- **Gerbang Persetujuan Risiko**: Penghentian sementara pada status `waiting_approval` untuk tool berisiko `HIGH`/`CRITICAL` sebelum dilanjutkan secara aman.

### 📱 Antarmuka Android Cerdas & Navigasi Terpadu (Sesi 7)
- **Navigasi Berbasis React Navigation**: 3 tab utama (*Chat*, *Aktivitas*, *Lainnya*) dengan ikon `lucide-react-native` dan badge notifikasi approval yang belum ditinjau.
- **Komponen Pesan Kaya**: Penampil Markdown tanpa dependensi eksternal berat, blok kode dengan tombol salin, dan dialog persetujuan bertingkat dengan target sentuh minimal 48 dp.

### 💻 Antarmuka Desktop Windows & Model Selector (Sesi 4 & 6)
- **Desain Ulang Tata Letak Windows**: Pemisahan modular (Sidebar, Chat, Aktivitas, Proyek, Pengaturan) dengan lokalisasi 100% Bahasa Indonesia.
- **Pemilih Model Dinamis**: Deteksi kapabilitas model terverifikasi (Streaming, Tools, Vision) dari 9Router, pengelompokan per penyedia, dan penanganan graceful fallback saat offline.

---

## [0.2.0] - 2026-10-14
- Pembuatan fondasi kontrol Fastify, skema Drizzle ORM, autentikasi Google PKCE, dan integrasi dasar BullMQ.

## [0.1.0] - 2026-10-10
- Rilis inisial arsitektur monorepo Personal AI OS.
