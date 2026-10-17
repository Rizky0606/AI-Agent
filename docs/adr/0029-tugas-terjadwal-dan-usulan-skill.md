# ADR 0029: Tugas Terjadwal (Scheduled Tasks), Ringkasan Hasil, dan Usulan Skill (Skill Proposals)

## Status
Diterima (Accepted)

## Konteks
Personal AI OS memerlukan otomatisasi tugas berkala (scheduled tasks) yang aman dan terkontrol untuk menjalankan permintaan agen (briefing harian, riset otomatis, dsb.), serta mekanisme bagi agen untuk mengusulkan skill baru atau perbaikan skill setelah task berhasil diselesaikan dan dievaluasi.

Sistem berjalan di atas Oracle Cloud VPS ARM64 (baseline 2 OCPU, 12 GB RAM) tanpa GPU, dengan prinsip keamanan:
1. Setiap tindakan berdampak wajib lewat Permission Engine; aksi `HIGH`/`CRITICAL` tidak boleh dieksekusi secara otonom tanpa persetujuan eksplisit.
2. Tidak ada penambahan dependensi pihak ketiga tanpa alasan tertulis.
3. Secret hanya di server, tersanitasi dari log dan usulan.

## Keputusan

### 1. Tugas Terjadwal (Scheduled Tasks)
- **Model Jadwal**: Mendukung tipe `one_off` (eksekusi tunggal pada waktu tertentu) dan `recurring` (harian, mingguan, atau ekspresi cron yang valid).
- **Zona Waktu Default**: `Asia/Jakarta` (WIB) untuk kenyamanan pengguna Indonesia, dengan konversi waktu UTC di backend.
- **Batas Sumber Daya VPS**:
  - Maksimal 10 jadwal aktif per pengguna (`MAX_ACTIVE_SCHEDULES_PER_USER = 10`).
  - Frekuensi minimum untuk jadwal recurring adalah 15 menit (`MIN_RECURRING_INTERVAL_MINUTES = 15`). Pola cron yang lebih sering dari 15 menit (misal `* * * * *` atau `*/5 * * * *`) ditolak secara validatif.
- **Ringkasan (Brief) & Notifikasi**:
  - Hasil eksekusi tugas terjadwal diringkas menjadi teks singkat yang disimpan di metadata task (`brief`) dan dipublikasikan ke event bus.
  - Dikirimkan notifikasi dengan tautan mendalam (`deepLink: /activity?tab=tasks&taskId=<id>`).
  - Ringkasan dapat dibuka langsung dari panel Aktivitas (Activity Panel) di antarmuka Windows dan Android.
- **Keamanan Perizinan**:
  - Eksekusi terjadwal tetap mematuhi `PermissionEngine`.
  - Jika task membutuhkan persetujuan (`waiting_approval`), eksekusi ditangguhkan dan notifikasi approval dikirim. Ini **tidak membatalkan ringkasan**; ringkasan mencatat status penangguhan ("Menunggu persetujuan untuk aksi: <aksi>").

### 2. Usulan Skill (Skill Proposals)
- **Pemicu Usulan**: Setelah task berhasil (`status === 'completed'`) dan evaluator lulus (`evaluation.passed === true`), sistem atau pengguna dapat membuat usulan skill yang merangkum pola keberhasilan task.
- **Antrean Usulan**: Usulan masuk ke tabel `skill_proposals` dengan status `'pending'`.
- **TIDAK PERNAH Aktif Otomatis**:
  - Usulan skill selalu dimulai dalam keadaan nonaktif.
  - Ketika disetujui oleh pengguna, skill baru dicatat di tabel `skills` dengan `isEnabled: false`. Pengguna harus mengaktifkannya secara eksplisit.
- **Filter Data Sensitif (Secret Sanitization)**:
  - Sebelum disimpan ke `skill_proposals`, isi manifest dan instruksi prompt disaring melalui `sanitizeSensitiveText()`.
  - Token otentikasi (`Bearer ...`), API keys (`sk-...`), sandi, private IP, dan kredensial disaring menjadi `[REDACTED]`. Usulan yang masih mengandung pola secret berisiko ditolak secara otomatis.
- **Perbaikan Skill yang Ada (Skill Improvement)**:
  - Jika usulan ditujukan untuk memperbarui skill yang ada, usulan menyimpan unified diff (`diff`) yang membandingkan manifest lama vs baru.
- **Audit Logging**:
  - Pembuatan usulan, persetujuan, dan penolakan dicatat di tabel `audit_logs` (`skill.proposed`, `skill_proposal.approved`, `skill_proposal.rejected`).

### 3. Fitur Di Luar Lingkup (Out of Scope)
Sesuai arahan Sesi 28, fitur-fitur berikut sengaja TIDAK dibangun pada sesi ini:
1. **Email Assistant dan Calendar / CalDAV**:
   - *Alasan*: Memerlukan akses data pribadi sangat sensitif dan scope OAuth besar (Google Workspace / Microsoft Graph / CalDAV) yang belum diaudit protokol keamanannya.
2. **Image Gallery dan Inpaint**:
   - *Alasan*: Membutuhkan model pembuatan/pengeditan gambar (seperti Stable Diffusion/Flux) dan kapasitas penyimpanan disk besar yang membebani VPS.
3. **Cookbook Model Lokal**:
   - *Alasan*: VPS ARM64 baseline 2 OCPU / 12 GB RAM tidak memiliki GPU dan tidak dirancang untuk inferensi LLM lokal (aturan AGENTS.md: dilarang ada inferensi LLM lokal di VPS).
4. **Editor Documents**:
   - *Alasan*: Di luar prioritas inti asisten AI berbasis percakapan dan agen durable.

## Konsekuensi
- Memerlukan migrasi database `0018_scheduled_task_briefs_and_skill_proposals.sql` dan entri Drizzle di `schema.ts`.
- Antarmuka Windows menambahkan dialog pembuatan jadwal (modal scheduler) dan tab "Usulan Skill" di Skill Manager dengan peninjauan diff.
