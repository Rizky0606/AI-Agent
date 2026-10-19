# ADR 0032: QA Akhir, Audit Desain & Keamanan, Rekonsiliasi Dokumen, dan Kesiapan Rilis 0.4.0

- **Status**: Diterima
- **Tanggal**: 2026-10-18
- **Penulis**: Principal Software Architect & QA Engineering
- **Pembaruan dari**: ADR 0018 (QA Akhir dan Kesiapan Rilis 0.3.0)

---

## 1. Konteks

Repositori **Personal AI OS** telah menyelesaikan 31 sesi pengembangan iteratif incremental yang mencakup:
- Fondasi arsitektur multi-platform (Android, Windows, VPS Control Plane, 9Router gateway).
- Eksekusi agen otonom tahan gangguan dengan checkpoint, evaluasi berbasis bukti, dan perizinan bertingkat (Permission Engine).
- Pembaruan aplikasi mandiri (Auto-Updater Windows Tauri 2 via Ed25519).
- Riset multi-langkah otonom (Deep Research Standar & Mendalam dengan pelindung SSRF).
- Komparasi model buta (Blind Model Comparison) dan penilaian preferensi objektif.
- Fitur obrolan tingkat lanjut (cabang percakapan, ekspor Markdown/HTML tersanitasi, template slash command).
- Pencarian memori hibrida sejati (RRF $k=60$, 65% vektor pgvector + 35% teks full-text search) dengan caching SHA-256 dan evaluasi terukur.
- Streaming eksekusi runtime dengan inline unified diff viewer dan badge engine eksekusi.
- Pengalaman offline terintegrasi dan antrean mutasi pada kedua platform klien.

Sesi 31 bertujuan melakukan verifikasi kualitas akhir (QA Gate), audit desain token dan aksesibilitas, audit keamanan dependensi & lisensi, rekonsiliasi dokumentasi, serta persiapan rilis versi `0.4.0`.

---

## 2. Keputusan Arsitektur

### 2.1 Penomoran Versi Monorepo Terpadu `0.4.0`
Versi monorepo dinaikkan secara sinkron dari `0.3.0` (dan `0.2.0` pada scheduler) menjadi `0.4.0` pada seluruh manifes proyek:
- Root: `package.json` (`0.4.0`)
- Windows Desktop: `apps/windows/package.json` (`0.4.0`), `apps/windows/src-tauri/tauri.conf.json` (`0.4.0`), `apps/windows/src-tauri/Cargo.toml` (`0.4.0`)
- Android Mobile: `apps/android/package.json` (`0.4.0`), `apps/android/app.json` (`0.4.0`)
- Scheduler Service: `apps/scheduler/package.json` (`0.4.0`)

### 2.2 Rekonsiliasi Penomoran Dokumen ADR
Ditemukan inkonsistensi historis di mana dokumen arsitektur Runtime Bridge belum memiliki nomor urut (`docs/adr/runtime-bridge.md`) dan referensi di ADR 0014 menunjuk nomor lama (`ADR 0004` yang bertabrakan dengan Model Gateway).
Dilakukan perbaikan terstruktur:
1. `docs/adr/runtime-bridge.md` diubah namanya menjadi `docs/adr/0019-host-runtime-bridge.md` untuk mengisi slot antara ADR 0018 dan ADR 0020.
2. Referensi silang pada `docs/adr/0014-integrasi-hermes-dan-runtime-picker.md` diperbarui menunjuk ke `ADR 0020` yang benar.
3. Tidak ada lagi dokumen ADR tanpa nomor atau bernomor ganda di direktori `docs/adr/`.

### 2.3 Gerbang Kualitas Rilis (Quality Gates) Tanpa Pengecualian
Kesiapan rilis wajib dibuktikan dengan eksekusi nyata dari seluruh perintah verifikasi:
1. `pnpm test:unit`: 14 paket monorepo berhasil tanpa kegagalan (114 lulus / 1 dilewati pada API, 88 pada Windows, 54 pada Android, 58 pada Agent Worker, 10 pada Scheduler, dst).
2. `pnpm test:live`: 7 skenario live platform Fastify/WebSocket/Redis, 21 pengujian live worker (17 lulus, 4 simulasi lewati tanpa DB langsung), dan live scheduler lulus 100%.
3. `pnpm -r typecheck`: Kompilasi TypeScript strict pada 14 paket lulus tanpa error (`tsc --noEmit`).
4. `pnpm -r lint`: Pemeriksaan linter ESLint pada 14 paket lulus tanpa peringatan (`--max-warnings=0`).
5. `pnpm -r test`: Seluruh pengujian paket monorepo lulus 100%.
6. `pnpm -r build`: Pembuatan bundel produksi Vite untuk Windows dan Expo Android export selesai dengan sukses.
7. `pnpm check:tokens`: Seluruh 7 file CSS Windows UI mematuhi token desain tanpa warna hardcoded di luar sistem.
8. `pnpm verify:audit`: Seluruh 129 path referensi dokumen audit terverifikasi ada dan valid di filesystem.

### 2.4 Kebijakan Keamanan Fail-Closed & Kepatuhan Lisensi
1. **SSRF Guard**: Komponen `SsrfGuard` aktif pada pengambilan URL Deep Research dan registrasi server MCP remote, memblokir akses ke alamat IP loopback, link-local, private subnet, dan endpoint metadata cloud.
2. **Fail-Closed MCP**: Server MCP yang tidak dikenal atau gagal dijalankan otomatis dihentikan dan ditolak aksesnya ke tool registry produksi tanpa memicu crash pada sistem worker.
3. **Penyensoran Kredensial**: Modul `redactSensitiveData` otomatis menghapus authorization bearer tokens, API key OpenAI/9Router (`sk-...`), password, dan kunci privat dari audit log, tracing OpenTelemetry, dan payload embedding sebelum dikirimkan ke model gateway.
4. **Isolasi Lisensi AGPL**: Ditegaskan bahwa **0 baris kode** disalin atau diadaptasi dari proyek Odysseus (berlisensi AGPL-3.0). Seluruh implementasi riset dan pipeline sub-agent dibangun murni menggunakan arsitektur mandiri di atas dependensi MIT/Apache-2.0 yang sudah ada di repositori.
5. **Kunci Enkripsi Backup**: Skrip `scripts/backup-offsite.sh` dan `scripts/restore-offsite.sh` menggunakan algoritma enkripsi OpenSSL AES-256-CBC dengan passkey yang diwajibkan melalui environment variable `BACKUP_ENCRYPTION_KEY`, tanpa adanya fallback kunci bawaan (default guessed key) yang tidak aman.

### 2.5 Kepatuhan Aturan Eksekusi AGENTS.md (Rule 9)
Sesuai aturan kerja Rule 9, agen **DILARANG KERAS** membuat git tag, melakukan `git push`, melakukan merge ke `main`, atau memicu deploy ke VPS produksi tanpa izin eksplisit dari pemilik proyek.
Seluruh perintah eksekusi rilis disajikan secara terperinci dalam bentuk teks instruksi siap-salin untuk dieksekusi secara manual oleh pemilik proyek.

---

## 3. Konsekuensi

### Positif:
- Monorepo berada dalam status stabil, bersih, dan konsisten pada versi `0.4.0`.
- Riwayat ADR memiliki penomoran kronologis yang utuh (0001 hingga 0032).
- Bukti kualitas rilis didukung oleh keluaran aktual dari test suite lengkap (630+ tes), bukan klaim spekulatif.
- Keamanan dan batasan hak akses terverifikasi fail-closed di seluruh antarmuka.

### Keterbatasan & Pekerjaan yang Belum Selesai (Backlog):
1. **Verifikasi Tampilan Fisik (Hardware Rendering)**: Tampilan UI Windows dan Android pada resolusi fisik tertentu dan sistem operasi nyata belum diverifikasi secara visual oleh bot (memerlukan daftar periksa manual oleh pemilik).
2. **Kredensial OpenAI di 9Router**: Probe langsung pada 9Router VPS menghasilkan HTTP 400 karena belum ditambahkan API key OpenAI pada gateway 9Router. Saat ini sistem menggunakan fallback pencarian teks PostgreSQL berperingkat tinggi secara anggun.
3. **Kredensial Push Notification FCM**: `FCM_SERVICE_ACCOUNT_JSON` belum dikonfigurasi di environment VPS sehingga pengiriman push mobile saat ini menggunakan provider `DisabledFcmProvider` (bukan mock senyap; pesan dicatat dengan transparan).
4. **Sertifikat Penandatanganan EV Windows**: Installer NSIS Windows belum ditandatangani oleh sertifikat EV komersial sehingga Windows Defender SmartScreen akan menampilkan layar peringatan biru pada instalasi pertama kali.
