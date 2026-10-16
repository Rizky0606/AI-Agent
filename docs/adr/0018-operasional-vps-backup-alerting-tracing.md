# ADR 0018: Arsitektur Operasional VPS — Backup Offsite, Alerting Telegram, dan Tracing OpenTelemetry

## Status
Diterima (Accepted) — *Sesi 16 Operasional VPS.*

## Konteks
Personal AI OS berjalan pada infrastruktur VPS Oracle Cloud ARM64 (2 OCPU / 12 GB RAM) dengan batasan sumber daya yang ketat. Berdasarkan temuan operasional:
1. **Backup Database**: Backup PostgreSQL harian (`pg_dump`) dan restore drill telah teruji secara lokal di VPS, namun belum memiliki replika cadangan di luar server (*offsite backup*) untuk mitigasi bencana (*disaster recovery* jika VPS mengalami kegagalan total atau kehilangan data).
2. **Alerting Sistem**: Belum ada sistem deteksi dini otomatis yang memberitahukan kegagalan kritis (seperti API `/ready` down, antrean BullMQ macet, kegagalan backup, disk penuh, atau sertifikat TLS yang akan kedaluwarsa).
3. **Observability & Tracing**: Sesuai arsitektur stack, OpenTelemetry diperlukan untuk melacak alur *client -> API -> worker -> model*, namun tidak boleh membebani alokasi RAM 12 GB dengan container monitoring mandiri yang berat (seperti Prometheus + Grafana internal).
4. **FCM (Firebase Cloud Messaging)**: Provider FCM sudah mendukung penukaran token OAuth2 berbasis Service Account, namun memerlukan mekanisme injeksi file kredensial yang aman (*secret file*) tanpa pernah mengekspos secret ke repository.

## Keputusan Arsitektur

### 1. Backup Offsite Oracle Object Storage (S3-Compatible) Terenkripsi
- **Format & Enkripsi**: Snapshot `pg_dump` dikompresi dan dienkripsi menggunakan enkripsi asimetris modern (`age` atau AES-256-GCM dengan public key) sebelum meninggalkan server. Kunci privat untuk dekripsi **dilarang disimpan di server yang sama dengan backup**, melainkan disimpan di mesin lokal pengguna/administrator.
- **Protokol Transfer**: Menggunakan API kompatibel S3 menuju Oracle Cloud Object Storage bucket khusus cadangan.
- **Kredensial**: Parameter S3 (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) diinjeksikan secara eksklusif melalui file secret `/etc/personal-ai-os/s3-backup.env` dengan hak akses terbatas (`chmod 600`).
- **Siklus Hidup & Retensi (Lifecycle)**:
  - Local dump di server: rotasi otomatis 14 hari (`RETENTION_DAYS=14`).
  - Offsite dump di bucket: retention policy 90 hari, dengan otomatis transisi ke Archive Storage setelah 30 hari untuk efisiensi biaya penyimpanan.
- **Restore Drill**: Prosedur pemulihan dari offsite diuji secara berkala dengan memverifikasi checksum SHA-256 dan integritas jumlah baris tabel kunci (`users`, `tasks`, `memories`, `audit_logs`).

### 2. Alerting Minimal yang Realistis via Telegram Bot yang Ada
- **Kanal Notifikasi**: Memanfaatkan bot Telegram yang sudah ada (terhubung ke akun Telegram pengguna via Hermes atau token bot pemilik) tanpa membuat daemon bot kedua.
- **Komponen Pemeriksa (Health & Alert Monitor)**: Pemeriksa terjadwal (interval 5 menit) yang memvalidasi 5 pilar kesehatan VPS:
  1. Status ketersediaan API `/health` dan `/ready` (memeriksa kesiapan Fastify, PostgreSQL, dan Redis).
  2. Status antrean task BullMQ (mendeteksi antrean yang macet, jobs gagal beruntun, atau delayed jobs berlebih).
  3. Status kesegaran backup (memastikan backup berhasil dibuat dalam rentang 26 jam terakhir).
  4. Kapasitas penyimpanan disk host (ambang batas peringatan > 85% pemakaian disk).
  5. Masa berlaku sertifikat SSL/TLS domain (ambang batas peringatan jika masa aktif tersisa < 14 hari).
- **Anti-Spam & Throttling**: Alert yang sedang berlangsung menerapkan cooldown (misal 30 menit per jenis insiden) agar tidak membanjiri chat Telegram pengguna saat terjadi insiden berulang.

### 3. Tracing OpenTelemetry Terdistribusi Minimal & Hemat Sumber Daya
- **Propagasi W3C Trace Context**: Klien dan API menyertakan header standar `traceparent` (`00-<trace_id>-<span_id>-<flags>`), yang kemudian dipropagasikan ke payload job BullMQ dan dieksekusi di Worker.
- **Sampling Rendah & Adaptif**:
  - Transaksi normal/sukses disampling dengan rasio rendah (default 10% / 0.1) untuk menekan konsumsi CPU dan memori.
  - Transaksi yang menghasilkan error (`status: 'error'`, HTTP 5xx, atau exception) disampling 100% untuk visibilitas debugging insiden.
- **Redaksi Data Sensitif**: Atribut span dan log trace secara ketat menghapus (*redact*) nilai sensitif seperti Authorization header, kata sandi, API key, token JWT, identitas pribadi (NIK/kartu kredit), serta prompt mentah yang berisiko memuat kredensial.
- **Metrik Prometheus Ringan**: `TelemetryTracer` internal mengekspos metrik agregat pada endpoint `/metrics` untuk di-scrape oleh monitoring eksternal tanpa memerlukan instalasi database time-series lokal.

### 4. Injeksi Kredensial FCM via Secret File
- File Service Account JSON Google diletakkan pada host di direktori `/etc/personal-ai-os/fcm-service-account.json` (milik user `root`/`ubuntu`, izin akses `600`).
- Container API dan Scheduler membaca file ini melalui environment `FCM_SERVICE_ACCOUNT_JSON=/etc/personal-ai-os/fcm-service-account.json` atau bind-mount `/etc/personal-ai-os/fcm-service-account.json:/run/secrets/fcm-service-account.json:ro`.

---

## Alternatif yang Ditolak

| Alternatif | Alasan Penolakan |
|---|---|
| **Prometheus Server + Alertmanager + Grafana lokal di VPS** | Menghabiskan ~1.5 - 2 GB RAM dan disk I/O konstan pada VPS baseline 12 GB, mempersempit headroom untuk eksekusi model/browser automation. Cukup gunakan endpoint `/metrics` yang diekspor dari aplikasi. |
| **PagerDuty / Opsgenie** | Layanan komersial berbayar dan menambah ketergantungan eksternal pihak ketiga yang berlebihan untuk sistem asisten pribadi. |
| **Membuat Bot Telegram Kedua Khusus Alerting** | Ditolak karena melanggar prinsip *Single Telegram Instance* (ADR 0014) yang membingungkan pengguna dan memerlukan pengelolaan token serta webhook ganda. |
| **Notifikasi Alert melalui Email SMTP** | Rawan mengalami *delivery delay*, terperangkap di folder spam, dan kurang sigap untuk insiden kritis yang membutuhkan respons cepat dibanding pesan instan Telegram. |
| **Backup Offsite Tidak Terenkripsi (Plaintext SQL Dump)** | Risiko keamanan fatal: jika bucket penyimpanan pihak ketiga bocor, seluruh data pribadi, riwayat obrolan, dan token perangkat dapat terekspos. |

---

## Konsekuensi

### Positif
- Cadangan database memiliki ketahanan bencana tingkat tinggi (*disaster recovery readiness*) dengan jaminan privasi enkripsi end-to-end.
- Administrator langsung mendapatkan notifikasi instan di Telegram saat terjadi anomali VPS sebelum berdampak pada ketersediaan layanan.
- Observability alur *end-to-end* tersedia tanpa mengorbankan performa atau konsumsi RAM VPS.
- Kredensial FCM terisolasi rapi pada level host filesystem tanpa pernah masuk ke git atau image docker.

### Batasan
- Pemulihan dari backup offsite memerlukan kunci privat dekripsi yang dipegang pengguna secara aman di luar VPS.
- Pengujian push FCM ke perangkat Android fisik memerlukan tindakan manual pengguna untuk mengunduh APK dan mendaftarkan push token.
