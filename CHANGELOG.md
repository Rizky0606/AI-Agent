# Catatan Perubahan (Changelog)

Semua perubahan penting pada proyek **Personal AI OS** didokumentasikan di berkas ini. Format penulisan mengacu pada [Keep a Changelog](https://keepachangelog.com/id/1.0.0/) dan mematuhi [Semantic Versioning](https://semver.org/).

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
