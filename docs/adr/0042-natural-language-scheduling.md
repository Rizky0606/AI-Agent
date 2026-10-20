# ADR 0042: Penjadwalan Tugas Berbasis Bahasa Alami (Natural-Language Scheduling) dan Tool Suite Terpusat

## Status
Accepted

## Konteks
Personal AI OS memerlukan antarmuka penjadwalan tugas cerdas yang memungkinkan pengguna membuat, melihat, memperbarui, menjeda, melanjutkan, dan membatalkan jadwal berkala maupun eksekusi tunggal (*one-off*) menggunakan bahasa alami (Bahasa Indonesia dan Bahasa Inggris). Contoh instruksi:
- "Jalankan riset ringkasan AI setiap hari jam 08:00 WIB"
- "Ingatkan evaluasi performa server besok jam 14:00"
- "Update jadwal riset jadi jam 09:00 WIB"

Namun, penjadwalan otomatis berbasis bahasa alami memiliki sejumlah risiko kritis jika tidak dikendalikan dengan batasan arsitektur yang ketat:
1. **Risiko Halusinasi & Tebakan Waktu (*Ambiguity Guessing*)**: Frasa seperti "besok pagi", "nanti sore", atau "minggu depan" tidak memiliki jam spesifik. Menjadwalkan tugas pada waktu tebakan model dapat menimbulkan tindakan yang tidak diinginkan pengguna atau kegagalan kepatuhan operasional.
2. **Risiko Penumpukan & Spam Antrean (*Queue Exhaustion*)**: Tugas terjadwal yang terlalu sering (misal setiap 1 menit) dapat membebani antrean BullMQ, Redis, dan sumber daya VPS ARM64 (baseline 2 OCPU / 12 GB RAM).
3. **Risiko Bypass Izin (*Permission Circumvention*)**: Tugas yang berjalan di latar belakang tanpa pengguna aktif di chat rentan mengeksekusi aksi sensitif jika tidak diawasi oleh Permission Engine.
4. **Risiko Fragmentasi State (*Split-Brain Architecture*)**: Jika agent menulis jadwal langsung ke Redis, cron host lokal, atau worker independen di luar database kontrol PostgreSQL.

## Keputusan Arsitektur

### 1. Single Source of Truth & Zero Split-Brain
- PostgreSQL (tabel `schedules`, `tasks`, `audit_logs`) tetap menjadi satu-satunya sumber kebenaran (*single source of truth*) untuk seluruh jadwal, riwayat run, audit, dan status persetujuan.
- Redis dan BullMQ hanya berperan sebagai transport antrean eksekusi dan delayed timers, bukan penyimpanan data jadwal primer.

### 2. Tool Suite Terpusat (`packages/tools`)
Sistem mengimplementasikan 6 tools penjadwalan terpusat yang didaftarkan ke `DefaultToolRegistry`:
1. `schedule_task`: Membuat jadwal baru (one-off atau recurring) baik melalui parameter terstruktur maupun instruksi bahasa alami (`instruction`).
2. `list_scheduled_tasks`: Menampilkan daftar jadwal aktif, jeda, atau selesai milik pengguna dengan informasi `nextRunAt`, status, dan metadata.
3. `pause_scheduled_task`: Menjeda jadwal aktif (*status: 'paused'*), menghapus timer tertunda dari antrean.
4. `resume_scheduled_task`: Mengaktifkan kembali jadwal yang dijeda (*status: 'active'*), menghitung ulang waktu jalan berikutnya.
5. `update_scheduled_task`: Memperbarui konfigurasi jadwal (nama, prompt, ekspresi cron, runAt, timezone, atau missed-run policy).
6. `cancel_scheduled_task`: Membatalkan/menghapus jadwal secara permanen atau menandai selesai (*cancelled*).

**Aturan Delegasi**: Seluruh tool ini berinteraksi secara ketat melalui kontrak antarmuka `ScheduleDispatcher` yang memanggil `SchedulerEngine` / REST API scheduler (`/v1/schedules`). Tool dilarang keras memanipulasi Redis langsung atau membuat loop cron worker baru di runtime agent.

### 3. Parser Bahasa Alami Deterministik & Anti-Guessing Guard
- Modul parser bahasa alami (`NaturalLanguageScheduleParser`) beroperasi secara deterministik tanpa dependensi eksternal yang tidak diaudit.
- **Dukungan Waktu & Zona Waktu**:
  - Zona waktu default adalah `Asia/Jakarta` (WIB, UTC+7).
  - Mendukung alias zona waktu Indonesia: WIB (UTC+7), WITA (UTC+8), WIT (UTC+9), serta UTC/GMT.
  - Seluruh waktu internal disimpan dan dikonversi ke ISO 8601 UTC secara konsisten.
- **Anti-Guessing Guard (Penolakan Ambiguitas)**:
  - Instruksi yang mengandung pola waktu ambigu tanpa jam eksplisit (misal: "besok pagi", "nanti", "minggu depan", "siang ini", "beberapa hari lagi") secara tegas **ditolak dari pembuatan jadwal otomatis**.
  - Parser mengembalikan `{ success: false, ambiguous: true, requires_confirmation: true, reason: ..., suggestedClarification: ... }`.
  - Tool meminta klarifikasi waktu yang pasti kepada pengguna (misal: "Mohon tentukan jam eksekusi yang spesifik, contoh: 'besok jam 08:00 WIB'") sebelum jadwal dapat dibuat.

### 4. Penegakan Kuota & Batas Keamanan Sumber Daya (ADR 0029 Compliance)
- **Batas Maksimal Jadwal Aktif**: Maksimal 10 jadwal aktif per pengguna (`MAX_ACTIVE_SCHEDULES_PER_USER = 10`). Permintaan pembuatan jadwal ke-11 ditolak dengan pesan kuota tercapai.
- **Batas Interval Minimum**: Frekuensi minimum untuk jadwal berkala (*recurring*) adalah 15 menit (`MIN_RECURRING_INTERVAL_MINUTES = 15`). Pola cron yang lebih rapat dari 15 menit (misal `* * * * *`, `*/5 * * * *`, `setiap 5 menit`) ditolak dengan pesan kesalahan validasi.
- **Missed-Run Policy**: Mendukung 3 kebijakan ketika server mengalami restart/downtime:
  - `skip`: Melompati putaran yang terlewat dan menjadwalkan ke putaran berikutnya (default).
  - `run_once`: Menjalankan satu kali eksekusi untuk menggantikan run yang terlewat.
  - `catch_up`: Menjalankan run yang terlewat secara berurutan dengan batas aman.

### 5. Durable Task Execution & Kepatuhan Permission Engine
- Setiap putaran jadwal yang terpicu membuat durable task di tabel `tasks` dengan tipe `scheduled` dan diproses oleh `agent-worker`.
- **Self-Contained Prompts**: Karena tugas terjadwal berjalan di latar belakang tanpa percakapan langsung pengguna, prompt tugas harus memuat konteks mandiri. Hanya memori dan skill yang diizinkan yang dapat diinjeksi.
- **Zero Permission Bypass**:
  - `TaskExecutor` mengeksekusi tugas terjadwal di bawah pengawasan ketat `PermissionEngine` dan `SecuredCapabilityGuard`.
  - Aksi berdampak tingkat `HIGH` atau `CRITICAL` (misal modifikasi sistem produksi, pengiriman pesan eksternal, perubahan data penting) **wajib tetap berstatus `waiting_approval`**.
  - Sistem tidak menyiasati persetujuan karena alasan dijalankan oleh scheduler otomatis. Notifikasi dengan deep link persetujuan resmi dikirim ke aplikasi klien pengguna (Windows/Android).

### 6. Ringkasan Hasil & Saluran Notifikasi Aman
- Hasil akhir tugas terjadwal diringkas menjadi `brief` yang disimpan pada metadata task.
- Notifikasi hasil brief dipublikasikan melalui `NotificationEngine` yang telah ada.
- Seluruh token otentikasi, API key, password, dan IP privat diredaksi (`[REDACTED]`) sebelum dikirimkan ke event bus atau notifikasi push.

## Konsekuensi & Dampak
1. **Peningkatan Keamanan**: Mengeliminasi risiko eksekusi aksi sensitif tanpa izin dari background job dan mencegah spam antrean pada VPS.
2. **Determinisme & UX yang Andal**: Pengguna mendapatkan kejelasan waktu eksekusi yang transparan dan konfirmasi eksplisit untuk instruksi yang tidak lengkap.
3. **Keterlacakan Penuh**: Setiap mutasi jadwal (create, update, pause, resume, cancel) dan setiap putaran eksekusi tercatat di audit trail PostgreSQL.
4. **Tidak Ada Dependensi Baru**: Parser bahasa alami dan tool suite dibangun menggunakan TypeScript murni tanpa penambahan pustaka pihak ketiga di package.json.
