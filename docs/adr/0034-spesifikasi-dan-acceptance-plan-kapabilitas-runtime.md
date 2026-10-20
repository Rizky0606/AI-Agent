# ADR 0034: Spesifikasi dan Rencana Penerimaan (Acceptance Plan) 9 Kapabilitas Runtime

- **Status**: Diusulkan (Proposed) — Spesifikasi & Rencana Penerimaan Sesi 2
- **Tanggal**: 19 Oktober 2026
- **Penulis**: Principal Software Architect, Senior Full-Stack Engineer, AI Agent Systems Engineer, Security Engineer, QA Engineer
- **Area**: Runtime Bridge (`apps/runtime-bridge`), Agent Core (`packages/agent-core`), Tools (`packages/tools`), Worker (`apps/agent-worker`), API & DB (`apps/api`), Frontend (`apps/windows`, `apps/android`)
- **Referensi Terkait**: ADR 0013, ADR 0014, ADR 0019, ADR 0020, ADR 0028, ADR 0029, ADR 0030, ADR 0031, ADR 0032, ADR 0033

---

## 1. Konteks & Tujuan Sesi 2

Berdasarkan hasil baseline audit dan rekonsiliasi fakta Sesi 1, sistem **Personal AI OS** memiliki execution plane yang stabil namun memiliki kesenjangan (*gap*) antara kapabilitas riil yang terverifikasi dengan fitur-fitur lanjutan yang diusulkan pada ekosistem agen open-source.

Sesuai instruksi Sesi 2 (*SPESIFIKASI DAN ACCEPTANCE PLAN*):
- **Sesi ini TIDAK melakukan modifikasi kode, skema basis data, instalasi dependensi, atau perubahan host runtime**.
- Seluruh spesifikasi disusun berbasis fakta empiris dari repositori aktif.
- Menetapkan matriks keputusan, model keamanan, kontrak data, penanganan kegagalan, dan acceptance criteria objektif untuk **9 kapabilitas inti**.

---

## 2. Matriks Keputusan & Spesifikasi 9 Kapabilitas

---

### Kapabilitas 1: OMP RPC Dua Arah / Sesi Persisten / Streaming Event

#### A. Current State Berbukti
- **Invokasi**: [apps/runtime-bridge/src/index.ts:184-196](file:///c:/Coding/Project/AI-Agent/apps/runtime-bridge/src/index.ts#L184-L196) mengeksekusi biner `omp` dalam mode batch subproses per-task: `omp -p <prompt> --mode json [--session <sessionId>] [--resume]`.
- **Kanal Stdio**: `stdio: ['ignore', 'pipe', 'pipe']` ([index.ts:455](file:///c:/Coding/Project/AI-Agent/apps/runtime-bridge/src/index.ts#L455)). Stdin ditutup (`'ignore'`).
- **Persistensi Sesi**: Sesi disimpan di direktori workspace proyek `<workspaceRoot>/<projectId>/<taskDir>/.omp-session`. Flag `--resume` telah aktif jika `resume: true` dan `sessionId` disertakan.
- **Streaming Event**: Stdout JSONL dipindai per-baris oleh `parseOmpLine()` ([index.ts:222-375](file:///c:/Coding/Project/AI-Agent/apps/runtime-bridge/src/index.ts#L222-L375)) dan dipancarkan sebagai SSE `runtime_event` (`text`, `tool_start`, `tool_end`, `file_edit`, `plan`, `subagent`, `error`).
- **Bukti Test**: [apps/runtime-bridge/test/index.test.ts:142-196, 284-314](file:///c:/Coding/Project/AI-Agent/apps/runtime-bridge/test/index.test.ts#L142-L196) (10 tes lulus 100%).

#### B. Gap yang Sebenarnya Harus Ditutup
- Stdin tertutup mencegah interupsi langsung mid-turn (*steering*) ke biner OMP yang sedang berjalan.
- OMP berjalan sebagai proses disposable per prompt, sehingga model memuat ulang konteks awal dari file sesi disk pada setiap pemanggilan.

#### C. File & Modul yang Mungkin Berubah
- `apps/runtime-bridge/src/index.ts`
- `packages/agent-core/src/runtimes/remote-adapter.ts`
- `apps/agent-worker/src/task-executor.ts`

#### D. Kontrak Data / API / Event
- **Tetap mempertahankan format event JSONL**:
  ```typescript
  export interface NormalizedRuntimeEvent {
    id: string;
    type: 'text' | 'tool_start' | 'tool_end' | 'file_edit' | 'plan' | 'subagent' | 'error' | 'completed';
    timestamp: string;
    data: {
      text?: string;
      toolName?: string;
      input?: unknown;
      output?: unknown;
      path?: string;
      diff?: string;
      error?: string;
      isSubagent?: boolean;
      subagentTask?: string;
      planItems?: string[];
    };
  }
  ```
- **Keputusan Arsitektur Sesuai ADR 0033**: OMP **tetap dipertahankan pada mode batch one-shot per-run** dengan persistensi sesi `--session <id>` dan `--resume`. Mode persistent daemon dua arah OMP ditolak demi menjaga batas memori 12 GB RAM VPS.

#### E. Security Model
- **Isolasi Lingkungan**: `cleanEnv()` menyaring `DATABASE_URL`, `NINEROUTER_API_KEY`, `JWT_SECRET`.
- **Workspace Boundary**: `prepareWorkspace()` memvalidasi `safePart`, `contained`, dan `realpath` (menolak traversal `..` dan symlink).
- **Process Group Killing**: `process.kill(-child.pid, 'SIGKILL')` pada Unix atau `taskkill /pid <pid> /T /F` pada Windows.

#### F. Error & Recovery
- **Timeout**: Enforced oleh timer `setTimeout` bridge (default 300s, max 900s).
- **Cancellation**: Endpoint `POST /v1/runs/:id/cancel` menghentikan subproses dan menandai status `cancelled`.
- **Buffer Bound**: Pemotongan deterministik pada batas 1 MB (`MAX_OUTPUT = 1_048_576`).

#### G. Acceptance Criteria
1. Task OMP dengan `sessionId` baru membuat direktori `.omp-session` yang valid di workspace.
2. Task lanjutan dengan `sessionId` yang sama dan `resume: true` memuat konteks sesi sebelumnya tanpa error.
3. Event `tool_start`, `file_edit`, dan `text` terkirim secara berurutan tanpa event teracak atau race condition.
4. Pembatalan task menghentikan proses subproses OMP dalam waktu $< 1$ detik tanpa meninggalkan proses yatim (*zombie process*).

#### H. Rencana Pengujian
- **Unit**: Uji parser JSONL `parseOmpLine()` untuk setiap jenis event OMP.
- **Integrasi**: Uji fake OMP CLI dengan flag `--session` dan `--resume` via SSE endpoint.
- **Regresi**: Uji isolasi environment rahasia (`DATABASE_URL` tidak bocor ke subproses).

#### I. Dependensi Baru: **Nihil** (0 package baru).
#### J. Estimasi Relatif: **S** (Small — mayoritas fondasi telah stabil di ADR 0013/0033).

---

### Kapabilitas 2: Host Tools dari Personal AI OS ke Runtime Eksternal

#### A. Current State Berbukti
- OMP dan Hermes saat ini **hanya menjalankan built-in tools internalnya sendiri**.
- [apps/runtime-bridge/src/index.ts:455](file:///c:/Coding/Project/AI-Agent/apps/runtime-bridge/src/index.ts#L455) menutup stdin (`stdio: ['ignore', 'pipe', 'pipe']`).
- Tindakan runtime dipindai pasca-eksekusi melalui `parseActions()` ([remote-adapter.ts:65-104](file:///c:/Coding/Project/AI-Agent/packages/agent-core/src/runtimes/remote-adapter.ts#L65-L104)) dan difilter via `filterUntrustedActions()`. Tindakan terlarang (`git push`, `git merge`, `deploy`) langsung digagalkan ([task-executor.ts:694-705](file:///c:/Coding/Project/AI-Agent/apps/agent-worker/src/task-executor.ts#L694-L705)).

#### B. Gap yang Sebenarnya Harus Ditutup
- Biner OMP/Hermes tidak dapat memanggil tool kustom Personal AI OS yang terdaftar di `ToolRegistry` (seperti `web_fetch`, `save_artifact`, atau tool MCP lokal).
- **Status Batasan**: Karena OMP berjalan dalam mode batch non-interaktif dengan stdin tertutup, penyuntikan callback tool secara sinkron di tengah giliran berpikir model **tidak dapat dilakukan tanpa mengubah mode biner OMP ke interaktif**.

#### C. File & Modul yang Mungkin Berubah
- `apps/runtime-bridge/src/index.ts`
- `packages/agent-core/src/runtimes/remote-adapter.ts`
- `packages/tools/src/registry/tool-registry.ts`

#### D. Kontrak Data / API / Event
- Jika diimplementasikan di masa depan melalui jembatan RPC/HTTP:
  ```json
  {"jsonrpc":"2.0","method":"host_tool_call","params":{"toolName":"web_fetch","input":{"url":"https://example.com"}},"id":"call-1"}
  ```

#### E. Security Model
- **Wajib Lewat PermissionEngine**: Setiap pemanggilan tool host dari runtime eksternal wajib dievaluasi oleh `SecuredCapabilityGuard`.
- **Tingkat Risiko HIGH/CRITICAL**: Wajib menangguhkan eksekusi dan memicu status `waiting_approval`.
- **Semua Input/Output Untrusted**: Parameter dari biner eksternal disanitasi dari path traversal dan format string injection.

#### F. Error & Recovery
- Timeout pemanggilan tool host individual (default 30s).
- Jika tool host gagal atau ditolak izinnya, error dikembalikan ke runtime eksternal dalam format pesan terstruktur tanpa crash pada bridge.

#### G. Acceptance Criteria
1. Tool host hanya dapat dipanggil jika terdaftar di allowlist runtime yang bersangkutan.
2. Aksi berkategori HIGH/CRITICAL memicu penangguhan task pada status `waiting_approval`.
3. Upaya pemanggilan tool di luar allowlist atau aksi terlarang (`git push`) ditolak secara *fail-closed*.

#### H. Rencana Pengujian
- **Unit**: Mock dispatcher tool host dengan filter izin.
- **Integrasi**: Uji pemanggilan tool dari subproses mock ke endpoint bridge.

#### I. Dependensi Baru: **Nihil**.
#### J. Estimasi Relatif: **L (Large) — BLOCKED untuk OMP batch saat ini; dialokasikan ke desain pi.dev**.

---

### Kapabilitas 3: Hashline Editing dan LSP Diagnostics

#### A. Current State Berbukti
- Pengeditan file koding saat ini mengandalkan `replace_file_content` dan `multi_replace_file_content` berbasis pencocokan substring unik ([packages/agent-core/src/coding/coding-agent.ts](file:///c:/Coding/Project/AI-Agent/packages/agent-core/src/coding/coding-agent.ts)).
- Hashline editing (`line#hash: target code`) hanya tercatat sebagai konsep pada [ADR 0020:66](file:///c:/Coding/Project/AI-Agent/docs/adr/0020-pemetaan-fitur-runtime.md#L66). Tidak ada implementasi di `packages/tools`.
- Diagnostik LSP: OMP di host VPS memiliki biner internal tool `lsp`, tetapi [ADR 0030:28-30](file:///c:/Coding/Project/AI-Agent/docs/adr/0030-usulan-runtime-pi-dev-dan-kapabilitas-omp-hermes.md#L28-L30) mencatat status: *"Integrasi diagnostik LSP dari container Docker worker ke workspace host membutuhkan language server terpasang per bahasa dan mount filesystem dua arah. Ini dicatat sebagai backlog teknis."*

#### B. Gap yang Sebenarnya Harus Ditutup
1. **Hashline Editing**: Mengadopsi tool edit berbasis nomor baris + hash pendek konten 3-4 karakter (`line#hash`) untuk memangkas konsumsi token hingga 60% dan mencegah salah timpa akibat drift baris file.
2. **LSP Diagnostics**: Menghubungkan language server (misal `typescript-language-server`) untuk membaca error tipe dan diagnostik sintaks sebelum build penuh dijalankan.

#### C. File & Modul yang Mungkin Berubah
- `packages/tools/src/builtin/hashline-edit.ts` (modul baru terisolasi)
- `packages/tools/src/builtin/index.ts`
- `packages/agent-core/src/coding/coding-agent.ts`
- LSP: `infrastructure/` (perlu language server binary di host/container) — **BLOCKED**.

#### D. Kontrak Data / API / Event
- **Hashline Tool Schema**:
  ```typescript
  export interface HashlineEditParams {
    filePath: string;
    edits: Array<{
      lineAnchor: string; // Contoh: "42#a1f"
      replacement: string;
    }>;
  }
  ```

#### E. Security Model
- Validasi ketat batas workspace: `filePath` wajib divalidasi via `safePart()` dan berada di dalam workspace task aktif.
- Dilarang menyentuh file di luar direktori repositori atau file konfigurasi rahasia (`.env`, `id_rsa`).

#### F. Error & Recovery
- **Hash Mismatch Detection**: Jika konten baris pada file telah berubah sehingga hash tidak cocok, tool melempar `HashlineCollisionError` dan membatalkan edit secara atomik (*optimistic concurrency rollback*).

#### G. Acceptance Criteria
1. Tool hashline editing mampu mengganti baris kode target secara tepat jika nomor baris dan hash konten cocok.
2. Jika file telah dimodifikasi secara eksternal (hash tidak cocok), edit ditolak 100% tanpa merusak file asli.
3. Pengurangan ukuran payload diff kode minimal 50% dibandingkan penggantian blok teks besar.

#### H. Rencana Pengujian
- **Unit**: Uji parser anchor `line#hash`, verifikasi SHA-256/FNV-1a 3-karakter, dan deteksi benturan hash (*collision test*).
- **Integrasi**: Uji CodingAgent yang menggunakan hashline tool dalam siklus perbaikan bug.

#### I. Dependensi Baru: **Nihil** (menggunakan crypto bawaan Node.js).
#### J. Estimasi Relatif: Hashline = **S (Small)**; LSP = **L (Large) — BLOCKED (Backlog teknis)**.

---

### Kapabilitas 4: Orkestrasi Subagent Durable

#### A. Current State Berbukti
- Antrean BullMQ `personal-ai-os-tasks` dan tabel `tasks` di [apps/api/src/db/schema.ts](file:///c:/Coding/Project/AI-Agent/apps/api/src/db/schema.ts) beroperasi secara flat tanpa kolom `parent_task_id`.
- Tampilan subagent saat ini murni merupakan normalisasi event visual dari tool bawaan OMP `task` yang dipetakan menjadi `RuntimeStepEvent` dengan `type: 'subagent'` ([packages/shared/src/tasks/runtime-step-event.ts:168](file:///c:/Coding/Project/AI-Agent/packages/shared/src/tasks/runtime-step-event.ts#L168)).

#### B. Gap yang Sebenarnya Harus Ditutup
- Backend belum mampu memecah satu task besar menjadi beberapa child-task durable yang dapat dijalankan secara paralel atau sekuensial oleh worker dengan konteks bersih dan pelacakan checkpoint mandiri.

#### C. File & Modul yang Mungkin Berubah
- `apps/api/src/db/schema.ts` (tabel `tasks`)
- `apps/api/src/db/migrations/` (migrasi SQL baru)
- `apps/agent-worker/src/task-executor.ts`
- `packages/agent-core/src/types.ts`

#### D. Kontrak Data / Perubahan Skema
- **Perubahan Skema `tasks`**:
  ```typescript
  // Tambahan kolom di schema.ts:
  parentTaskId: uuid('parent_task_id').references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
  spawnDepth: integer('spawn_depth').notNull().default(0),
  subagentRole: varchar('subagent_role', { length: 50 }),
  ```
- **Event Bus Contract**:
  - `task.child_spawned`: `{ parentTaskId, childTaskId, role, objective }`
  - `task.child_completed`: `{ parentTaskId, childTaskId, resultSummary }`

#### E. Security Model
- **Batas Kedalaman Keras (`max_spawn_depth = 1`)**: Child task dilarang melahirkan child task lain (mencegah rekursi eksponensial tanpa batas).
- **Konkurensi Maksimal Subagent**: Dibatasi maksimal 2 subagent aktif bersamaan per parent task pada hardware 2 OCPU VPS.
- **Konteks Bersih (Clean Context / No Memory Bleed)**: Subagent **tidak mewarisi** memori personal pengguna (`MEMORY.md` / proposal), hanya mewarisi instruksi tugas teknis spesifik.

#### F. Error & Recovery
- Jika child task gagal atau crash, parent task dapat memilih: mencoba ulang (*retry bounded* $\le 2$), mengabaikan kegagalan subagent non-kritis, atau menandai parent task sebagai gagal.
- Pemulihan checkpoint: Checkpoint parent mencatat status seluruh ID child task yang aktif.

#### G. Acceptance Criteria
1. Skema database memiliki kolom `parent_task_id` dan `spawn_depth` dengan indeks relasional yang valid.
2. Pemanggilan spawn child task melebihi kedalaman 1 ditolak secara otomatis.
3. Child task berjalan di proses worker independen dan memancarkan event progres yang terikat ke kartu aktivitas parent di antarmuka.

#### H. Rencana Pengujian
- **Unit**: Uji validasi kedalaman spawn dan isolasi konteks subagent.
- **Integrasi**: Uji eksekusi parent task yang menunggu penyelesaian 2 child task di BullMQ.

#### I. Dependensi Baru: **Nihil**.
#### J. Estimasi Relatif: **M (Medium)**.

---

### Kapabilitas 5: Siklus Skill Proposal, Evaluasi, Approval, dan Rollback

#### A. Current State Berbukti
- Tabel `skill_proposals` aktif di [apps/api/src/db/schema.ts:730](file:///c:/Coding/Project/AI-Agent/apps/api/src/db/schema.ts#L730).
- Repository [apps/api/src/db/skill-proposal-repository.ts](file:///c:/Coding/Project/AI-Agent/apps/api/src/db/skill-proposal-repository.ts) mengelola pembuatan proposal, persetujuan, dan penolakan.
- **Aturan Keamanan Terbukti**: Saat proposal disetujui pengguna, skill dimasukkan ke tabel `skills` dalam status **`isEnabled: false`** ([skill-proposal-repository.ts:167](file:///c:/Coding/Project/AI-Agent/apps/api/src/db/skill-proposal-repository.ts#L167)). Skill tidak pernah aktif otomatis.
- [SkillRegistry](file:///c:/Coding/Project/AI-Agent/packages/agent-core/src/skills/skill-registry.ts#L107-L148) mendukung `rollbackSkill()` menggunakan riwayat `skill_revisions`.

#### B. Gap yang Sebenarnya Harus Ditutup
- Belum ada pemicu otomatis (*automated trigger*) di `apps/agent-worker/src/task-executor.ts` yang menganalisis eksekusi task koding yang berhasil dan lolos evaluator untuk merangkum langkahnya menjadi draf proposal skill baru ke API `/v1/skill-proposals`.
- Belum ada tombol Rollback di UI pengaturan skill Android dan Windows.

#### C. File & Modul yang Mungkin Berubah
- `apps/agent-worker/src/task-executor.ts`
- `apps/api/src/routes/skill-proposals.ts`
- `apps/windows/src/ui/settings/SkillsSettings.tsx`
- `apps/android/src/screens/SettingsScreen.tsx`

#### D. Kontrak Data / API / Event
- **Payload Pembuatan Proposal Otomatis**:
  ```typescript
  export interface AutoProposeSkillPayload {
    taskId: string;
    skillName: string;
    title: string;
    description: string;
    manifest: SkillManifest;
    promptInstructions: string;
    extractedFromEvaluation: boolean;
  }
  ```

#### E. Security Model
- **Zero Silent Storage**: Agen dilarang menyimpan atau mengaktifkan skill secara diam-diam.
- **Penyensoran Rahasia (`sanitizeSensitiveText`)**: Seluruh token, path privat, dan kredensial disensor menjadi `[REDACTED]` sebelum disimpan di proposal.
- **Audit Logging Lengkap**: Setiap tahapan mencatat entri di `audit_logs` (`skill.proposed`, `skill_proposal.approved`, `skill_proposal.rejected`, `skill.rolled_back`).

#### F. Error & Recovery
- Jika ekstraksi proposal gagal atau mengandung format manifest yang tidak valid, proses task utama tetap selesai dengan sukses (ekstraksi proposal bersifat *non-blocking* / *best-effort*).

#### G. Acceptance Criteria
1. Task koding yang selesai dan dinyatakan lulus oleh evaluator secara otomatis memicu pembuatan proposal berstatus `pending`.
2. Proposal yang memuat token rahasia otomatis disensor atau ditolak.
3. Persetujuan proposal menghasilkan entri skill baru berstatus nonaktif (`isEnabled = false`).
4. Fitur rollback mampu mengembalikan versi manifest skill ke versi sebelumnya dan tercatat di audit log.

#### H. Rencana Pengujian
- **Unit**: Uji fungsi ekstraksi proposal dari ringkasan evaluasi dan pengujian sanitasi teks.
- **Integrasi**: Uji alur pembuatan proposal -> persetujuan pengguna -> aktivasi manual -> rollback revisi.

#### I. Dependensi Baru: **Nihil**.
#### J. Estimasi Relatif: **S (Small)**.

---

### Kapabilitas 6: Natural-Language Scheduling yang Memakai Scheduler Saat Ini

#### A. Current State Berbukti
- `apps/scheduler` berbasis BullMQ mendukung ekspresi cron 5-field (`*/15 * * * *`) dan jadwal one-off ([docs/adr/0029-tugas-terjadwal-dan-usulan-skill.md](file:///c:/Coding/Project/AI-Agent/docs/adr/0029-tugas-terjadwal-dan-usulan-skill.md)).
- Route API `apps/api/src/routes/schedules.ts` mengelola CRUD jadwal.
- Batasan keamanan VPS: Maksimal 10 jadwal aktif/user, interval minimum 15 menit.

#### B. Gap yang Sebenarnya Harus Ditutup
- Pengguna di obrolan chat belum bisa mengetik permintaan bahasa alami (misal: *"Ingatkan saya cek backup setiap jam 8 pagi WIB"*) yang otomatis dikonversi oleh agen menjadi jadwal resmi.

#### C. File & Modul yang Mungkin Berubah
- `packages/tools/src/builtin/schedule-task.ts` (tool baru)
- `packages/tools/src/builtin/index.ts`
- `packages/agent-core/src/router/intent-analyzer.ts`
- `apps/agent-worker/src/task-executor.ts`

#### D. Kontrak Data / Schema
- **Tool Definition**:
  ```typescript
  export const scheduleTaskToolSchema = {
    name: 'schedule_task',
    description: 'Menjadwalkan eksekusi tugas atau pengingat otomatis berkala menggunakan ekspresi cron.',
    parameters: {
      title: 'string',
      prompt: 'string',
      scheduleType: 'one_off | recurring',
      cronExpression: 'string (opsional jika recurring, minimal interval 15 menit)',
      runAt: 'string ISO date (opsional jika one_off)',
      timezone: 'string (default: Asia/Jakarta)',
    },
  };
  ```

#### E. Security Model
- **Validasi Interval Keras**: Ekspresi cron divalidasi dengan regex dan parser; cron dengan frekuensi $< 15$ menit (misal `* * * * *`) otomatis ditolak.
- **Batas Kuota Pengguna**: Menolak pembuatan jadwal jika pengguna telah memiliki 10 jadwal aktif.
- **Permission Guard pada Eksekusi**: Saat jadwal berjalan, jika aksi task memerlukan izin HIGH/CRITICAL, task ditahan pada `waiting_approval` dan mengirim notifikasi brief tanpa eksekusi liar.

#### F. Error & Recovery
- Penanganan missed-run (kebijakan `skip` atau `run_once` saat worker restart).
- Deduplikasi job ID di Redis untuk mencegah duplikasi eksekusi jadwal.

#### G. Acceptance Criteria
1. Prompt bahasa alami obrolan berhasil dikonversi oleh model menjadi parameter tool `schedule_task`.
2. Jadwal baru tersimpan di tabel `schedules` dengan status `active` dan timezone `Asia/Jakarta`.
3. Upaya menjadwalkan interval di bawah 15 menit ditolak dengan pesan validasi yang jelas.

#### H. Rencana Pengujian
- **Unit**: Uji parser cron interval validator dan batas 10 jadwal aktif.
- **Integrasi**: Uji penjadwalan via tool calling yang memicu pendaftaran BullMQ job di scheduler.

#### I. Dependensi Baru: **Nihil** (memakai `cron-parser` yang sudah ada di scheduler).
#### J. Estimasi Relatif: **S (Small)**.

---

### Kapabilitas 7: Integrasi Telegram / Hermes Tanpa Membuat Bot Kedua

#### A. Current State Berbukti
- Host VPS telah menjalankan Hermes yang terhubung ke Telegram pemilik.
- Repositori Personal AI OS menggunakan bot Telegram pemilik khusus untuk alerting operasional server ([apps/api/src/services/alert-checker.ts:22-60](file:///c:/Coding/Project/AI-Agent/apps/api/src/services/alert-checker.ts#L22-L60)).
- Sesuai kebijakan mutlak [ADR 0014:58](file:///c:/Coding/Project/AI-Agent/docs/adr/0014-integrasi-hermes-dan-runtime-picker.md#L58) dan [ADR 0018:54](file:///c:/Coding/Project/AI-Agent/docs/adr/0018-operasional-vps-backup-alerting-tracing.md#L54): **Dilarang membuat bot Telegram kedua**.

#### B. Gap yang Sebenarnya Harus Ditutup
- Penyaluran notifikasi persetujuan (*approval notifications*) dan ringkasan tugas terjadwal (*scheduled briefs*) ke Telegram pemilik yang menyertakan deep link terotentikasi ke aplikasi resmi tanpa membuka kanal persetujuan teks bebas yang rawan pembajakan.

#### C. File & Modul yang Mungkin Berubah
- `apps/api/src/services/alert-checker.ts`
- `apps/scheduler/src/index.ts`
- `apps/api/src/routes/approvals.ts`

#### D. Kontrak Data & Format Pesan
- **Format Pesan Notifikasi Telegram Ber-Deep Link**:
  ```markdown
  ⚠️ *[Personal AI OS — Tindakan Memerlukan Persetujuan]*
  
  *Tugas:* Refactoring skema database
  *Tindakan:* Modifikasi berkas di luar repositori (HIGH)
  *Waktu:* 19 Okt 2026, 14:00 WIB
  
  👉 [Buka Aplikasi untuk Meninjau](personal-ai://approvals/{approvalId})
  
  _Pemberitahuan: Persetujuan tidak dapat dilakukan melalui balasan teks demi keamanan data._
  ```

#### E. Security Model
- **Single Telegram Instance**: Mempertahankan satu jalur bot alerting yang ada.
- **Larangan Persetujuan Berbasis Teks Bebas**: Tindakan berisiko HIGH/CRITICAL **dilarang keras** disetujui via teks chat Telegram. Pengguna wajib membuka tautan deep link ke aplikasi (Windows/Android), melakukan autentikasi dengan JWT Bearer token yang valid, dan menyetujui melalui dialog modal sekunder.
- **Penyensoran Kredensial**: Parameter sensitif di pesan disensor otomatis sebelum dikirim ke API Telegram.

#### F. Error & Recovery
- Mekanisme cooldown anti-spam (default 300.000 ms) agar insiden berulang tidak membanjiri chat Telegram pengguna.
- Penanganan graceful fallback jika endpoint Telegram API mengalami kegagalan jaringan (tidak memblokir penyelesaian task di worker).

#### G. Acceptance Criteria
1. Notifikasi persetujuan dan ringkasan jadwal berhasil terkirim ke Telegram pemilik dengan format Markdown yang rapi.
2. Setiap pesan menyertakan deep link resmi ke aplikasi (`personal-ai://`).
3. Tidak ada webhook chat interaktif kedua yang didaftarkan ke server Telegram.

#### H. Rencana Pengujian
- **Unit**: Uji format template pesan Markdown dan penyensoran token.
- **Integrasi**: Mock HTTP call ke `api.telegram.org` saat event `task.waiting_approval` terpicu.

#### I. Dependensi Baru: **Nihil**.
#### J. Estimasi Relatif: **S (Small)**.

---

### Kapabilitas 8: Runtime Adapter Pi Sebagai Opsional dan Gated

#### A. Current State Berbukti
- Paket Pi (`pi` / `@earendil-works/pi-coding-agent`) **TIDAK TERPASANG** di repositori monorepo dan **TIDAK ADA** di VPS Oracle Cloud (`which pi` kosong, [ADR 0030:53](file:///c:/Coding/Project/AI-Agent/docs/adr/0030-usulan-runtime-pi-dev-dan-kapabilitas-omp-hermes.md#L53)).
- Repositori beroperasi dengan 3 runtime: `omp`, `hermes`, dan `native`.

#### B. Gap yang Sebenarnya Harus Ditutup
- Perancangan arsitektur adapter runtime ketiga (`PiRuntimeAdapter`) yang terisolasi di balik feature flag konfigurasi (`ENABLE_PI_RUNTIME=false`) sehingga siap dihubungkan segera setelah pemilik menyetujui instalasi biner host di kemudian hari.

#### C. File & Modul yang Mungkin Berubah
- `packages/agent-core/src/runtimes/pi-adapter.ts` (modul baru terisolasi saat diimplementasikan)
- `packages/agent-core/src/runtimes/runtime-manager.ts`
- `apps/runtime-bridge/src/index.ts`

#### D. Kontrak Data / Feature Gate
- **Konfigurasi Environment**:
  ```bash
  ENABLE_PI_RUNTIME=false
  PI_BINARY_PATH=/home/ubuntu/.local/bin/pi
  ```
- **Kontrak Adapter**:
  - Jika `ENABLE_PI_RUNTIME !== 'true'` atau biner `pi` tidak ditemukan di filesystem, `RuntimeManager` tidak mendaftarkan runtime `pi`.
  - Upaya pemilihan runtime `pi` saat dinonaktifkan secara otomatis dan anggun dialihkan (*graceful fallback*) ke runtime `omp` atau `native` dengan label transparan.

#### E. Security Model
- **Fail-Closed Gate**: Panggilan ke runtime `pi` ditolak jika gate tertutup.
- **Isolasi Lingkungan Penuh**: Mewarisi standar keamanan `cleanEnv()` dan isolasi direktori workspace git `prepareWorkspace()`.
- **Output Untrusted**: Seluruh output JSONL dari pi diperlakukan sebagai konten tidak tepercaya dan difilter melalui `PermissionEngine`.

#### F. Error & Recovery
- Penanganan deteksi biner hilang (`ENOENT`): Menandai status kesehatan `RuntimeHealth: { healthy: false, error: 'pi binary not installed' }` tanpa memicu crash pada worker.

#### G. Acceptance Criteria
1. Default konfigurasi menjaga `ENABLE_PI_RUNTIME=false` (tidak aktif).
2. Pemilihan runtime `pi` saat gate nonaktif memicu fallback transparan ke runtime sehat berikutnya.
3. Repositori monorepo tetap bebas dari dependensi paket yang belum disetujui.

#### H. Rencana Pengujian
- **Unit**: Mock adapter `PiRuntimeAdapter` dengan pengujian toggle feature flag dan status kesehatan fail-closed.
- **Integrasi**: Uji alur fallback runtime router saat `pi` berstatus offline.

#### I. Dependensi Baru: **Nihil** (desain antarmuka TypeScript mandiri).
#### J. Estimasi Relatif: **M (Medium) — GATED / MENUNGGU PERSETUJUAN PEMILIK**.

---

### Kapabilitas 9: Inspirasi UI / Workspace Odysseus yang Independen dari Source Code Odysseus

#### A. Current State Berbukti
- **Kepatuhan Lisensi Mutlak**: 0 baris kode disalin atau diadaptasi dari Odysseus (lisensi AGPL-3.0-or-later).
- Fitur independen yang sudah selesai: Deep Research Engine multi-langkah dan Blind Model Comparison A/B ([CHANGELOG.md:19](file:///c:/Coding/Project/AI-Agent/CHANGELOG.md#L19)).
- **Fitur Terbukti Out-of-Scope ([ADR 0029:44-54](file:///c:/Coding/Project/AI-Agent/docs/adr/0029-tugas-terjadwal-dan-usulan-skill.md#L44-L54))**:
  1. *Email Assistant & Calendar/CalDAV*: Ditolak (scope OAuth sensitif belum diaudit).
  2. *Image Gallery & Inpaint*: Ditolak (beban disk/GPU tinggi).
  3. *Local LLM Serving (270+ models)*: **DITOLAK SECARA MUTLAK** (aturan keras AGENTS.md: dilarang ada inferensi LLM lokal di VPS 12 GB RAM).
  4. *Editor Documents*: Ditolak (di luar prioritas asisten agen durable).

#### B. Gap yang Sebenarnya Harus Ditutup
- Inspirasi visual yang aman diadopsi: Penataan tata letak panel penjelajah repositori (*Workspace File Tree Viewer*) yang bersih dan penampil timeline checkpoint tugas yang intuitif pada aplikasi desktop Windows dan Android.

#### C. File & Modul yang Mungkin Berubah
- `apps/windows/src/ui/chat/ToolStepCard.tsx`
- `apps/windows/src/ui/layout/Sidebar.tsx`
- `apps/android/src/screens/TaskDetailScreen.tsx`

#### D. Kontrak Desain
- Mengikuti bahasa desain resmi [DESIGN.md](file:///c:/Coding/Project/AI-Agent/DESIGN.md):
  - Dark theme utama: kanvas `#0F1115`, permukaan `#171A21`, aksen teal `#2DD4BF`.
  - Tipografi Inter lokal tanpa CDN eksternal.
  - Mematuhi linter token desain (`pnpm check:tokens`).

#### E. Security Model
- **Sanitasi File Tree**: Tampilan penjelajah file hanya menampilkan file yang berada di dalam workspace proyek aktif; direktori sistem dan berkas `.git` tersembunyi dilindungi dari akses sembarangan.
- Tidak ada evaluasi script HTML/JS arbitrer di webview (`dangerouslySetInnerHTML` dilarang).

#### F. Error & Recovery
- Penanganan graceful saat file workspace berukuran besar (menampilkan peringatan file terlalu besar daripada memuat ke memori).

#### G. Acceptance Criteria
1. Tampilan file tree workspace dan timeline checkpoint tugas terbukti dibangun murni menggunakan komponen React/CSS monorepo tanpa dependensi AGPL.
2. Seluruh warna mematuhi token desain tanpa hardcoded hex di luar sistem (`pnpm check:tokens` lulus).
3. Aksesibilitas WCAG AA/AAA dan navigasi keyboard tetap terpenuhi.

#### H. Rencana Pengujian
- **Unit**: Linter token desain `check-design-tokens.ts`.
- **Visual**: Audit kontras warna dan rendering layout responsif.

#### I. Dependensi Baru: **Nihil**.
#### J. Estimasi Relatif: **S (Small)**.

---

## 3. Matriks Ringkasan & Urutan Prioritas Implementasi

Berdasarkan analisis nilai fungsional, keterikatan dependensi, dan tingkat risiko:

| No | Kapabilitas | Status Rekomendasi | Urutan Prioritas | Estimasi | Status Blocker / Syarat |
| :---: | :--- | :---: | :---: | :---: | :--- |
| **1** | **Hashline File Editing** | Siap Implementasi | **Prioritas 1 (P1)** | **S** | Tanpa blocker; native di `packages/tools` |
| **2** | **Natural-Language Scheduling** | Siap Implementasi | **Prioritas 2 (P2)** | **S** | Tanpa blocker; native tool calling API |
| **3** | **Siklus Skill Proposal Otomatis** | Siap Implementasi | **Prioritas 3 (P3)** | **S** | Tanpa blocker; API & skema sudah siap |
| **4** | **Notifikasi Approval Telegram Ber-Deep Link** | Siap Implementasi | **Prioritas 4 (P4)** | **S** | Tanpa blocker; bot alerting sudah ada |
| **5** | **Inspirasi UI File Tree Workspace** | Siap Implementasi | **Prioritas 5 (P5)** | **S** | Tanpa blocker; murni CSS/React tokens |
| **6** | **Orkestrasi Subagent Durable** | Perlu Desain Detail | **Prioritas 6 (P6)** | **M** | Memerlukan migrasi skema tabel `tasks` |
| **7** | **OMP Batch Mode Maintenance** | Terimplementasi (Selesai) | **Selesai (ADR 0033)** | **S** | Selesai di Sesi 1 & 2 (flag resume & spawn fix) |
| **8** | **Pi Runtime Adapter Gated** | Gated Feature Flag | **Backlog Terjadwal** | **M** | Menunggu izin instalasi host VPS |
| **9** | **Host-Tool Injection & LSP Diagnostics** | Ditangguhkan | **Backlog Teknis** | **L** | **BLOCKED** pada mode one-shot OMP; dialokasikan ke pi.dev |

---

## 4. Konsekuensi Dokumen

- Spesifikasi ini menjadi acuan tunggal (*single source of truth*) yang mencegah implementasi spekulatif atau pelanggaran lisensi.
- Setiap implementasi pada sesi-sesi mendatang wajib mengambil **satu sub-fitur kecil terisolasi** sesuai urutan prioritas di atas dengan bukti pengujian nyata sebelum beralih ke fitur berikutnya.
