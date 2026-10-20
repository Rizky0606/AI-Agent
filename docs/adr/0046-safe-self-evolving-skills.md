# ADR 0046: Safe Self-Evolving Skills Architecture, Sandbox Test Harness, and Rollback Circuit Breaker

## Status
Diterima (Accepted)

## Konteks
Personal AI OS bertujuan menjadi asisten AI pribadi yang adaptif dan mampu belajar secara inkremental dari tugas-tugas yang berhasil diselesaikan ("self-evolving skills"). Namun, membiarkan model atau runtime agen menulis, memodifikasi, atau mengeksekusi kode/skill secara aktif dan otonom tanpa batasan ("unrestricted self-modification") membawa risiko kritis:
1. **Privilege Escalation & Security Boundary Bypass**: Model dapat meminta permission berbahaya (eksekusi shell tidak terbatas, akses root, modifikasi firewall/systemd, atau override terhadap Security Policy).
2. **Credential Leakage**: Prompt atau log eksekusi sering memuat token otentikasi, API key, atau kredensial internal yang dapat bocor ke dalam manifest usulan skill.
3. **Infinite Repair Loops**: Kegagalan berulang yang memicu loop self-repair tanpa batas dapat menghabiskan kuota model gateway 9Router dan sumber daya VPS (ARM64 2 OCPU / 12 GB RAM).
4. **Silent Runtime Corruption**: Mengubah perilaku asisten tanpa persetujuan eksplisit pengguna merusak prediktabilitas dan integritas asisten.

ADR 0029 telah meletakkan fondasi dasar usulan skill (status pending dan disabled by default). ADR 0046 ini memformalisasikan dan memperketat seluruh siklus hidup evaluasi mandiri, verifikasi sandbox, mitigasi kegagalan, dan rollback.

## Keputusan

### 1. Evaluator Gating yang Ketat (No Self-Claim)
Usulan skill baru (`new_skill`) atau perbaikan skill yang ada (`improvement`) HANYA dapat diinisiasi oleh sistem/evaluator bila kondisi berikut terpenuhi secara faktual:
- Status task adalah `completed`.
- Evaluator memverifikasi keberhasilan task (`evaluation.passed === true`).
- Skor kualitas evaluator memenuhi ambang batas minimum $\ge 0.85$ (`score >= 0.85`).
- Klaim sepihak tanpa bukti ditolak (`evaluation.selfClaimRejected === false`).
- Jika task gagal atau dihentikan di tengah jalan, pembuatan usulan skill DITOLAK secara tegas.

### 2. Struktur Proposal Bersih dan Bebas Secret
Proposal skill (`SkillEvolutionProposal`) wajib memuat:
- `id`: UUID unik usulan.
- `name` & `title`: Identitas slug dan judul manusiawi.
- `purpose`: Deskripsi kegunaan yang telah disanitasi dari data sensitif.
- `sourceTaskIds`: Daftar ID task sumber (HANYA ID task; TIDAK PERNAH menyertakan prompt mentah, argumen sensitif, atau hasil mentah).
- `manifest`: Definisi `SkillManifest` valid per skema TypeScript strict.
- `requiredTools`: Daftar tool yang dibutuhkan, diaudit terhadap tool registry.
- `permissions`: Daftar izin yang dibutuhkan, diperiksa terhadap `FORBIDDEN_SKILL_ACTIONS`.
- `testCases`: Minimal 1 test case valid dengan fixture input dan ekspektasi output untuk verifikasi sandbox.
- `risk`: Tingkat risiko (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) dihitung berdasarkan hak akses tertinggi yang diminta.
- `changeType`: `'new_skill'` atau `'improvement'`.
- `diff`: Unified diff (`--- a/skill.json`, `+++ b/skill.json`) yang dihasilkan bila tipe perubahan adalah `improvement`.
- `testStatus`: Status uji sandbox (`pending`, `passed`, `failed`).

### 3. Sanitasi Kredensial dan Validasi Batas Keamanan (ManifestValidator)
- **Sensitive Data Filter**: Seluruh teks tujuan (`purpose`), instruksi prompt (`promptInstructions`), dan metadata manifest dibersihkan secara otomatis menggunakan pola sanitasi regex untuk token `Bearer`, API key `sk-*`, kata sandi `password: ...`, dan subnet IP privat (`10.x.x.x`, `192.168.x.x`, `172.16-31.x.x`).
- **Verifikasi Batas Terlarang (`FORBIDDEN_SKILL_ACTIONS`)**: Proposal dilarang keras meminta aksi sistemik yang berbahaya:
  - `system:rmdir_root`, `system:shutdown`, `system:reboot`
  - `security:override_policy`, `security:bypass_guard`
  - `runtime:arbitrary_eval`, `runtime:raw_socket`
  - `host:exec_unrestricted`
- Proposal yang meminta aksi terlarang atau memuat secret yang belum disanitasi langsung ditolak dengan `SkillPermissionViolationError` / status keamanan `safe: false`.

### 4. Sandbox Test Harness Terisolasi
Sebelum proposal dapat diserahkan ke pengguna untuk persetujuan:
- Test cases dijalankan di dalam harness sandbox terisolasi (`SkillEvolutionEngine.runSandboxTestHarness`).
- Batas sumber daya wajib eksplisit:
  - Timeout per test case: maksimal 5.000 ms (`DEFAULT_SANDBOX_TIMEOUT_MS = 5000`).
  - Percobaan ulang (retry): dibatasi maksimal 1 kali (`MAX_SANDBOX_RETRIES = 1`). Tidak boleh ada loop tanpa batas.
  - Runtime terisolasi dengan mock context `userId: 'sandbox-test-runner'`, tanpa akses filesystem/host luar.
- **Gerbang Keamanan Approval**: Proposal yang gagal dalam sandbox harness (`testStatus === 'failed'`) **DITOLAK SECARA MUTLAK** dari persetujuan (`HTTP 400: Proposal gagal pengujian sandbox dan tidak dapat disetujui`).

### 5. Pemisahan Tegas Approval vs Aktivasi (Separation of Concerns)
- Proposal yang disetujui oleh pengguna dicatat ke registry/database dengan status **NONAKTIF** (`isEnabled: false`).
- Persetujuan (approval) TIDAK SAMA dengan aktivasi. Pengguna harus mengaktifkannya secara eksplisit melalui endpoint atau UI aksi (`enableSkill`).
- Panggilan terhadap skill nonaktif segera memicu `SkillDisabledError` fail-closed tanpa menjalankan handler.

### 6. Versioning dan Rollback Deterministik
- Setiap pembaruan skill menyimpan arsip versi sebelumnya ke dalam riwayat revisi (`SkillRevisionRecord`).
- Rollback mengembalikan manifest dan handler ke versi stabil terakhir yang diketahui baik (*known-good version*).
- Rollback secara otomatis mereset counter kegagalan beruntun (`consecutiveFailures = 0`) dan menghapus alasan auto-disable.

### 7. Circuit Breaker Otomatis
- Jika sebuah skill yang aktif mengalami 3 kali kegagalan eksekusi berturut-turut (`consecutiveFailures >= 3`):
  - Skill secara otomatis dinonaktifkan (`isEnabled = false`).
  - Alasan dicatat pada `autoDisabledReason`.
  - Audit log mencatat insiden penonaktifan darurat.
  - Memerlukan tinjauan manusia atau pengaktifan ulang manual oleh pengguna setelah masalah akar diperbaiki.

## Konsekuensi & Bukti Implementasi
1. Modul inti terpasang di `@personal-ai-os/agent-core`:
   - `packages/agent-core/src/skills/types.ts`: Menambahkan kontrak tipe evolusi skill, test case, dan circuit breaker.
   - `packages/agent-core/src/skills/manifest-validator.ts`: Memperluas `FORBIDDEN_SKILL_ACTIONS`.
   - `packages/agent-core/src/skills/skill-evolution-engine.ts`: Mengimplementasikan eligibility check, proposal generator, sanitasi, sandbox harness, dan verifikasi keamanan.
   - `packages/agent-core/src/skills/skill-registry.ts`: Menambahkan versioning rollback, circuit breaker auto-disable, dan preserving status `isEnabled`.
2. Integrasi API Fastify di `apps/api`:
   - `apps/api/src/routes/skill-proposals.ts`: Menegakkan penolakan approval untuk proposal dengan `testStatus === 'failed'`.
3. Seluruh 67 test unit di `@personal-ai-os/agent-core` dan 134 test di `@personal-ai-os/api` lulus 100%.
