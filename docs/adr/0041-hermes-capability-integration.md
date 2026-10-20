# ADR 0041: Integrasi Kapabilitas Hermes, Katalog Read-Only, dan Siklus Proposal Skill

## Status
Accepted

## Konteks
Personal AI OS mendukung multi-runtime untuk eksekusi tugas, termasuk runtime native dan eksternal seperti Hermes. Berdasarkan investigasi dan probe read-only (Sesi 3 & ADR 0035), CLI Hermes mendukung eksekusi non-interaktif terisolasi via `hermes -z <prompt> --no-restore-cwd --safe-mode`. Sebaliknya, daemon HTTP lokal Hermes (port 9119) hanya berfungsi sebagai dashboard UI lokal dan tidak memiliki kontrak endpoint eksekusi prompt yang aman dan terotentikasi.

Untuk mengintegrasikan kapabilitas Hermes secara aman dan andal ke dalam sistem tanpa menimbulkan kerentanan keamanan, pelanggaran izin, atau duplikasi data:
1. Pemilihan runtime, status kesehatan runtime, dan fallback harus transparan dan eksplisit ke pengguna (tidak disamarkan secara diam-diam).
2. Katalog skill Hermes harus berlabel sumber dan strictly read-only; sistem tidak boleh menulis atau memodifikasi disk direktori skill Hermes secara sepihak.
3. Seluruh output teks maupun error dari runtime eksternal dan sinkronisasi skill harus disanitasi dari kebocoran kredensial/rahasia (Bearer token, sk-* API keys, passwords) dan dibungkus sebagai konten tidak tepercaya (*untrusted content*) agar tidak memicu prompt injection.
4. Usulan skill baru berbasis task coding yang sukses wajib memiliki rekam jejak (*provenance*), manifest, test cases, mitigasi risiko, dan justifikasi. Saat disetujui (approval), skill wajib tetap dalam keadaan nonaktif (`isEnabled: false`) hingga pengguna mengaktifkannya secara eksplisit.
5. Approval dan penolakan usulan skill wajib tercatat dalam `audit_logs`.
6. Cron dan subagent Hermes tidak boleh disamakan dengan durable scheduler dan durable subagent host. PostgreSQL tetap menjadi *single source of truth* untuk seluruh state, pembatalan, audit, dan deduplikasi.
7. Gateway 9Router di backend tetap menjadi satu-satunya jalur panggilan model AI OS; Hermes tidak menyimpan kredensial vendor independen tanpa policy yang disetujui.
8. Tidak membuat bot Telegram kedua; gateway perpesanan berada di luar runtime Hermes.

## Keputusan Arsitektur

### 1. Eksekusi Hermes Terisolasi (Non-Interactive CLI)
- Hermes dijalankan hanya melalui CLI batch terisolasi: `hermes -z <prompt> --no-restore-cwd --safe-mode`.
- Endpoint daemon HTTP Hermes di port 9119 dilarang keras digunakan untuk eksekusi prompt karena ketiadaan rute terverifikasi dan skema otentikasi resmi.
- Runtime timeout, crash, dan exit code non-zero dicatat secara jujur sebagai kegagalan dengan error yang disanitasi (tidak pernah disamarkan sebagai sukses).

### 2. Pemilihan Runtime Transparan & Fallback Eksplisit
- `RuntimeManager` memeriksa kesehatan runtime sebelum eksekusi.
- Jika pengguna meminta runtime Hermes (atau OMP) namun runtime tersebut tidak sehat atau tidak tersedia, sistem melakukan fallback ke runtime yang sehat (misalnya native/isolated) HANYA jika kebijakan mengizinkan.
- Sistem mencatat secara eksplisit `originalRuntimeId`, `selectedRuntimeId`, dan `fallbackReason` dalam bahasa Indonesia.
- Peristiwa fallback dibroadcast secara transparan ke antarmuka pengguna melalui event `task.progress` dengan payload `action: 'runtime_fallback'` dan keterangan alasan yang jujur.
- Pilihan runtime hasil fallback disimpan ke dalam checkpoint/payload task agar status tersebut bertahan saat task dijeda (*pause*) atau dilanjutkan (*resume*).

### 3. Perlindungan Katalog Skill Hermes (Strictly Read-Only)
- Skill bawaan atau katalog eksternal Hermes diidentifikasi dengan awalan nama (`hermes_`, `hermes-`) atau metadata `source: 'hermes'`.
- Seluruh endpoint mutasi skill (`toggle`, `enable`, `disable`, `rollback`) menolak modifikasi terhadap skill Hermes dengan status HTTP 403 Forbidden.
- Endpoint sinkronisasi filesystem (`/v1/skills/sync`) melompati (*skip*) skill Hermes agar file pada disk Hermes tidak tertimpa secara otomatis.

### 4. Sanitasi Rahasia & Isolasi Konten Tidak Tepercaya
- Teks luaran (`result.output`) dan pesan kesalahan (`result.error`) dari runtime diproses melalui `sanitizeRuntimeText()` dengan regex pola rahasia (`RUNTIME_SECRET_PATTERNS`) yang meredaksi token Bearer, API key OpenAI/Anthropic/Google, password, dan kredensial privat ke `[REDACTED]`.
- Output Hermes dibungkus dalam tag `<untrusted_content is_instruction="false">...</untrusted_content>` untuk memastikan model atau parser downstream tidak memperlakukannya sebagai instruksi sistem.
- Sinkronisasi metadata menyaring payload JSON melalui `sanitizeSensitiveJson()` guna memisahkan metadata tepercaya dari instruksi bebas dalam manifest.

### 5. Siklus Usulan Skill (Proposal Lifecycle) yang Terkontrol
- Saat task coding yang berhasil mengusulkan skill baru (`proposeSkillFromCodingTask`), payload usulan wajib menyertakan:
  - `provenance`: `taskId`, `userId`, `projectId`, dan `extractedAt`.
  - `proposedManifest`: Manifest terstruktur lengkap dengan nama, versi, deskripsi, skema input/output, dan permission requirements.
  - `testCases`: Skenario pengujian minimal untuk memvalidasi fungsi skill.
  - `riskLevel`: Klasifikasi risiko keamanan awal (minimal `MEDIUM`).
  - `reason`: Justifikasi teknis mengapa skill ini diusulkan.
  - `diff`: Teks pembanding jika usulan berupa pembaruan skill yang sudah ada.
- Tidak ada aktivasi otomatis. Usulan selalu dimulai dengan status `pending`.
- Persetujuan usulan (`/v1/skills/proposals/:id/approve`):
  - Memperbarui status usulan menjadi `approved`.
  - Menyimpan skill ke repositori dengan status strictly nonaktif (`isEnabled: false`). Pengguna harus mengaktifkannya secara sadar melalui pengaturan proyek/skill.
  - Mencatat aksi `skill_proposal.approved` ke dalam `audit_logs`.
- Penolakan usulan (`/v1/skills/proposals/:id/reject`):
  - Memperbarui status usulan menjadi `rejected` dengan alasan penolakan.
  - Mencatat aksi `skill_proposal.rejected` ke dalam `audit_logs`.

### 6. Batas Batas Arsitektural & Single Source of Truth
- **Kepemilikan Tugas**: PostgreSQL adalah sumber kebenaran tunggal untuk task lifecycle, checkpoint durable, persetujuan, dan audit trail. Sesi internal Hermes tidak dijadikan acuan status resmi AI OS.
- **Deduplikasi & Kaskade Pembatalan**: Pembatalan task dari Personal AI OS segera menghentikan proses child/subprocess dan mengalirkan event pembatalan ke seluruh worker.
- **Integritas Gateway Model**: Seluruh inferensi AI tetap melewati gateway 9Router di backend. Hermes tidak diizinkan menyimpan API key penyedia pihak ketiga di lingkungan produksinya.
- **Ketiadaan Bot Telegram Kedua**: Sistem tetap menggunakan kanal integrasi pesan tunggal yang telah ditentukan; Hermes tidak diizinkan meluncurkan listener Telegram independen.

## Konsekuensi & Bukti
- **Keamanan Terjamin**: Kredensial dan token API tidak bocor ke log, UI, atau downstream prompt; serangan prompt injection dari output eksternal dinetralisasi.
- **Integritas File**: Direktori skill Hermes aman dari penulisan atau kerusakan tak disengaja.
- **Transparansi Operasional**: Pengguna selalu mengetahui runtime aktual yang mengeksekusi instruksi serta alasan rasional bila terjadi fallback.
- **Verifikasi Komprehensif**: Diuji melalui unit test `hermes-capability.test.ts` (5 lulus), `skills.test.ts` (5 lulus), `schedules-and-skill-proposals.test.ts` (4 lulus), serta `pnpm -r typecheck` dan `pnpm -r lint` (14/14 workspace bersih).
