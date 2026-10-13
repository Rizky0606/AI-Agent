# Laporan Audit Akhir — Personal AI OS

**Tanggal Audit**: 2026-10-11, diperbarui 2026-10-13  
**Auditor**: Principal Software Architect & Security Engineer  
**Status Keseluruhan**: **CANDIDATE PRE-RELEASE (STAGING VERIFIED — MENUNGGU VERIFIKASI LANGSUNG DI VPS)**  
**Catatan Status**: Dokumen ini **direvisi 2026-10-13** setelah audit ulang terhadap database produksi dan container produksi yang berjalan. Revisi pertama menurunkan butir yang klaimnya tidak didukung bukti: 3 (recovery), 5 (memory), 7 (coding/research), 10 (notifikasi), 11 (Windows dispatch), 12 (observability). Butir 3 (recovery), persistensi memori pada butir 5, dan eksekusi coding berbasis workspace nyata pada butir 7 **sudah diperbaiki dan diverifikasi live** pada tanggal yang sama. Butir 5 dan 7 tetap **SEBAGIAN**, bukan LULUS: pencarian semantik belum punya provider embedding, retensi belum ditegakkan, dan research masih tanpa jalur pencarian. Detail bukti ada di [assessment-2026-10-13.md](assessment-2026-10-13.md). Sistem tetap **TIDAK** dilabeli "PRODUCTION READY": cacat fungsional yang masih terbuka adalah research tanpa jalur pencarian (butir 7) dan tidak adanya jalur dispatch perintah ke Windows Agent (butir 11).

---

## 1. Ringkasan Eksekutif & Ringkasan Quality Gates Monorepo

Audit akhir ini mengevaluasi arsitektur, kepatuhan keamanan, daya tahan tugas (_durable tasks & recovery_), isolasi data per-user, dan keandalan sistem **Personal AI OS** sebelum deployment ke server target.

Quality gates dijalankan pada checkout `release/installers` (Linux aarch64), bukan pada host Windows seperti pada revisi sebelumnya:

- **Linter (`pnpm lint`)**: 14/14 paket **LULUS** (0 error, 0 warning).
- **Production Build (`pnpm build`)**: 14/14 paket **LULUS**.
- **Verifikasi referensi path (`pnpm verify:audit`)**: 88 path unik valid (145 referensi diperiksa).
- **Test per-paket yang dijalankan ulang dan diverifikasi**: `@personal-ai-os/tools` 30/30, `@personal-ai-os/mcp` 17/17, `@personal-ai-os/agent-worker` 33/33, `@personal-ai-os/memory` 7/7, `@personal-ai-os/permissions` 5/5, `@personal-ai-os/agent-core` 34/34, `@personal-ai-os/evaluator` 9/9, API in-container 51/51 (0 skipped).
- **Catatan penting tentang Skenario 4**: test `apps/api/test/e2e-scenarios.test.ts:868-914` yang diklaim membuktikan pemulihan task **tidak memanggil `recoverInterruptedTasks` sama sekali**. Ia memanggil `executor.execute()` secara langsung dan menaikkan counter yang di-hardcode di dalam test. Test tersebut tidak dapat gagal karena perilaku sistem apa pun, sehingga lulusnya test itu tidak membuktikan apa pun tentang recovery. Lihat Butir 3.
- **Catatan tentang `pnpm test` di root**: perintah itu tidak dapat dipakai; task `scheduler:test` menggantung pada `ECONNREFUSED 127.0.0.1:6379`. Suite harus dijalankan per paket.

---

## 2. Audit Kriteria Sukses (12 Butir)

Setiap butir dievaluasi dengan status **LULUS**, **SEBAGIAN**, atau **GAGAL** beserta bukti file relatif yang dapat diverifikasi:

### Butir 1: Android Chat Streaming lewat Backend dan 9Router tanpa Secret di Client

- **Status**: **LULUS**
- **Persyaratan**: Client Android melakukan streaming chat melalui backend API yang meneruskan ke 9Router. Tidak ada API key model gateway di client.
- **Bukti File Relatif**:
  - `apps/android/src/services/chat-websocket.ts`: Mengalirkan chunk chat via WebSocket ke endpoint backend `/v1/chat/ws` menggunakan JWT access token, tanpa API key model gateway.
  - `apps/android/src/api/client.ts`: Header permintaan hanya memuat `Authorization: Bearer <accessToken>`.
  - `apps/android/src/api/config.ts`: Konfigurasi base URL diambil dari environment runtime `EXPO_PUBLIC_API_URL` dan `EXPO_PUBLIC_WS_URL`.
  - `apps/api/src/routes/chat.ts`: Backend memverifikasi JWT via `AuthService` dan memanggil `ModelRouter` yang meneruskan panggilan ke `NineRouterGateway`.
  - `packages/model-gateway/src/nine-router.ts`: Gateway tunggal backend ke endpoint model gateway `https://9router.ojixx.my.id/v1`.
- **Bukti Test & Output**:
  - Test: `apps/api/test/e2e-scenarios.test.ts` — `Skenario 1: Register/login, chat streaming via WebSocket (real Fastify & fake 9Router)`
  - Output Aktual: `✔ Skenario 1: Register/login, chat streaming via WebSocket (real Fastify & fake 9Router) (760.8611ms)`
  - Secret Scanning: 0 model gateway API key ditemukan pada bundle `apps/android`.

---

### Butir 2: Project, Conversation, Task Punya State dan Realtime Progress

- **Status**: **LULUS**
- **Persyaratan**: Entitas project, conversation, dan task memiliki model status formal, idempotency key, dan progress dapat dipantau realtime melalui WebSocket.
- **Bukti File Relatif**:
  - `packages/shared/src/tasks/state-machine.ts`: Definisi state formal task (`queued`, `planning`, `running`, `waiting_approval`, `completed`, `failed`, `cancelled`, `paused`).
  - `apps/api/src/routes/tasks.ts`: Endpoint CRUD task, filter `projectId` dan `status`, serta mutasi state berbasis idempotency.
  - `apps/api/src/routes/events-ws.ts`: Endpoint `/v1/events/ws` untuk streaming realtime event envelope dan replay riwayat via `last_event_id`.
  - `apps/android/src/screens/TaskListScreen.tsx`: Tampilan daftar tugas dengan status badge dan indikator progress.
  - `apps/android/src/screens/TaskDetailScreen.tsx`: Tampilan detail task dengan timeline event realtime.
- **Bukti Test & Output**:
  - Test: `apps/api/test/tasks.test.ts` — `Task lifecycle: pause, resume, cancel, and approval transitions`
  - Test: `apps/api/test/e2e-scenarios.test.ts` — `Skenario 2: Buat task → worker mengeksekusi → event realtime diterima klien → Evaluator menandai completed`
  - Output Aktual: `✔ Skenario 2: Buat task → worker mengeksekusi → event realtime diterima klien → Evaluator menandai completed (309.6985ms)`

---

### Butir 3: Background Task Pulih setelah Worker Restart

- **Status**: **LULUS** — sebelumnya **GAGAL**, diperbaiki 2026-10-13.
- **Persyaratan**: Ketika worker mati di tengah eksekusi, task dapat dipulihkan dari checkpoint terakhir tanpa menduplikasi side-effect yang telah selesai.
- **Bukti File Relatif**:
  - `packages/shared/src/tasks/checkpoint-verifier.ts`: Verifikasi integritas hash checkpoint dan tracking `stepIndex`.
  - `apps/agent-worker/src/task-executor.ts`: Memeriksa checkpoint terakhir pada awal eksekusi langkah; langkah dengan `stepIndex <= lastCheckpoint.stepIndex` dilewati dengan aman.
  - `apps/api/src/services/task-queue.ts`: Pembersihan job lama sebelum enqueue memastikan task yang dipulihkan dapat di-antrikan kembali tanpa konflik ID BullMQ.
- **Bukti Test & Output**:
  - Test: `apps/api/test/e2e-scenarios.test.ts` — `Skenario 4` — **test ini tidak valid** dan tidak boleh dipakai sebagai bukti (lihat di bawah).
  - Test: `apps/api/test/recovery-drill.test.ts` — menguji `TaskExecutor.execute` langsung, bukan jalur pemulihan produksi.
- **Cacat yang ditemukan (2026-10-13, sudah diperbaiki)**:
  - Task `774b9bbc-1fa3-459c-aa1e-19dc590cd367` dipaksa ke `status='running'`, `progress=40`, lalu worker di-restart.
  - Log worker: `{"service":"agent-worker","action":"recovery","recoveredCount":1}` — task memang terdeteksi, dan event `task.resumed` tertulis di `task_events`.
  - 40 detik setelah restart, task **masih** `running` dengan `progress=40`. Tidak ada job di queue, tidak ada eksekusi lanjutan, tidak ada timeout, tidak ada eskalasi.
  - **Akar masalah**: `apps/agent-worker/src/index.ts` memanggil `workerHandle.executor.recoverInterruptedTasks()` **tanpa argumen `queue`**, dan `TaskExecutor.recoverInterruptedTasks(queue?: TaskQueueEnqueuer)` hanya meng-enqueue `if (queue)`. Task dipulihkan secara kosmetik: status diperiksa dan event ditulis, tetapi tidak pernah dijadwalkan ulang.
- **Perbaikan**:
  - `createAgentWorker` sekarang membuat `BullMqTaskQueue` dari koneksi Redis yang sama dan mengembalikannya sebagai `queue`, sehingga worker dan API memakai satu definisi queue (`apps/agent-worker/src/index.ts`).
  - `startWorkerProcess` melewatkan queue itu ke `recoverInterruptedTasks`, dan melempar error bila queue tidak tersedia — jalur pemulihan tidak dapat lagi berjalan tanpa enqueue.
  - Parameter `queue` pada `recoverInterruptedTasks` diubah dari opsional menjadi **wajib** (`apps/agent-worker/src/task-executor.ts`), sehingga panggilan tanpa queue tidak lagi dapat dikompilasi. Inilah yang mencegah kekambuhan kelas bug ini.
- **Bukti live setelah perbaikan (2026-10-13)**:
  - Worker dihentikan. Task `85cf3ce1-7599-4b8b-9d51-067283af5f11` dibuat, job BullMQ-nya dihapus dari Redis (`DEL bull:personal-ai-os-tasks:<id>` → `exists` = 0), lalu task dipaksa `status='running'`, `progress=40`. Jadi satu-satunya cara task itu dapat berjalan kembali adalah lewat jalur pemulihan.
  - Worker dijalankan kembali → log `{"action":"recovery","recoveredCount":1}`.
  - Hasil akhir: `status=completed`, `progress=100`. Event berurutan: `task.created`, `task.resumed`, `task.tool_call`, `task.completed`.
- **Bukti test regresi**: `apps/agent-worker/test/live-worker-execution.test.ts` — `Startup recovery re-enqueues a dangling task through the worker queue and completes it`. Test ini memakai `createAgentWorker` dengan Redis nyata, memaksa task `running`, memanggil pemulihan, lalu menunggu event `task.completed`. Test **gagal (menggantung) bila `queue` tidak diteruskan** — sudah diverifikasi dengan sengaja mengembalikan `createAgentWorker` ke bentuk lama.
- **Catatan**: `apps/api/test/e2e-scenarios.test.ts` `Skenario 4` tetap **tidak valid** sebagai bukti dan tidak boleh dipakai: ia tidak pernah memanggil `recoverInterruptedTasks`, membuat checkpoint manual, memanggil `executor.execute(...)` langsung, lalu menaikkan counter di luar alur eksekusi.

---

### Butir 4: Routing Model/Runtime/Tool Mengikuti Capability dan Policy

- **Status**: **LULUS**
- **Persyaratan**: Pemilihan model, runtime adapter, dan tool dipandu oleh analisis niat, matriks kapabilitas, dan health check runtime dengan graceful fallback.
- **Bukti File Relatif**:
  - `packages/agent-core/src/router/agent-router.ts`: Menganalisis niat task (coding/research/general) dan memilih model/runtime yang sehat.
  - `packages/agent-core/src/runtimes/runtime-manager.ts`: Memonitor runtime adapter terpasang (OMP dan Pi) serta status kesehatannya.
  - `packages/agent-core/src/runtimes/unverified-adapter.ts`: Isolasi runtime yang belum terverifikasi agar tidak dieksekusi di luar policy.
- **Bukti Test & Output**:
  - Test: `packages/agent-core/test/agent-router.test.ts`: Routing berbasis niat dan kapabilitas.
  - Test: `packages/agent-core/test/runtimes.test.ts`: Runtime health check dan fallback saat runtime primer gagal.
  - Output Aktual: Seluruh subtest `packages/agent-core` lulus 100%.

---

### Butir 5: Memory/Context Relevan dan Punya Scope/Retensi

- **Status**: **SEBAGIAN** — sebelumnya **GAGAL**, diperbaiki sebagian 2026-10-13. Persistensi dan scope kini **LULUS**; pencarian semantik dan penegakan retensi belum.
- **Persyaratan**: Memori memiliki tipe terstruktur (session, long-term, project, preference, decision) dengan write policy selektif, filter data sensitif, dan token budget context.
- **Bukti File Relatif**:
  - `packages/memory/src/types.ts`: Definisi 7 scope memori dan retensi TTL.
  - `packages/memory/src/policy/memory-write-policy.ts`: Penilaian kandidat memori berdasarkan relevance, novelty, dan utility score.
  - `packages/memory/src/policy/sensitive-data-filter.ts`: Redaksi otomatis API key, JWT, dan credential sebelum disimpan.
  - `packages/memory/src/context/context-manager.ts`: Dynamic token budgeting, deduplikasi, dan pemotongan deterministik.
- **Bukti live 2026-10-13 (menunjukkan cacat)**:
  - `POST /v1/memories` → `201`, lalu `GET /v1/memories` → `count=1`.
  - `docker compose restart api`, lalu `GET /v1/memories` → **`count=0`**. Memori hilang tanpa error, tanpa peringatan, tanpa log.
  - `docker exec personal-ai-os-postgres-1 psql ... -c "SELECT to_regclass('public.memories')"` → **null**. Tabel `memories` tidak ada. Produksi memiliki 18 tabel, dan `memories` bukan salah satunya.
  - `SELECT count(*) FROM memories` → `ERROR: relation "memories" does not exist`.
  - `GET /v1/memories/search?q=...` → `404 Memory not found`, karena route `/v1/memories/:id` menangkapnya. Kontrak pencarian sebenarnya adalah `POST /v1/memories/search` (lihat di bawah). Setelah fallback senyap dihapus, request yang sama menjadi `500 22P02` — bukti bahwa fallback itu memang menutupi error database, bukan menanganinya.
- **Akar masalah**:
  - Tabel `memories` dideklarasikan di Drizzle (`apps/api/src/db/schema.ts:265`) termasuk `vector('embedding', {dimensions:1536})` (`:279`), tetapi **tidak ada `CREATE TABLE memories`** di seluruh migrasi `apps/api/src/db/migrations/` (berkas `0000`–`0006`). Schema dan migrasi menyimpang.
  - `DrizzleMemoryRepository` membungkus setiap operasi DB dengan `if (!this.db)` dan `try/catch`, sehingga kegagalan itu selalu jatuh diam-diam ke `InMemoryMemoryStore`. (Referensi baris dihapus karena kode itu sendiri sudah dihapus pada perbaikan di bawah.)
  - `InactiveEmbeddingProvider.embed()` **throw** (`packages/memory/src/store/inactive-embedding-provider.ts:16-18`) dan `isAvailable = false`, sehingga `isSemanticSearchActive()` selalu `false` dan `searchSemantic` tidak pernah menyentuh database. Tidak ada index ivfflat/hnsw.
  - Tidak ada sweeper TTL/retention; `retention` hanya field tersimpan.
  - Tidak ada ekstraksi memori otomatis: `apps/agent-worker` tidak mengimpor `@personal-ai-os/memory`. Satu-satunya jalur tulis adalah `POST /v1/memories` dari klien.
- **Yang benar-benar bekerja**: tipe/scope/retensi terdeklarasi (`packages/memory/src/types.ts`), write policy selektif (`policy/memory-write-policy.ts`), filter data sensitif (`policy/sensitive-data-filter.ts`), dan `ContextManager` token budgeting (`context/context-manager.ts`). Unit test `packages/memory/test/memory.test.ts` lulus. Yang gagal adalah **persistensi dan retrieval produksi**, bukan logikanya.
- **Perbaikan (2026-10-13)**:
  - Migrasi baru `apps/api/src/db/migrations/0007_memories.sql` membuat tabel `memories` lengkap dengan `vector(1536)`, lima index btree, dua check constraint (`type`, `retention`), dan foreign key ke `users`/`projects`. Sudah diterapkan ke produksi (`schema_migrations` memuat `0007_memories.sql`).
  - `DrizzleMemoryRepository` **tidak lagi menelan kegagalan database**: seluruh `try/catch` yang jatuh ke `InMemoryMemoryStore` dihapus, sehingga `relation "memories" does not exist` sekarang menjadi error yang terlihat, bukan `201` palsu. Fallback in-memory hanya tersisa untuk `db === null`, yaitu seam unit test route.
  - Tabel `artifacts` dihapus dari `schema.ts` (dan `ArtifactRow` dihapus). Tabel itu tidak punya migrasi, tidak punya repository, dan tidak ada satu pun referensi di `apps/` maupun `packages/`; artefak nyata disimpan lewat `DiskArtifactStorage` + sidecar metadata.
- **Bukti live setelah perbaikan (2026-10-13)**:
  - `POST /v1/memories` → `201` dengan `retention: 'permanent'`, `embedding: null`.
  - `GET /v1/memories` → `count=1`.
  - `docker compose restart api` → `GET /v1/memories` → **`count=1`**. Persistensi lintas restart terbukti.
  - `SELECT count(*) FROM memories` di PostgreSQL → `1`, dan `\d memories` menunjukkan `vector(1536)` serta seluruh index dan constraint.
  - `POST /v1/memories/search` → `200` `{"data":[],"semanticSearchActive":false,"status":"inactive"}`.
  - `GET`/`DELETE` `/v1/memories/search` (bukan uuid) → `400 VALIDATION_ERROR` `params/id must match format "uuid"`. Sebelum perbaikan keduanya `500` dengan `22P02` dari Postgres: `:id` tidak divalidasi, sehingga segmen path apa pun dikirim sebagai literal uuid ke driver.
- **Yang masih terbuka di butir ini**:
  - **Pencarian semantik tetap tidak aktif, dan itu jujur.** `POST https://9router.ojixx.my.id/v1/embeddings` mengembalikan `{"error":{"message":"No credentials for provider: openai"}}`, jadi tidak ada provider embedding yang dapat menghasilkan vektor. `InactiveEmbeddingProvider` dipertahankan, `isSemanticSearchActive()` mengembalikan `false`, dan API menyatakan statusnya secara eksplisit. Kolom `vector(1536)` sudah siap, tetapi index ANN belum dibuat karena belum ada pencarian yang memakainya.
  - `GET /v1/memories/search` → `400`, bukan `404`. Method pencarian yang benar tetap `POST`; path itu memang cocok dengan `/:id`, dan sekarang ditolak di lapisan validasi alih-alih gagal di database.
  - **Retensi belum ditegakkan.** `retention` tersimpan dan divalidasi oleh check constraint, tetapi tidak ada sweeper yang menghapus data kedaluwarsa. Karena `permanent` adalah default dan satu-satunya nilai yang dipakai produksi saat ini, dampaknya nihil sampai ada pemanggil yang memakai nilai lain.
  - Tidak ada ekstraksi memori otomatis: `apps/agent-worker` tidak mengimpor `@personal-ai-os/memory`. Satu-satunya jalur tulis adalah `POST /v1/memories` dari klien.
- **Bukti test regresi**: `apps/api/test/memory.test.ts` — `Memory API: database failures are not silently swallowed by an in-memory fallback`. Test ini memakai database palsu yang melempar `relation "memories" does not exist` dan menuntut error itu naik ke pemanggil. Sudah diverifikasi **gagal** bila `catch` fallback dikembalikan. Test yang sama juga menuntut `GET`/`DELETE /v1/memories/search` → `400`; sudah diverifikasi **gagal** bila `schema` pada route `/:id` dihapus.

---

### Butir 6: MCP, Browser, Files Mengikuti Permission dan Audit

- **Status**: **LULUS**
- **Persyaratan**: Pemanggilan MCP, browser automation, dan akses file lokal divalidasi permission engine, dilindungi dari SSRF/path traversal, dan dicatat dalam audit log.
- **Bukti File Relatif**:
  - `packages/mcp/src/security/untrusted-sanitizer.ts`: Sanitasi output MCP eksternal untuk mencegah prompt injection.
  - `packages/tools/src/ssrf/ssrf-guard.ts`: Blokade akses loopback (127.0.0.1), private network (10.0.0.0/8, 192.168.0.0/16), dan cloud metadata (169.254.169.254).
  - `apps/windows/src/security/path-validator.ts`: Kanonikalisasi path dan penolakan path traversal `..` di luar direktori allowlist.
- **Bukti Test & Output**:
  - Test: `packages/mcp/test/mcp.test.ts`: Sanitasi MCP dan audit schema.
  - Test: `apps/windows/test/path-validator.test.ts`: Blokade traversal Windows System32.
  - Test: `apps/api/test/e2e-platform.test.ts`: SSRF guard memblokir IP metadata cloud.
  - Output Aktual: Seluruh unit test security lulus 100%.

---

### Butir 7: Coding dan Research Menghasilkan Bukti, Laporan, Artefak

- **Status**: **SEBAGIAN** (sebelumnya GAGAL; jalur coding kini berjalan nyata, jalur research masih tanpa pencarian)
- **Persyaratan**: Coding Agent dan Research Agent mengikuti workflow terstruktur dan menghasilkan bukti terverifikasi (diff, test output, sitasi, report artifact).
- **Bukti File Relatif**:
  - `packages/agent-core/src/coding/coding-agent.ts`: Workflow tahap: understand → inspect → plan → implement → test → debug → review_diff → document → report.
  - `packages/agent-core/src/research/research-agent.ts`: Workflow: decompose → search → browse → extract → cross-check → score → synthesize → cite → report.
  - `packages/tools/src/artifacts/`: Penyimpanan artefak hasil eksekusi task.
- **Bukti bahwa coding kini menghasilkan bukti nyata (2026-10-13)**:
  - `packages/agent-core/src/coding/local-environment.ts` (baru): `LocalCodingEnvironment` menjalankan `git status`/`branch`, menulis file, dan menjalankan `node --run lint|typecheck|test|build` di direktori workspace nyata; setiap perintah punya timeout dan output terpotong sebelum disimpan.
  - `CodingAgent.execute` memakai `input.mockEnvironment ?? new LocalCodingEnvironment({ workspaceDir: input.workspaceDir ?? this.config.workspaceRoot })` (`packages/agent-core/src/coding/coding-agent.ts:92-97`). `createDefaultEnvironment()` yang mengembalikan `{passed:true}` hardcoded **dihapus**.
  - `prepareCodingWorkspace(root, taskId)` membuat direktori per task di dalam root terkunci (`mkdir` 0o700, `realpath`, cek containment, `git init`), dan `git` dijalankan dengan `safe.directory` yang di-scope ke direktori itu saja — bukan `*`.
  - Worker memberi setiap task coding workspace sendiri: `CODING_WORKSPACE_ROOT=/app/data/workspaces` (named volume `coding-workspaces`, dibuat di image dengan owner `node`), dipakai via `prepareCodingWorkspace(this.codingWorkspaceRoot, task.id)` (`apps/agent-worker/src/task-executor.ts:409-415`).
  - Bukti live 2026-10-13 (task `a5776358-f9d2-40f3-be71-13e6ba4f5276`, workspace dengan script lulus): `completed`, progress 100, `artifact-diff-…` memuat diff git nyata `+export const helper = (n) => n + 1;`.
  - Bukti live (task `3f5aeee2-225c-4b4c-ba87-8d31aa5b8c92`, workspace dengan `lint` `exit 1`): `failed`, `evaluationResult.score=0.71`, isu `Lint issue: Command failed: node --run lint`.
- **Bukti bahwa research tidak punya jalur pencarian**:
  - `web_search` default menembak `https://example.com/search?q=…` (`packages/tools/src/builtin/web-search.ts:64`) dan **tidak terdaftar di registry mana pun** (`packages/tools/src/registry/create-default-tool-registry.ts:20` hanya mendaftarkan `web_fetch`).
  - `ResearchAgent` tanpa env memakai sumber hardcoded MDN/nodejs.org (`packages/agent-core/src/research/research-agent.ts:99-115`) dan claim hardcoded (`:135-158`) yang lolos evaluator.
  - Tahap `browse` dideklarasikan (`packages/agent-core/src/types.ts:172-180`) tetapi tidak pernah diset; `fetchContent` tidak pernah dipanggil.
  - `ResearchEvaluator` hanya menghitung field (`packages/evaluator/src/research-evaluator.ts`); ia tidak pernah mem-fetch URL untuk memverifikasi sumber.
- **Yang benar-benar bekerja**: jalur coding kini mengeksekusi perintah nyata di workspace nyata dan menyerahkan hasilnya ke `CodingEvaluator`; `web_fetch` nyata (SSRF guard + HTTP fetch asli); `ArtifactManager` menyimpan hasil dengan checksum sha256. Yang belum ada: jalur pencarian research dan verifikasi URL oleh `ResearchEvaluator`.

---

### Butir 8: Evaluator Menentukan Completion

- **Status**: **SEBAGIAN** (sebelumnya dinyatakan LULUS; jalur tool kini digerbangi, acceptance criteria belum dipersist)
- **Persyaratan**: Agen dilarang menyatakan tugas selesai berdasarkan klaim verbal mandiri; penyelesaian ditentukan secara independen oleh Evaluator engine berbasis bukti eksekusi tooling.
- **Bukti File Relatif**:
  - `packages/evaluator/src/coding-evaluator.ts`: Evaluasi objektif berbasis 7 kriteria nyata (lint, typecheck, tests, build, security, requirement coverage, diff).
  - `packages/evaluator/src/research-evaluator.ts`: Evaluasi kelengkapan sitasi, kredibilitas sumber, dan konsistensi klaim.
  - `packages/agent-core/src/coding/coding-agent.ts`: Task hanya berstatus 'completed' jika evaluasi memenuhi skor 100%.
- **Bukti live 2026-10-13**:
  - `executeRegisteredTool` kini menjalankan `GenericEvaluator` atas hasil tool sebelum menulis `completed` (`apps/agent-worker/src/task-executor.ts:637-674`). Bukti hanya dilampirkan bila tool benar-benar mengembalikan data; tool yang mengembalikan `undefined`/`null` tidak boleh `completed` (test "Registered tool that returns no output cannot complete the task").
  - Bukti coding nyata: task `a5776358-…` → `completed`, `evaluationResult.passed=true`, `score=1`; task `3f5aeee2-…` → `failed`, `score=0.71`, kriteria lint gagal karena `node --run lint` keluar 1.
  - `apps/api/test/e2e-scenarios.test.ts` Skenario 2 kini menjalankan evaluator atas workspace nyata (fixture dengan script yang benar-benar lulus) dan tidak lagi meneruskan opsi `codingEvaluator` yang diabaikan.
- **Yang benar-benar bekerja**: evaluator dipanggil pada keempat jalur (coding, research, standard, tool) dan menolak klaim mandiri tanpa artefak/output. `packages/agent-core/test/evaluator-gating.test.ts` membuktikan penolakan itu.
- **Keterbatasan yang membuat status tetap SEBAGIAN**: acceptance criteria belum pernah dipersist sebelum eksekusi — `TaskCheckpoint` tidak punya field kriteria (`packages/shared/src/tasks/types.ts:13-24`), sedangkan `acceptanceCriteria` di `packages/agent-core/src/router/planner.ts:31-116,150-216` hanya string plan yang tidak dikonsumsi evaluator. Pada jalur tool, `GenericEvaluator` memakai kriteria default `task_output` dan menerima artifact apa pun sebagai bukti; ia belum memeriksa apakah output tool memenuhi permintaan pengguna.

---

### Butir 9: Approval Menghentikan Aksi Berisiko

- **Status**: **LULUS**
- **Persyaratan**: Aksi berisiko tinggi (HIGH/CRITICAL) wajib berhenti di status `waiting_approval`, dilanjutkan saat di-approve, dan dihentikan saat di-deny.
- **Bukti File Relatif**:
  - `packages/permissions/src/engine.ts`: Klasifikasi aksi dan penentuan tingkat risiko (LOW, MEDIUM, HIGH, CRITICAL).
  - `packages/permissions/src/guard.ts`: Melempar `ApprovalRequiredError` jika aksi berisiko belum disetujui.
  - `apps/api/src/routes/approvals.ts`: Endpoint `/v1/approvals/:id/approve` dan `/v1/approvals/:id/deny` dengan audit logging.
  - `apps/agent-worker/src/task-executor.ts`: Menghentikan eksekusi pada status `waiting_approval` dan melanjutkan hanya setelah approval tervalidasi.
- **Bukti Test & Output**:
  - Test: `apps/api/test/e2e-scenarios.test.ts` — `Skenario 3: Aksi HIGH memicu waiting_approval, approve, task dilanjutkan; deny menghentikan task`
  - Output Aktual: `✔ Skenario 3: Aksi HIGH memicu waiting_approval, approve, task dilanjutkan; deny menghentikan task (325.5554ms)`

---

### Butir 10: Scheduler, Events, Notifications Tidak Melewati Policy

- **Status**: **SEBAGIAN**
- **Persyaratan**: Eksekusi otomatis dari jadwal dan event wajib melalui Permission Engine, memiliki deduplikasi, dan notifikasi ber-retry terbatas. Pengiriman FCM nyata hanya aktif jika kredensial tersedia.
- **Bukti File Relatif**:
  - `apps/scheduler/src/scheduler-engine.ts`: Tracking idempotency key per slot eksekusi dan penanganan missed-run policy (`skip`, `run_once`, `catch_up`).
  - `apps/scheduler/src/event-engine.ts`: Event-triggered task divalidasi lewat `PermissionEngine`; aksi berisiko masuk `waiting_approval`.
  - `apps/scheduler/src/notification-engine.ts`: Jendela deduplikasi (60 detik) mencegah spam notifikasi.
  - `apps/scheduler/src/fcm-provider.ts`: Membaca path file `FCM_SERVICE_ACCOUNT_JSON`. Jika variabel tidak disetel, pengiriman FCM dinonaktifkan secara eksplisit dengan pesan log transparan (tanpa mock diam-diam).
- **Bukti Test & Output**:
  - Test: `apps/scheduler/test/scheduler.test.ts` & `apps/scheduler/test/event-engine.test.ts` (Lulus).
  - Test: `apps/api/test/e2e-scenarios.test.ts` — `Skenario 6: Jadwal berulang berjalan tepat sekali`
  - Output Aktual: `✔ Skenario 6: Jadwal berulang berjalan tepat sekali (957.1265ms)`
- **Keterbatasan / Mengapa SEBAGIAN**:
  - **Notifikasi belum pernah terkirim sekali pun.** `SELECT count(*) FROM notifications` di produksi → `0`. `NotificationEngine` di API dibuat **tanpa storage**: `new NotificationEngine()` (`apps/api/src/index.ts:211`), sehingga state pengiriman hanya ada di memori proses. `SqlNotificationRepository` ada tetapi tidak pernah diinstansiasi.
  - Tidak ada jembatan dari event task ke notifikasi di kode produksi: task selesai atau gagal tidak menghasilkan notifikasi apa pun.
  - **Token FCM hardcoded.** `apps/scheduler/src/fcm-provider.ts:185` menyuntikkan `accessToken: 'dummy-env-token'` ketika service account tersedia. Begitu kredensial nyata disuntikkan, provider akan mengirim dengan token literal itu dan selalu gagal `401`. Kegagalan itu akan tampak seperti masalah kredensial Google, padahal bug kode.
  - Retry notifikasi 3× bersifat sinkron; setelah habis, state menjadi `failed` tanpa dead-letter.
  - `SchedulerEngine` di API dibuat dengan `SqlScheduleRepository` (`apps/api/src/index.ts:183-185`) tetapi `tick()` tidak pernah dipanggil di API; dispatcher-nya hanya `taskQueue.enqueue` tanpa `INSERT` ke tabel `tasks` (`:192-193`).
- **Yang benar-benar bekerja**: ketiga missed-run policy (`skip`, `run_once`, `catch_up`) ada; timezone disimpan dan dihitung; idempotency slot `sched:<jobId>:<ISO>` ada di Set in-memory plus unique index DB pada jalur proses scheduler; `EventEngine` **tidak dapat** dispatch tanpa `PermissionEngine` (gate di `apps/scheduler/src/event-engine.ts:137`); tanpa kredensial, FCM memakai `DisabledFcmProvider` dengan pesan log yang jujur.
- **Keterbatasan tambahan**: tidak ada verifikasi signature pada event masuk, dan `registerRule` tidak pernah dipanggil di produksi.

---

### Butir 11: Windows Agent Terautentikasi dan Capability-Limited

- **Status**: **SEBAGIAN** (sebelumnya dinyatakan LULUS)
- **Persyaratan**: Windows Agent beroperasi sebagai remote worker dengan identitas perangkat kriptografis, koneksi outbound WSS terautentikasi, allowlist command, dan penanganan status offline.
- **Bukti File Relatif**:
  - `apps/windows/src/connection/device-identity.ts`: Pembuatan identitas perangkat dan integrasi invoke command Tauri.
  - `apps/windows/src/connection/agent-connection.ts`: Koneksi WSS outbound ke `/v1/agent/ws` dengan handshake dan reconnect otomatis.
  - `apps/windows/src/security/capability-registry.ts`: Pendaftaran kapabilitas yang diizinkan (default powershell non-aktif kecuali diaktifkan eksplisit).
  - `apps/windows/src/security/command-executor.ts`: Eksekusi command dalam batas direktori kerja yang divalidasi.
  - `apps/windows/src-tauri/src/main.rs`: Backend Tauri Rust yang membatasi akses native OS.
- **Yang benar-benar bekerja**:
  - Koneksi WSS outbound ke `/v1/agent/ws` dengan handshake, ping, dan reconnect otomatis.
  - Capability registry dengan 7 kapabilitas, seluruhnya `default enabled: false`, allowlist ditegakkan lewat `assertCapabilityAllowed` (`apps/windows/src/security/capability-registry.ts:116`) ditambah validasi capability + action + `cwd`.
  - `PathValidator` menolak device namespace, alternate data stream, null byte, dan traversal (`apps/windows/src/security/path-validator.ts:78-118`).
  - Test `apps/windows/test/command-executor.test.ts` dan `connection-and-offline.test.ts` lulus.
- **Bukti live 2026-10-13 (menunjukkan cacat)**:
  - `dispatchCommand` (`apps/api/src/services/device-connection-manager.ts:154`) memiliki **nol pemanggil di `apps/`**. Tidak ada kode produksi yang mengirim perintah ke perangkat.
  - Worker hanya memeriksa `hasOnlineDeviceForUser('windows')` (`apps/agent-worker/src/task-executor.ts:169`); ia tidak pernah mendispatch perintah.
  - Akibatnya Skenario 5 membuktikan handshake dan penolakan traversal di dalam test, tetapi **tidak** membuktikan alur produksi task → perangkat → hasil. Test itu memanggil klien Windows dan server di dalam satu proses.
- **Cacat identitas perangkat**:
  - Klaim "identitas perangkat kriptografis" tidak benar. `devices.public_key` ada di schema (`apps/api/src/db/schema.ts:30`) tetapi tidak pernah diisi atau diverifikasi; `DeviceRepository.create` hanya menulis `name` + `platform`.
  - `fetchDeviceIdentity` fallback ke id literal `'win-dev-local'` (`apps/windows/src/connection/device-identity.ts:26`), dan `deviceId` diambil dari query string `/v1/agent/ws` (`apps/api/src/routes/agent-ws.ts:44`).
  - Sesi koneksi perangkat disimpan in-memory (`device-connection-manager.ts`), sehingga hilang saat API restart.
- **Cacat allowlist**: tidak ada allowlist teks-perintah atau allowlist biner. Penegakan hanya pada capability, action, dan `cwd`, sehingga perintah PowerShell apa pun dapat dijalankan di dalam direktori kerja yang diizinkan begitu satu kapabilitas diaktifkan.
- **Tidak ada pemetaan** capability Windows ke capability Personal AI OS. Direktori `runtimes/{pi,omp,hermes,openhands}-adapter` juga tidak ada di repository; Hermes dan OpenHands hanya `UnverifiedRuntimeAdapter` yang menolak eksekusi (`packages/agent-core/src/runtimes/unverified-adapter.ts`).

---

### Butir 12: Logging, Health Check, Backup, Resource Limit, Security Test, dan Deployment Docs Tersedia

- **Status**: **SEBAGIAN**
- **Persyaratan**: Tersedia observability (`/health`, `/metrics`, redaksi log), resource limit VPS ARM64 (12 GB RAM), script backup/restore teruji, runbook insiden, dan dokumen deployment.
- **Bukti File Relatif**:
  - `apps/api/src/app.ts`: Endpoint `/health` dan `/metrics` (Prometheus) serta filter redaksi token pada logger.
  - `docker-compose.yml`: Batas memori dan CPU eksplisit per container (total ~5.6 GB RAM) dan jaringan terisolasi `internal: true`.
  - `scripts/backup-postgres.sh`: Skrip dump database PostgreSQL terisolasi.
  - `scripts/restore-postgres.sh`: Skrip pemulihan database dari berkas dump.
  - `scripts/backup-cron-wrapper.sh`: Wrapper cron otomatis untuk backup harian.
  - `docs/runbooks/incident-response.md`: Runbook penanganan insiden outage, OOM, dan worker disconnect.
  - `docs/runbooks/deployment.md`: Langkah deployment zero-downtime dan rollback.
  - `docs/runbooks/resource-profiling-and-capacity.md`: Profil kapasitas memori dan alokasi resource VPS ARM64.
- **Bukti live 2026-10-13**:
  - `/health` → `200` melalui `https://ai.ojixx.my.id`.
  - `ss -tulpn`: PostgreSQL `127.0.0.1:5432` saja; Redis dan Postgres container tanpa port mapping publik; Caddy hanya `127.0.0.1:8080` plus 80/443 publik.
  - `/etc/docker/daemon.json` memiliki rotasi log `max-size 10m, max-file 3`.
  - Backup harian berjalan di container `backup` (5 dump tersimpan, `BACKUP_INTERVAL_SECONDS=86400`), retensi `RETENTION_DAYS` default 14 (`scripts/backup-postgres.sh:15`).
  - Restore drill lulus terhadap arsip produksi nyata (lihat tabel checklist).
- **Keterbatasan / Mengapa SEBAGIAN**:
  - **`audit_logs` hanya berisi keputusan approval.** Produksi: 10 baris, seluruhnya `approval:approved` (5) dan `approval:denied` (5). Tidak ada satu pun baris untuk tool call, MCP call, browser action, atau artifact write. `SqlAuditRepository.log` hanya dipanggil dari `apps/api/src/routes/approvals.ts:113,219`.
  - Audit MCP hanya ditulis ke `console.log` (`apps/agent-worker/src/index.ts`), sehingga hilang saat container di-recreate.
  - Healthcheck worker hanya menyentuh file `/tmp/healthy` pada timer, bukan memprobe database atau Redis (`apps/agent-worker/src/index.ts:307-320`).
  - Tidak ada alerting maupun tracing terdistribusi; hanya endpoint `/metrics` Prometheus yang harus di-scrape secara eksternal.
  - Restore drill belum pernah dijalankan sebagai prosedur berkala terjadwal.


### Runtime bridge update

- **Status**: **SEBAGIAN — source/test verified; production service not installed**.
- Live probe evidence: `docs/verification/runtimes-live.md`; OMP 18.6.1 JSONL via 9Router, Hermes 0.20.5 plain-text CLI.
- Bridge source: `apps/runtime-bridge/`; token auth, workspace realpath/symlink controls, process-group timeout/cancel, queue/rate/output bounds, SSE, audit JSONL.
- Worker wiring: `RUNTIME_BRIDGE_URL`, `RUNTIME_BRIDGE_TOKEN`, `RUNTIME_PREFERRED`; health checks and routing fallback event fields added.
- Docker egress gateway verified: `172.20.0.1`, subnet `172.20.0.0/16`.
- **Not claimed**: systemd/firewall installation, production token, API → queue → worker → bridge → runtime → evaluator VPS proof. Requires owner approval for unit and firewall.

### VPS activation proof

- **Status**: **SEBAGIAN — bridge live; full worker/API/evaluator flow pending**.
- Unit enabled/active on host; bind `172.20.0.1:9120`; UFW allows TCP 9120 only from `172.20.0.0/16`.
- Authenticated health returned HTTP 200; invalid token returned HTTP 401.
- Hermes 0.20.5 live bridge run completed with `OK`; OMP 18.6.1 live bridge run completed with assistant `OK`.
- Runtime state paths explicitly writable under systemd hardening.
- No claim of API → queue → worker → bridge → runtime → evaluator completion.

### Worker runtime execution

- Explicit `payload.useRuntime=true` now routes through selected `RuntimeManager` adapter.
- Worker emits runtime tool output, evaluates the resulting artifact, and persists completed/failed state.
- Isolated authenticated API→in-memory queue→TaskExecutor→RemoteRuntimeAdapter→temporary bridge/fake OMP test completes and persists output artifact (`apps/api/test/runtime-task-e2e.test.ts`). This proves orchestration contract without production credentials or real Redis.
- Production smoke initially failed because the worker lacked `RUNTIME_BRIDGE_URL`/`RUNTIME_BRIDGE_TOKEN`, then because `host.docker.internal` resolved to `172.17.0.1` while the bridge listened on `172.20.0.1`. Worker configuration was corrected to load `.env` and use `http://172.20.0.1:9120`.
- Final production smoke task `972edc30-5393-444e-80e7-006bb2bb0ee2` completed at progress 100 with `runtime_output` artifact. Events: `task.created`, `task.started`, `task.tool_call`, `task.completed`.

### Android runtime task entry

- Mobile task screen now submits opted-in OMP/Hermes runtime tasks via authenticated API client; requires selected project.
- Task detail displays persisted runtime output as untrusted text, with a 20,000-character preview bound; full artifact remains server-persisted.
- Android lint/typecheck/build pass; tests 19/19. Runtime preview selector tests cover malformed records and truncation.
- Device login→task→worker→bridge→evaluator flow remains unverified on a physical device; no authorized test account was available for authenticated task smoke.

---

## 3. Checklist Kesiapan Platform

| Butir Checklist                                  | Status       | Bukti Nyata & Path File Relatif                                                                                                                                                                |
| :----------------------------------------------- | :----------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Android klien penuh**                          | **LULUS**    | 9 screen lengkap di `apps/android/src/screens/` (`ChatScreen.tsx`, `TaskListScreen.tsx`, `TaskDetailScreen.tsx`, `ApprovalInboxScreen.tsx`, `ProjectsScreen.tsx`, `SettingsScreen.tsx`, dll.). |
| **Chat streaming via backend + 9Router**         | **LULUS**    | Route `/v1/chat/*` di `apps/api/src/routes/chat.ts` memanggil `NineRouterGateway` tanpa secret di client.                                                                                      |
| **Project / Task / Timeline / Artifact**         | **LULUS**    | Terintegrasi penuh dengan event timeline streaming dan artifact storage di `packages/tools/src/artifacts/`.                                                                                    |
| **Routing berbasis capability**                  | **LULUS**    | `AgentRouter` di `packages/agent-core/src/router/agent-router.ts` memetakan intent ke `RuntimeManager` (OMP, Pi) dan `NineRouterGateway`.                                                      |
| **Memory & context ber-budget**                  | **SEBAGIAN** | **Persistensi diperbaiki 2026-10-13**: migrasi `0007_memories.sql` membuat tabel `memories` + `vector(1536)`, dan fallback senyap ke `InMemoryMemoryStore` dihapus. Bukti live: create → `count=1` → restart API → `count=1`. Sisa: pencarian semantik tidak aktif karena 9Router tidak menyediakan provider embedding (`No credentials for provider: openai`), dan belum ada sweeper retensi. Lihat Butir 5. |
| **Queue / cancel / checkpoint / recovery**       | **LULUS**    | Queue, cancel, dan checkpoint bekerja. **Recovery diperbaiki 2026-10-13**: `createAgentWorker` kini membuat `BullMqTaskQueue` dan mengembalikannya sebagai `queue`, `startWorkerProcess` melewatkannya ke `recoverInterruptedTasks`, dan parameter itu menjadi wajib sehingga panggilan tanpa queue tidak lagi dikompilasi. Bukti live: task `running`/40 tanpa job di Redis → restart worker → `recoveredCount: 1` → `completed`/100. Lihat Butir 3. |
| **Windows device identity + allowlist**          | **SEBAGIAN** | Path allowlist dan capability registry nyata dan ditegakkan. Identitas perangkat **bukan** kriptografis (`devices.public_key` tidak pernah diisi; `deviceId` dari query string), tidak ada allowlist teks-perintah/biner, dan `dispatchCommand` nol pemanggil sehingga tidak ada jalur produksi task → perangkat. Lihat Butir 11. |
| **MCP / tools / browser ber-permission & audit** | **SEBAGIAN** | Permission **lulus**: semua eksekusi melewati `SecuredCapabilityGuard` (`packages/permissions/src/guard.ts`), dan MCP live terbukti `waiting_approval` → approve → `completed`. **Audit tidak lulus**: `audit_logs` produksi hanya 10 baris keputusan approval; tool call, MCP call, browser action, dan artifact write tidak tercatat. MCP audit hanya `console.log`. Lihat Butir 12. |
| **Evaluator menentukan completion**              | **SEBAGIAN** | Evaluator dipanggil pada keempat jalur (coding, research, standard, tool). **Jalur tool diperbaiki 2026-10-13**: `executeRegisteredTool` menjalankan `GenericEvaluator` atas hasil tool sebelum menulis `completed`, dan tidak melampirkan bukti palsu bila tool mengembalikan `null`/`undefined` (`apps/agent-worker/src/task-executor.ts:637-674`). **Bukti coding kini nyata**: `LocalCodingEnvironment` menjalankan `node --run lint/typecheck/test/build` di workspace per task; bukti live task `3f5aeee2-…` → `failed` (`score 0.71`, lint keluar 1), task `a5776358-…` → `completed` (`score 1`). Sisa: acceptance criteria belum dipersist sebelum eksekusi. Lihat Butir 7 dan 8. |
| **Approval terikat aksi spesifik**               | **LULUS**    | Model approval mencakup `action`, `resource`, `riskLevel`, `consequence` di `apps/api/src/routes/approvals.ts`.                                                                                |
| **Scheduler & Event Deduplication**              | **SEBAGIAN** | Idempotency key dan dedupe window ada, `EventEngine` tidak dapat dispatch tanpa `PermissionEngine`. Namun `NotificationEngine` di API dibuat **tanpa storage** (`apps/api/src/index.ts:211`), `SqlNotificationRepository` tidak pernah diinstansiasi, dan `notifications` produksi berisi **0 baris**. Lihat Butir 10. |
| **FCM Push Notification Live Kredensial**        | **GAGAL**    | Bukan sekadar menunggu kredensial. `apps/scheduler/src/fcm-provider.ts:185` menyuntikkan `accessToken: 'dummy-env-token'` hardcoded ketika service account tersedia, sehingga pengiriman akan selalu gagal `401` bahkan setelah kredensial nyata disuntikkan. Tidak ada alur OAuth token dari service account. |
| **Tidak ada secret di client / log / repo**      | **LULUS**    | Bebas credential hardcoded, Fastify logger di `apps/api/src/app.ts` meredaksi header authorization dan token.                                                                                  |
| **PostgreSQL & Redis terisolasi internal**       | **LULUS**    | `docker-compose.yml` melampirkan DB dan Redis ke `internal: true` network tanpa port mapping publik.                                                                                           |
| **Backup / Restore / Observability**             | **LULUS**    | Script backup di `scripts/backup-postgres.sh`, restore di `scripts/restore-postgres.sh`, dan metrik Prometheus di `apps/api/src/app.ts`. Restore drill dijalankan terhadap arsip nyata `personal_ai_os-20261013T092512Z.dump`: exit 0, ekstensi `pgcrypto`+`vector` ada, 11 tabel inti ada, `users` 40 baris sama dengan produksi. Drill menemukan bug `pg_restore` tanpa `-d` yang membuat restore selalu gagal; sudah diperbaiki. |
| **Live VPS Physical Verification (ARM64)**       | **SEBAGIAN** | Konfigurasi Docker compose dan profiling siap; menunggu eksekusi live via SSH di Oracle Cloud VPS target.                                                                                      |

---

## 4. Hasil Test End-to-End 7 Skenario (`apps/api/test/e2e-scenarios.test.ts`)

Suite ini dijalankan dengan komponen nyata (Fastify nyata, Redis BullMQ nyata, WebSocket nyata, gateway 9Router tiruan berlabel jelas) dan seluruh 7 test lulus. **Namun lulusnya suite ini tidak berarti ketujuh skenario itu benar-benar terbukti**, karena dua test menguji jalur yang berbeda dari yang diklaim namanya:

| No  | Skenario                                                                               | Status test | Apakah membuktikan klaimnya? | Catatan bukti                                                                                                                                                                                   |
| :-- | :------------------------------------------------------------------------------------- | :---------- | :--------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Register/login, chat streaming via WebSocket                                           | LULUS       | **Ya**                       | WebSocket `/v1/chat/ws` menerima token delta streaming dari `LocalFake9RouterServer`.                                                                                   |
| 2   | Buat task → worker eksekusi → event realtime → Evaluator completed                      | LULUS       | **Ya**                       | Task coding lewat Redis BullMQ, `task.completed` diterima, dan evaluator kini menilai bukti dari workspace nyata: Skenario 2 membuat fixture git dengan script `lint/typecheck/test/build` yang benar-benar lulus (`apps/api/test/e2e-scenarios.test.ts:620-632`) dan menyerahkan `workspaceDir` ke payload, sehingga `node --run <script>` dieksekusi sungguhan. Opsi `codingEvaluator` yang diabaikan sudah dihapus. |
| 3   | Aksi HIGH memicu waiting_approval, approve dilanjutkan, deny dihentikan                | LULUS       | **Ya**                       | Aksi berisiko memicu `waiting_approval`; `/v1/approvals/:id/approve` melanjutkan hingga selesai, `/v1/approvals/:id/deny` menghentikan task. Alur ini juga diverifikasi live di produksi. |
| 4   | Matikan worker di tengah task, hidupkan lagi, pulih dari checkpoint tanpa duplikasi    | LULUS       | **Tidak** (test) / **Ya** (live) | Test ini **tidak memanggil `recoverInterruptedTasks` sama sekali** (`apps/api/test/e2e-scenarios.test.ts:868-914`), jadi lulusnya tidak membuktikan apa pun. Bukti live sebelum perbaikan: task tetap `running/40` permanen. Setelah perbaikan 2026-10-13, bukti live memenuhi klaim: task `running`/40 tanpa job Redis → restart worker → `recoveredCount: 1` → `completed`/100. Test regresi baru ada di `apps/agent-worker/test/live-worker-execution.test.ts`. |
| 5   | Windows Agent terhubung, allowlist berjalan, luar allowlist ditolak, offline ditangani | LULUS       | **Sebagian**                 | Handshake `/v1/agent/ws`, eksekusi perintah allowlist, penolakan traversal `C:\Windows\System32`, dan transisi offline memang diuji — tetapi semuanya di dalam satu proses test. Tidak ada jalur produksi yang mendispatch perintah ke perangkat (`dispatchCommand` nol pemanggil). |
| 6   | Jadwal berulang berjalan tepat sekali                                                  | LULUS       | **Ya**                       | `SchedulerEngine` mengeksekusi slot waktu tepat sekali; pemanggilan berulang pada timestamp yang sama diabaikan oleh deduplikasi idempotency key.                                             |
| 7   | Isolasi: user A tidak bisa membaca project/task/memori user B                          | LULUS       | **Ya**                       | User B mendapat `HTTP 404` dan list kosong. Isolasi memori kini juga terverifikasi live di produksi (2026-10-13) setelah tabel `memories` ada: user B `GET /v1/memories/<id-milik-A>` → `404 Memory not found`, `GET /v1/memories` → `count=0`, sementara user A `GET` id yang sama → `200`. |

---

## 5. Daftar Gap yang Tersisa

Dibagi dua: cacat fungsional yang dapat diperbaiki sekarang, dan gap operasional yang menunggu lingkungan atau kredensial eksternal.

### 5.1 Cacat fungsional (tidak memerlukan kredensial eksternal)

1. **Memory tidak persisten — SELESAI (2026-10-13)**. Migrasi `0007_memories.sql` membuat tabel `memories` + `vector(1536)` + 5 index + check constraint; `DrizzleMemoryRepository` tidak lagi menelan error DB; `artifacts` yang tak terpakai dihapus dari schema. Bukti live: create → restart API → data tetap ada. Sisa: provider embedding (eksternal) dan sweeper retensi.
2. **Recovery task menggantung — SELESAI (2026-10-13)**. `recoverInterruptedTasks` sekarang menerima `queue` wajib, `createAgentWorker` menyediakan queue, dan test regresi baru gagal bila queue tidak diteruskan. Diverifikasi live: task `running` tanpa job → restart → `completed`.
3. **Evaluator tidak memverifikasi apa pun pada jalur coding — SELESAI (2026-10-13)**. `createDefaultEnvironment()` yang mengembalikan `{passed:true}` dihapus dan diganti `LocalCodingEnvironment` yang menjalankan `node --run lint/typecheck/test/build` di workspace per task (`packages/agent-core/src/coding/local-environment.ts`); `executeRegisteredTool` kini menjalankan `GenericEvaluator` sebelum `completed` (`apps/agent-worker/src/task-executor.ts:637-674`). Bukti live: workspace dengan `lint` gagal → `failed` (`score 0.71`); workspace dengan script lulus → `completed` (`score 1`).
4. **Research tanpa jalur pencarian** — `web_search` menembak `example.com` dan tidak terdaftar di registry mana pun; `ResearchAgent` memakai sumber hardcoded.
5. **Tidak ada jalur dispatch perintah ke Windows Agent** — `dispatchCommand` nol pemanggil produksi.
6. **Notifikasi belum pernah terkirim** — `notifications` 0 baris; `NotificationEngine` di API tanpa storage.
7. **Token FCM hardcoded `dummy-env-token`** — akan gagal 401 bahkan setelah kredensial nyata disuntikkan.
8. **Audit tidak menyeluruh** — hanya keputusan approval yang masuk `audit_logs`.
9. **Identitas perangkat tidak kriptografis** — `devices.public_key` tidak pernah diisi; `deviceId` dari query string.
10. **Skema menyimpang dari migrasi — sebagian selesai (2026-10-13)**. `memories` kini punya migrasi; tabel `artifacts` yang tidak terpakai dihapus dari `schema.ts`. Belum ada pemeriksaan paritas otomatis antara `schema.ts` dan `apps/api/src/db/migrations/`, sehingga kelas bug ini masih bisa terulang.
11. **Dead code produksi** — `AiCouncil` (`packages/agent-core/src/council/`) dan `SelfHealingEngine` (`packages/agent-core/src/healing/`) tidak dipanggil dari `apps/`.

### 5.2 Gap operasional (menunggu lingkungan atau kredensial)

1. **Gap 1: Provisioning & Akses SSH Mesin Fisik Oracle Cloud VPS (ARM64)** — sebagian besar sudah terlampaui karena container produksi sudah berjalan di VPS tersebut dan bukti live dikumpulkan dari sana; yang tersisa adalah dokumentasi prosedur akses.
2. **Gap 2: Kredensial Produksi Google FCM (Service Account JSON)** — di luar cacat kode nomor 7 di atas, kredensial itu sendiri tetap diperlukan.
3. **Gap 3: Live Build Image Playwright Chromium pada Arsitektur Linux ARM64** — **SELESAI**. Chromium linux-arm64 terpasang di image worker melalui `pnpm exec playwright install --with-deps chromium`, `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`. Tool `browser_navigate` terdaftar di registry worker dan terbukti end-to-end, termasuk screenshot PNG 71 KB ke bind mount `./data/artifacts`.
4. **Gap 4: Verifikasi pada perangkat fisik** — NSIS installer belum dijalankan di Windows; APK belum dipasang di perangkat Android.

---

## 6. Analisis Risiko

| Risiko                                             | Dampak | Probabilitas | Mitigasi                                                                                                                            |
| :------------------------------------------------- | :----- | :----------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lonjakan Memori Chromium Headless**              | Tinggi | Sedang       | Concurrency browser dibatasi maksimal 1 sesi bersamaan (`BROWSER_MAX_CONCURRENCY=1`) dengan timeout 15 detik dan flag `--disable-dev-shm-usage`. Batas RAM container worker 2048 MB. VPS tidak memiliki swap, jadi OOM killer tetap mungkin; belum ada uji beban puncak. |
| **Gangguan Model Gateway 9Router (Timeout / 503)** | Sedang | Rendah       | Retry maksimal 3 percobaan (2 retry) dengan exponential backoff + jitter, hanya untuk 429/5xx/timeout/network (`packages/model-gateway/src/nine-router.ts`). Fallback model ada dan tetap melewati 9Router. Catatan: error 402 dipetakan ke kelas `UNKNOWN`, sehingga masalah kuota tidak dapat dibedakan dari kegagalan tak terduga. |
| **Koneksi Windows Worker Terputus Saat Eksekusi**  | Sedang | Sedang       | Sesi koneksi perangkat disimpan **in-memory** (`apps/api/src/services/device-connection-manager.ts`), sehingga restart API menghapus seluruh sesi dan semua perangkat tampak offline sampai mereka reconnect. Selain itu tidak ada jalur dispatch perintah dari task ke perangkat (lihat Butir 11), jadi mitigasi "task ditahan dan dilanjutkan" belum dapat diverifikasi. |
| **Exhaustion Disk Akibat Log atau Database**       | Rendah | Rendah       | Rotasi log Docker aktif (`/etc/docker/daemon.json`: `max-size 10m`, `max-file 3`). Retensi backup **14 hari** (`RETENTION_DAYS` default di `scripts/backup-postgres.sh:15`), bukan 7 hari seperti tertulis sebelumnya. Disk terpakai 42G/174G (25%). |
| **Kehilangan Memori Diam-diam**                    | Tinggi | **Rendah**   | **Dimitigasi 2026-10-13.** Tabel `memories` kini dibuat oleh migrasi `0007_memories.sql`, dan `DrizzleMemoryRepository` tidak lagi menelan kegagalan database, sehingga error terlihat alih-alih menjadi `201` palsu. Bukti live: create → restart API → data tetap ada. Sisa risiko: pencarian semantik tidak aktif (bukan kehilangan data) dan retensi tidak ditegakkan. |
| **Klaim Completion Palsu**                         | Tinggi | **Rendah**   | **Dimitigasi 2026-10-13.** Lingkungan coding mock `{passed:true}` dihapus dan diganti eksekusi nyata di workspace per task; `executeRegisteredTool` kini menjalankan `GenericEvaluator` sebelum menulis `completed` dan tidak melampirkan bukti bila tool tidak mengembalikan data. Bukti live: check gagal → `failed` (`score 0.71`), check lulus → `completed` (`score 1`). Sisa risiko: `GenericEvaluator` pada jalur tool memakai kriteria default dan belum memeriksa apakah output memenuhi permintaan pengguna; acceptance criteria belum dipersist sebelum eksekusi. |

---

## 7. Rencana Perbaikan Berurutan Prioritas

### Prioritas P0 (cacat fungsional, tidak memerlukan kredensial eksternal)

Diurutkan berdasarkan dampak terhadap kepercayaan pengguna. Nomor 1, 2, dan 3 sudah selesai pada 2026-10-13 dan dipertahankan di daftar ini sebagai catatan riwayat; nomor 4 dan seterusnya masih terbuka.

1. **Perbaiki pemulihan task — SELESAI (2026-10-13)**. `queue` kini diteruskan dan wajib; test regresi baru (`live-worker-execution.test.ts`) gagal bila queue tidak diteruskan; bukti live task `running` tanpa job → restart → `completed`.
2. **Buat memory persisten — SELESAI untuk persistensi (2026-10-13)**. Migrasi `0007_memories.sql` membuat tabel `memories` + `vector(1536)` + index, dan fallback diam-diam ke `InMemoryMemoryStore` dihapus. `:id` pada route memory kini divalidasi sebagai uuid, sehingga `GET`/`DELETE /v1/memories/search` menjawab `400`, bukan `500`. Sisa: provider embedding (9Router belum menyediakan; `No credentials for provider: openai`) dan sweeper retensi.
3. **Buat evaluator menilai bukti nyata — SELESAI (2026-10-13)**. `createDefaultEnvironment()` diganti `LocalCodingEnvironment` (perintah nyata, timeout, output terpotong) dan `executeRegisteredTool` digerbangi evaluator. Sisa yang belum selesai dari butir ini: acceptance criteria harus dipersist sebelum eksekusi agar evaluator menilai terhadap kriteria task, bukan kriteria default.
4. **Beri research jalur pencarian nyata** — daftarkan provider search yang sungguh-sungguh (SearXNG self-host atau API pihak ketiga) dan buat `ResearchEvaluator` menolak klaim tanpa sumber terverifikasi.
5. **Sambungkan dispatch perintah ke Windows Agent** — hubungkan `dispatchCommand` ke jalur task dengan approval, dan ganti identitas perangkat menjadi kriptografis (`devices.public_key` diisi dan diverifikasi).
6. **Perbaiki notifikasi dan FCM** — `NotificationEngine` di API harus memakai storage durable, dan `fcm-provider.ts` harus memperoleh token OAuth nyata dari service account, bukan literal `dummy-env-token`.
7. **Perluas audit** — tulis tool call, MCP call, browser action, dan artifact write ke `audit_logs`, bukan hanya keputusan approval.
8. **Tambahkan pemeriksaan paritas schema ↔ migrasi** — `memories` sudah punya migrasi dan `artifacts` yang tidak terpakai sudah dihapus, tetapi belum ada pemeriksaan otomatis, sehingga kelas bug ini masih bisa terulang.

### Prioritas P1 (kebersihan dan pengerasan)

1. **Hapus atau sambungkan dead code** — `AiCouncil` (`packages/agent-core/src/council/`) dan `SelfHealingEngine` (`packages/agent-core/src/healing/`) tidak dipanggil dari `apps/`. Putuskan: pakai atau buang.
2. **Streaming upload artifact** — `POST /v1/artifacts` saat ini menerima JSON string dengan batas efektif 1 MiB (`bodyLimit` Fastify default); `getArtifactStream` ada tetapi tidak dipakai. Validasi MIME juga masih berdasarkan deklarasi klien tanpa magic bytes.
3. **Sweeper retention** — `retention` pada memori dan artifact hanya field tersimpan; tidak ada yang menghapus data kedaluwarsa.
4. **Rate limit dan timeout pada jalur tool** — pastikan batas berlaku juga untuk pemanggilan MCP dan runtime.

### Prioritas P2 (operasional dan peningkatan)

1. **Konfigurasi FCM Push Notification Live** — menempatkan service account key pada direktori terisolasi server dan menetapkan `FCM_SERVICE_ACCOUNT_JSON` (setelah cacat P0 nomor 6 diperbaiki).
2. **Restore drill terjadwal** — prosedur pemulihan sudah lulus sekali terhadap arsip nyata, tetapi belum dijalankan sebagai rutinitas berkala.
3. **Integrasi OpenTelemetry Collector Eksternal** — menghubungkan `/metrics` di `apps/api/src/app.ts` ke Prometheus/Grafana untuk pemantauan jangka panjang dan alerting.
4. **Pengujian adapter runtime tambahan** — `runtimes/{pi,omp,hermes,openhands}-adapter` belum ada; Hermes dan OpenHands masih `UnverifiedRuntimeAdapter`.
5. **Verifikasi perangkat fisik** — jalankan NSIS installer di Windows dan pasang APK di perangkat Android.

---

## 8. Log Eksekusi Quality Gates

Log lama pada revisi sebelumnya berasal dari host Windows (`C:\Coding\Project\ai-agent`) dan tidak dapat direproduksi di lingkungan ini. Bagian ini menggantinya dengan hasil aktual dari checkout `release/installers` pada Linux aarch64.

### A. Linter (`pnpm lint`)

```text
Tasks:    14 successful, 14 total
Time:     ~3s
(0 error, 0 warning)
```

Catatan: `packages/mcp/test/fixtures/echo-server.mjs` sempat gagal `no-undef 'process'` karena ESLint tidak mengetahui global Node untuk berkas `.mjs`. Diperbaiki dengan `/* global process */` di berkas fixture, bukan dengan melonggarkan konfigurasi ESLint.

### B. Build (`pnpm build`)

```text
Tasks:    14 successful, 14 total
Time:     ~28s
```

### C. Test per-paket (bukan `pnpm test` di root)

`pnpm test` di root **tidak dapat dipakai**: task `scheduler:test` menggantung pada `ECONNREFUSED 127.0.0.1:6379`. Suite dijalankan per paket:

```text
@personal-ai-os/tools          30/30
@personal-ai-os/mcp            17/17
@personal-ai-os/agent-worker   33/33
@personal-ai-os/memory          7/7
@personal-ai-os/permissions     5/5
@personal-ai-os/agent-core     34/34
@personal-ai-os/evaluator       9/9
API (in-container)             51/51, 0 skipped
```

Suite API dijalankan di dalam image `personal-ai-os-api:latest`; image `node:22-bookworm-slim` polos gagal satu test karena tidak memiliki `git`, yang dibutuhkan `prepareWorkspace`.

### D. Verifikasi Referensi Path Dokumen (`pnpm verify:audit`)

```text
[Verify Audit Refs] Berhasil memverifikasi 88 path unik yang valid.
[SUKSES] Semua referensi path file dalam docs/final-audit.md 100% valid dan ada di filesystem.
```

### E. Bukti live produksi (2026-10-13)

```text
# Chat melalui 9Router, tanpa secret di klien
POST /v1/chat -> 200 {"content":"OK","resolvedModel":"agentic/space-bunny-free","usage":{"totalTokens":2972}}

# MCP stdio end-to-end
{"service":"agent-worker","event":"mcp_registered","serverId":"echo","tools":["mcp_echo_echo","mcp_echo_boom"]}
task -> waiting_approval (action "tool:mcp_echo_echo", riskLevel MEDIUM) -> approve -> completed
output: <untrusted_content source="mcp:echo/echo" is_instruction="false">

# Browser automation nyata
browser_navigate -> completed dengan judul dan konten halaman nyata
SSRF 169.254.169.254 -> failed

# Cacat 1 (DIPERBAIKI 2026-10-13): memori hilang saat restart
# Sebelum: POST /v1/memories -> 201; GET /v1/memories -> count=1
#          docker compose restart api; GET /v1/memories -> count=0
#          SELECT to_regclass('public.memories') -> null
# Sesudah: migrasi 0007_memories.sql diterapkan; POST -> 201; GET -> count=1;
#          docker compose restart api; GET -> count=1; SELECT count(*) FROM memories -> 1
#          POST /v1/memories/search -> 200 {"data":[],"semanticSearchActive":false,"status":"inactive"}
# Cacat 2 (DIPERBAIKI 2026-10-13): task pulih menggantung
# Sebelum: task dipaksa running/progress=40; restart worker; log {"action":"recovery","recoveredCount":1};
#          event task.resumed tertulis; 40 detik kemudian masih running/progress=40
# Sesudah: job BullMQ dihapus dari Redis; task dipaksa running/progress=40; restart worker;
#          log {"action":"recovery","recoveredCount":1}; final state completed/progress=100

# Cacat 3 (DIPERBAIKI 2026-10-13): evaluator menilai bukti mock
# Workspace nyata /app/data/workspaces/m3-fail (script lint -> exit 1):
#   POST /v1/tasks {kind:"coding_task", payload:{workspaceDir:"/app/data/workspaces/m3-fail", ...}}
#   -> failed; evaluationResult.score=0.71; remainingIssues:
#      ["Lint issue: Command failed: node --run lint",
#       "Coverage issue: Cakupan kebutuhan (60%) di bawah standar 80%"]
# Workspace nyata /app/data/workspaces/m3-pass (semua script -> exit 0):
#   -> completed, progress 100, evaluationResult.passed=true, score=1
#      artifact-diff-... memuat diff git nyata: "+export const helper = (n) => n + 1;"

# Cacat 4 (BELUM DIPERBAIKI): audit hanya approval
SELECT action, count(*) FROM audit_logs GROUP BY action;
 approval:denied   | 5
 approval:approved | 5

# Cacat 5: notifikasi belum pernah terkirim
SELECT count(*) FROM notifications; -> 0
```
