# Laporan Audit Akhir — Personal AI OS

**Tanggal Audit**: 2026-10-11, diperbarui 2026-10-13 dan 2026-10-14  
**Auditor**: Principal Software Architect & Security Engineer  
**Status Keseluruhan**: **CANDIDATE PRE-RELEASE (STAGING VERIFIED — MENUNGGU VERIFIKASI LANGSUNG DI VPS)**  
**Catatan Status**: Dokumen ini **direvisi 2026-10-13 dan 2026-10-14** setelah audit ulang terhadap database produksi dan container produksi yang berjalan. Revisi pertama menurunkan butir yang klaimnya tidak didukung bukti: 3 (recovery), 5 (memory), 7 (coding/research), 10 (notifikasi), 11 (Windows dispatch), 12 (observability). Butir 3 (recovery), persistensi memori pada butir 5, evaluator berbasis bukti nyata (butir 8), jalur coding **serta** research pada butir 7, dispatch + identitas kriptografis Windows pada butir 11, scheduler/notifikasi/FCM pada butir 10, **audit menyeluruh pada butir 12 (2026-10-14)**, dan **pemeriksaan paritas `schema.ts` ↔ migrasi (2026-10-14)** **sudah diperbaiki dan diverifikasi live**. Butir 5 tetap **SEBAGIAN**: pencarian semantik belum punya provider embedding dan retensi belum ditegakkan. Butir 11 tetap **SEBAGIAN**: allowlist teks-perintah/biner belum ada dan sesi perangkat masih in-memory. Butir 12 tetap **SEBAGIAN**: healthcheck worker masih menyentuh `/tmp/healthy` pada timer dan tidak ada alerting/tracing — hanya bagian audit yang kini lulus. **Seluruh delapan butir Prioritas P0 di §7 sudah selesai.**

---

## 1. Ringkasan Eksekutif & Ringkasan Quality Gates Monorepo

Audit akhir ini mengevaluasi arsitektur, kepatuhan keamanan, daya tahan tugas (_durable tasks & recovery_), isolasi data per-user, dan keandalan sistem **Personal AI OS** sebelum deployment ke server target.

Quality gates dijalankan pada checkout `release/installers` (Linux aarch64), bukan pada host Windows seperti pada revisi sebelumnya:

- **Linter (`pnpm lint`)**: 14/14 paket **LULUS** (0 error, 0 warning).
- **Production Build (`pnpm build`)**: 14/14 paket **LULUS**.
- **Verifikasi referensi path (`pnpm verify:audit`)**: 106 path unik valid (176 referensi diperiksa).
- **Test per-paket yang dijalankan ulang dan diverifikasi**: `@personal-ai-os/tools` 35/35, `@personal-ai-os/mcp` 17/17, `@personal-ai-os/agent-worker` 39/39, `@personal-ai-os/memory` 7/7, `@personal-ai-os/permissions` 6/6, `@personal-ai-os/agent-core` 40/40, `@personal-ai-os/evaluator` 9/9, `@personal-ai-os/android` 19/19, API in-container 63/63, scheduler in-container 25/25, windows 18/22 (4 skipped: eksekusi PowerShell butuh Windows).
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
  - `packages/agent-core/src/runtimes/runtime-manager.ts`: Memonitor runtime adapter terpasang serta status kesehatannya, dan membatasi laju/konkurensi eksekusi per runtime.
  - `packages/agent-core/src/runtimes/remote-adapter.ts`: Satu-satunya adapter yang didaftarkan produksi — meneruskan eksekusi ke `apps/runtime-bridge` di host.
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
  - Bukti live audit (2026-10-14): setiap pemanggilan `SecuredCapabilityGuard` menulis satu baris `audit_logs` setelah hasil diketahui — `web:fetch`/`web:search` (tool call), `tool:mcp_echo_echo` (`resource_type: external_mcp`, MCP call), `browser:navigate` (browser action), dan `artifact:write` (artifact write). Baris memuat aktor (`user_id`), action, resource, `decision`, dan `metadata.outcome` (`success`/`failure`) + `durationMs`/`error`. Bukti: SSRF `http://169.254.169.254/latest/meta-data/` tercatat `allow | failure | durationMs 0 | error "SSRF Protection…"`. Lihat §8.E "Cacat 5".

---

### Butir 7: Coding dan Research Menghasilkan Bukti, Laporan, Artefak

- **Status**: **LULUS** (sebelumnya GAGAL; jalur coding dan jalur research kini berjalan nyata)
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
- **Bukti bahwa research kini punya jalur pencarian dan browse nyata (2026-10-13)**:
  - `packages/tools/src/builtin/web-search.ts` kini mencari sungguhan: `duckDuckGoSearch` menembak `https://html.duckduckgo.com/html/` (tanpa API key), membuka pembungkus redirect `/l/?uddg=…` menjadi URL tujuan, dan menolak melaporkan "0 hasil" palsu — markup tak dikenal atau HTTP non-2xx menghasilkan error, bukan daftar kosong. User agent harus bebas kata `bot`; DuckDuckGo membalas `202` tanpa hasil untuk UA yang menyebut dirinya bot.
  - `createDefaultToolRegistry` mendaftarkan `web_search` bersama `web_fetch` (`packages/tools/src/registry/create-default-tool-registry.ts:20-21`), jadi pencarian melewati `ToolRegistry` yang sama dan diperiksa `PermissionEngine` (`web:search`, LOW) seperti tool lain.
  - `packages/agent-core/src/research/local-environment.ts` (baru): `LocalResearchEnvironment` mengambil hasil lewat `web_search` dan membuka setiap halaman lewat `web_fetch` — tidak ada klien HTTP privat yang melewati permission check. Halaman yang hasilnya dipotong registry, halaman non-2xx, halaman tanpa teks terbaca (< 200 karakter setelah `htmlToText`), dan halaman yang gagal di-fetch dibuang dan dicatat sebagai limitation.
  - `ResearchAgent.execute` tidak lagi punya daftar sumber hardcoded: `mockSources`/`mockEnvironment` hilang dari input produksi, dan tanpa `environment` ia menghasilkan nol sumber sehingga `ResearchEvaluator` menolak (`No valid sources provided`). Tahap `browse` kini benar-benar diset dan `fetchContent` dipanggil untuk setiap sumber; `snippet` berasal dari konten nyata, bukan dari mesin pencari.
  - Klaim tidak lagi hardcoded: setiap klaim adalah kutipan awal halaman yang benar-benar diambil, dengan `sourceIds` ke sumber itu. `NO_SYNTHESIS_LIMITATION` (`packages/agent-core/src/research/research-agent.ts:15-21`) menyatakan di setiap laporan bahwa tidak ada sintesis lintas sumber.
  - `packages/tools/src/html-text.ts` (baru): `htmlToText` membuang blok `<script>`/`<style>` sebelum tag, karena halaman SPA yang hanya berisi JavaScript sebelumnya terbaca seperti prosa dan masuk ke laporan sebagai "fakta".
  - `web_fetch.outputLimitBytes` dinaikkan 64 KiB → 1 MiB (`packages/tools/src/builtin/web-fetch.ts:31-33`): di atas batas itu registry mengganti output dengan amplop JSON terpotong yang tidak bisa dibaca sebagai dokumen.
  - Bukti live 2026-10-13 (task `46098f3e-4cd6-4958-b94e-b2bf30ea283e`, query "durable execution in PostgreSQL"): `completed`, progress 100, `evaluationResult.passed=true`/`score=1` dengan 5 sumber nyata (temporal.io, learn.microsoft.com ×2, github.com ×2) dan 5 klaim tertaut ke halaman yang benar-benar diambil; artifact `artifact-research-report-…` memuat tabel sitasi.
  - Bukti live fail-closed (task `c38ae271-1237-4d58-8ff2-6cf27927be00`, query tanpa hasil): `failed`, `score=0`, `completionBlockedReason = "Research completion blocked: No valid sources provided."`, dan limitation mencatat `1 pencarian gagal: … membalas HTTP 200 tanpa markup hasil yang dikenal.` Tidak ada sumber yang dikarang.
  - Bukti live penolakan sumber tunggal (task `597838e9-304e-4aec-8c0a-ed62f679011e`): `failed`, `score=0.8`, kriteria `cross_check` gagal karena hanya 1 sumber yang bisa dibaca, dan 4 URL yang gagal dibaca disebut namanya di limitation.
- **Yang benar-benar bekerja**: jalur coding mengeksekusi perintah nyata di workspace nyata dan menyerahkan hasilnya ke `CodingEvaluator`; jalur research mencari, membuka, dan mengutip halaman nyata; `web_fetch` nyata (SSRF guard + HTTP fetch asli); `ArtifactManager` menyimpan hasil dengan checksum sha256. **Yang belum ada**: sintesis lintas sumber oleh model — klaim adalah kutipan awal tiap halaman, sehingga relevansi jawaban terhadap pertanyaan belum dinilai, dan `ResearchEvaluator` tidak mem-fetch URL sendiri untuk memverifikasi isi sitasi.

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

- **Status**: **LULUS**
- **Persyaratan**: Eksekusi otomatis dari jadwal dan event wajib melalui Permission Engine, memiliki deduplikasi, dan notifikasi ber-retry terbatas. Pengiriman FCM nyata hanya aktif jika kredensial tersedia.
- **Bukti File Relatif**:
  - `apps/scheduler/src/scheduler-engine.ts`: Tracking idempotency key per slot eksekusi dan penanganan missed-run policy (`skip`, `run_once`, `catch_up`).
  - `apps/scheduler/src/event-engine.ts`: Event-triggered task divalidasi lewat `PermissionEngine`; aksi berisiko masuk `waiting_approval`.
  - `apps/scheduler/src/notification-engine.ts`: Jendela deduplikasi (60 detik) mencegah spam notifikasi; seluruh baca/tulis notifikasi dan preferensi lewat `NotificationStorage`.
  - `apps/scheduler/src/fcm-provider.ts`: `ServiceAccountTokenSource` menukar JWT RS256 service account menjadi access token OAuth2 (`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`, scope `firebase.messaging`) dan menyimpannya sampai mendekati `expires_in`. Jika `FCM_SERVICE_ACCOUNT_JSON` tidak disetel atau tidak lengkap, pengiriman dinonaktifkan secara eksplisit dengan pesan log transparan (tanpa mock diam-diam).
  - `apps/api/src/services/task-notifications.ts`: Event task dari Redis (`task.completed`, `task.failed`, `task.waiting_approval`) menjadi baris `notifications` durable dengan deep link dan data approval/task.
  - `apps/api/src/db/notification-repository.ts` + `apps/api/src/db/migrations/0009_device_push_token.sql`: notifikasi dan preferensi disimpan di PostgreSQL; `devices.push_token` menyimpan token FCM per perangkat.
- **Bukti Test & Output**:
  - Test: `apps/scheduler/test/scheduler.test.ts`, `apps/scheduler/test/event-engine.test.ts`, `apps/scheduler/test/notifications.test.ts`, `apps/scheduler/test/fcm-provider.test.ts` (25/25 lulus).
  - Test: `apps/api/test/task-notifications.test.ts` (3/3) dan `apps/api/test/devices-and-agent.test.ts` — event task menjadi baris notifikasi, dan token push hanya bisa didaftarkan untuk perangkat milik pemanggil.
  - Test: `apps/api/test/e2e-scenarios.test.ts` — `Skenario 6: Jadwal berulang berjalan tepat sekali`
  - Output Aktual: `✔ Skenario 6: Jadwal berulang berjalan tepat sekali (957.1265ms)`
- **Bukti live (2026-10-14)** ada di §8.E "Cacat 6": task gagal, task selesai terjadwal, dan event `task.waiting_approval` yang dipublikasikan ke Redis semuanya menghasilkan baris `notifications` dengan `delivery_state` dan `deep_link` yang benar; baris dan preferensi bertahan setelah `docker compose restart api`.
- **Retry dan dead-letter**: percobaan push dibatasi `maxAttempts` (default 3) dengan backoff eksponensial per perangkat, lalu state menjadi `failed` dengan `last_error`. Tidak ada dead-letter queue; kegagalan push hanya terlihat lewat baris notifikasi dan log, bukan retry tak terbatas.
- **Yang benar-benar bekerja**: ketiga missed-run policy (`skip`, `run_once`, `catch_up`) ada; timezone disimpan dan dihitung; idempotency slot `sched:<jobId>:<ISO>` ada di Set in-memory plus unique index DB pada jalur proses scheduler; `EventEngine` **tidak dapat** dispatch tanpa `PermissionEngine` (gate di `apps/scheduler/src/event-engine.ts:137`); container `scheduler` adalah satu-satunya pemanggil `tick()` di produksi, dan dispatcher-nya menulis baris `tasks` lalu meng-enqueue BullMQ. Proses API hanya mendaftarkan jadwal ke tabel `schedules` (dispatcher duplikat yang tidak pernah menulis `tasks` sudah dihapus).
- **Keterbatasan tambahan**: tidak ada verifikasi signature pada event masuk, dan `registerRule` tidak pernah dipanggil di produksi. Pengiriman FCM nyata belum pernah diuji terhadap Google karena `FCM_SERVICE_ACCOUNT_JSON` belum diisi di produksi — yang terbukti adalah alur OAuth-nya terhadap stub HTTP, bukan pengiriman sungguhan.

---

### Butir 11: Windows Agent Terautentikasi dan Capability-Limited

- **Status**: **SEBAGIAN** (sebelumnya dinyatakan LULUS). Identitas kriptografis, dispatch, dan allowlist teks-perintah/biner sudah nyata; sisa cacat adalah sesi koneksi in-memory.
- **Persyaratan**: Windows Agent beroperasi sebagai remote worker dengan identitas perangkat kriptografis, koneksi outbound WSS terautentikasi, allowlist command, dan penanganan status offline.
- **Bukti File Relatif**:
  - `apps/api/src/services/device-identity.ts`: Parsing JWK publik, thumbprint RFC 7638, dan verifikasi tanda tangan P-256 challenge handshake.
  - `apps/api/src/routes/agent-ws.ts`: Handshake `/v1/agent/ws` dengan challenge bertanda tangan; `deviceId` dari query string ditolak.
  - `apps/windows/src/connection/device-key.ts`: Penyimpanan keypair P-256 agent dan penandatanganan challenge.
  - `apps/windows/src/connection/device-identity.ts`: Identitas perangkat (name/platform/hostname/arch) tanpa id buatan sendiri.
  - `apps/windows/src/connection/agent-connection.ts`: Koneksi WSS outbound ke `/v1/agent/ws` dengan handshake dan reconnect otomatis.
  - `apps/windows/src/security/capability-registry.ts`: Pendaftaran kapabilitas yang diizinkan (default powershell non-aktif kecuali diaktifkan eksplisit).
  - `apps/windows/src/security/command-allowlist.ts`: Parser teks perintah + allowlist biner bawaan (`DEFAULT_ALLOWED_COMMANDS`), deny by default.
  - `apps/windows/src-tauri/src/command_allowlist.rs`: Cermin aturan yang sama di sisi Rust, dipanggil sebelum `execute_powershell`.
  - `apps/windows/src/security/command-executor.ts`: Eksekusi command dalam batas direktori kerja yang divalidasi.
  - `apps/windows/src-tauri/src/main.rs`: Backend Tauri Rust yang membatasi akses native OS.
- **Yang benar-benar bekerja**:
  - Koneksi WSS outbound ke `/v1/agent/ws` dengan handshake, ping, dan reconnect otomatis.
  - Capability registry dengan 7 kapabilitas, seluruhnya `default enabled: false`, allowlist ditegakkan lewat `assertCapabilityAllowed` (`apps/windows/src/security/capability-registry.ts:116`) ditambah validasi capability + action + `cwd`.
  - `PathValidator` menolak device namespace, alternate data stream, null byte, dan traversal (`apps/windows/src/security/path-validator.ts:78-118`).
  - Test `apps/windows/test/command-executor.test.ts` dan `connection-and-offline.test.ts` lulus.
  - Identitas perangkat kini kriptografis: agent membuktikan kepemilikan private key P-256 atas challenge server, dan baris `devices` lahir dari key itu. Test regresi: `apps/api/test/device-handshake.test.ts` dan `apps/windows/test/connection-and-offline.test.ts` (menandatangani challenge nyata, diverifikasi verifier server). Bukti live 2026-10-14: lihat §8.E.
- **Bukti live 2026-10-13 (cacat dispatch DIPERBAIKI)**:
  - **Sebelum**: `dispatchCommand` (`apps/api/src/services/device-connection-manager.ts:202`) memiliki **nol pemanggil di `apps/`**, dan worker hanya memeriksa `hasOnlineDeviceForUser('windows')`. Tidak ada kode produksi yang mengirim perintah ke perangkat, sehingga Skenario 5 membuktikan handshake dan penolakan traversal hanya di dalam satu proses test.
  - **Sesudah**: jalur produksi task → perangkat → hasil nyata ada. `TaskExecutor` meminta presence ke API (`DeviceDispatcher.listOnlineDevices`), dan bila `payload.targetDevice` online ia memanggil `dispatchCommand` lewat `SecuredCapabilityGuard` dengan aksi `device:command` (`apps/agent-worker/src/task-executor.ts:167-205`, `:663-884`). Route internal ber-token `POST /v1/internal/device-commands` (`apps/api/src/routes/device-commands.ts:43`) menjembatani worker ke socket perangkat, karena socket hanya hidup di proses API; Caddy menutup `/v1/internal/*` dengan `404` sehingga hanya terjangkau dari network Docker internal.
  - Perintah perangkat berisiko **HIGH** dan tidak diizinkan tanpa approval (`packages/permissions/src/engine.ts:127`); fingerprint approval memuat teks perintah dan `deviceId`, sehingga approval satu perintah tidak mengotorisasi perintah lain.
  - **Bukti live**: task `954db21a-b14f-44ad-b2c2-49b4a2e99d55` (`kind: windows_command`, `payload.targetDevice: win-smoke-m5`, `command: hostname`) → `task.waiting_approval` (`device:command`, HIGH) → `POST /v1/approvals/…/approve` `200` → perangkat benar-benar menerima `command.execute` melalui WSS → `task.completed` dengan `exitCode 0` dan artifact `artifact-device-…` berisi `stdout` perangkat (`SMOKE-WORKSTATION`). Verdict task adalah exit code perangkat; tidak ada langkah evaluator yang melunakkannya.
  - **Kasus offline**: task dengan `targetDevice` yang tidak terhubung → `failed` dengan `offlineReason: device_unreachable`, bukan sukses palsu. Perbaikan ini juga menutup bug yang ditemukan saat verifikasi live: task dari state `queued` melompat ke `failed` melanggar state machine (`IllegalTaskStateTransitionError`), sehingga task sebelumnya tertinggal `queued` selamanya tanpa error yang terlihat; kini transisi melewati `planning`.
  - **Cacat crash yang ikut diperbaiki**: handshake `/v1/agent/ws` menulis `deviceId` dari query string ke `devices.id` (kolom `uuid`) tanpa validasi apa pun. Agent Windows mengirim id non-uuid (`win-dev-<hash>`), sehingga Postgres melempar `22P02` sebagai *unhandled rejection* dan **seluruh proses API mati** (terbukti live: `PostgresError: invalid input syntax for type uuid: "win-smoke-m5"`). Penulisan itu dihapus — tidak ada jalur produksi yang pernah membuat baris `devices` untuk agent Windows, jadi `lastSeenAt` yang ditulis selalu tidak bertuan. `GET /v1/devices` kini membaca baris terdaftar dan menandai presence dari sesi online (`apps/api/src/app.ts:378-387`), sehingga perangkat yang terhubung tetap terlihat.
- **Identitas perangkat kriptografis — SELESAI (2026-10-14)**:
  - Server tidak lagi mempercayai id yang diklaim agent. `/v1/agent/ws` menolak `deviceId` di query string dengan `DEVICE_IDENTITY_REQUIRED` (`apps/api/src/routes/agent-ws.ts:60-78`), mengirim `device.challenge` berisi 32 byte acak, dan hanya membuat sesi setelah agent menandatangani challenge itu dengan private key P-256 miliknya.
  - `apps/api/src/services/device-identity.ts` memvalidasi JWK (`parseDevicePublicKey` menolak JWK ber-`d`, sehingga private key tidak bisa dipakai sebagai bukti), menghitung thumbprint RFC 7638 (`crv,kty,x,y`), dan memverifikasi tanda tangan dengan `crypto.verify(..., { dsaEncoding: 'ieee-p1363' })` karena WebCrypto mengeluarkan raw `r||s` — tanpa `dsaEncoding` setiap tanda tangan jujur terlihat tidak valid.
  - `DeviceRepository.registerAgent` mencari baris berdasarkan `(userId, public_key)` dan hanya membuat baris baru bila key itu belum dikenal, sehingga reinstall agent dengan hostname sama tidak menghasilkan duplikat. Unique index `devices_user_name_uq` diganti `devices_public_key_uq` (parsial, `WHERE public_key IS NOT NULL`) oleh migrasi `0008_device_key_identity.sql`.
  - `deviceId` yang dipakai agent adalah uuid yang diterbitkan server pada `device.handshake_ack`; agent Windows menyimpan keypair di `localStorage` webview (`apps/windows/src/connection/device-key.ts`) dan tidak pernah lagi membuat id sendiri (`win-dev-<hash>` dihapus dari `apps/windows/src-tauri/src/main.rs`).
  - `DeviceConnectionManager.registerConnection` menutup socket lama saat key yang sama reconnect dan `unregisterConnection(deviceId, socket)` hanya melepas sesi bila socket itu masih pemiliknya, sehingga socket basi tidak bisa menandai perangkat offline setelah reconnect.
  - Test regresi: `apps/api/test/device-handshake.test.ts` (id yang diklaim ditolak, tanda tangan yang tidak cocok ditolak, key sama → satu baris, key baru → baris baru, tanpa registry → `DEVICE_REGISTRY_UNAVAILABLE`, JWK ber-`d` → `DEVICE_KEY_INVALID`) dan `apps/windows/test/connection-and-offline.test.ts` (agent menandatangani challenge nyata, lalu diverifikasi dengan verifier server).
- **Cacat identitas perangkat yang tersisa**:
  - Sesi koneksi perangkat disimpan in-memory (`device-connection-manager.ts`), sehingga hilang saat API restart — baris `devices` dan `public_key` tetap ada, tetapi agent harus reconnect sebelum task bisa dikirim.
  - Private key agent disimpan di `localStorage` webview, bukan OS keystore. Ini platform facility yang tersedia tanpa menambah dependency Rust; lebih kuat dari string id sebelumnya, lebih lemah dari keystore OS. Batas ini ditulis di `apps/windows/src/connection/device-key.ts`.
- **Allowlist teks-perintah/biner — SELESAI (2026-10-14)**: `apps/windows/src/security/command-allowlist.ts` mem-parse teks perintah, mengekstrak program yang dipanggil, dan menolak apa pun di luar allowlist lokal dengan kode non-generik `COMMAND_NOT_ALLOWED` yang menyebut token pelanggarnya (`CommandNotAllowedError.token`, `.reason`). Deny by default: `DEFAULT_ALLOWED_COMMANDS` berisi `hostname` (dipakai smoke M4) plus program yang diuji paket ini sendiri (`dir`, `Get-ChildItem`, `Get-Date`, `Write-Output`, `Start-Sleep`, `ForEach-Object`); kapabilitas tanpa allowlist (mis. `git`) menolak semua teks perintah. Konfigurasinya memakai kanal yang sudah ada — `CapabilityRule.allowedCommands` lewat `setGranularRule`, dibaca `getAllowedCommands` (`apps/windows/src/security/capability-registry.ts`) — dan cermin Rust `CapabilityConfig.allowed_commands` dengan perintah Tauri `get_allowed_commands`/`set_allowed_commands`. Bypass yang ditolak dengan alasan bernama: `;`, `&&`, `||`, `|`, newline, `$(...)`/backtick/subshell (`SUBSHELL`), `&` call operator (`CALL_OPERATOR`), `-EncodedCommand`/`-enc`/`-encodedc` (`ENCODED_COMMAND`), `Invoke-Expression`/`iex` (`DYNAMIC_EXECUTION`), shell wrapper `cmd /c`, `cmd.exe /c`, `powershell(.exe) -Command`, `pwsh`, `wsl` (`SHELL_WRAPPER`, ditolak walau di-allowlist), dan program bernama path/ekstensi `C:\...\evil.exe`, `./`, `..\`, UNC, `.ps1` (`PATH_QUALIFIED_COMMAND`). Penegakan ada di tiga jalur: `apps/windows/src/security/command-executor.ts:53` dan `apps/windows/src/security/tauri-executor.ts:37` (sebelum spawn/invoke) serta `apps/windows/src-tauri/src/main.rs:227-228` (sebelum `executor::execute_powershell`) — Rust adalah jalur produksi karena `apps/windows/src/state/agent-store.ts:305-306` memasang `TauriCommandExecutor`, sementara `CommandExecutor` hanya dipakai test. Payload server tidak bisa memperlebarnya: `handleExecuteCommand` hanya membaca `command`/`cwd`/`capability`/`action`/`timeoutMs` dan mengabaikan field `allowedCommands` dari wire (diuji di `apps/windows/test/command-allowlist.test.ts`).
- **Bukti test allowlist**: `apps/windows/test/command-allowlist.test.ts` 13 test lulus (biner yang diizinkan lolos, biner terlarang ditolak dan disebut namanya, tiap bentuk bypass ditolak, allowlist dapat dikonfigurasi/dikurangi/dikosongkan, `CommandExecutor` menolak sebelum spawn dengan `getActiveExecutionCount() === 0`, frame `command.execute` dari wire tidak dapat memperlebar allowlist). Suite paket lengkap: `node --test --experimental-strip-types test/*.test.ts` di `apps/windows` → 35 test, 31 lulus, 4 skip (4 test PowerShell lama yang butuh Windows). Sisi Rust: `cargo test --offline` di `apps/windows/src-tauri` → 5 test lulus di `command_allowlist::tests`. **Batas bukti: jalur perangkat Windows nyata (hardware) TIDAK dijalankan untuk allowlist ini** — yang diamati hanya unit/integration test di atas; bukti live dispatch di Butir 11 berasal dari perintah `hostname` sebelum allowlist ini ada.
- **Tidak ada pemetaan** capability Windows ke capability Personal AI OS. Direktori `runtimes/{pi,omp,hermes,openhands}-adapter` juga tidak ada di repository. **Dikoreksi 2026-10-14**: adapter stub `UnverifiedRuntimeAdapter`/`HermesRuntimeAdapter`/`OpenHandsRuntimeAdapter` yang dulu mengklaim Hermes dan OpenHands menolak eksekusi sudah **dihapus** — jalur produksi satu-satunya adalah `RemoteRuntimeAdapter` ke `apps/runtime-bridge` (`RuntimeId = 'omp' | 'hermes'`), dan keduanya terverifikasi live (`docs/verification/runtimes-live.md`). Hanya OpenHands yang benar-benar belum ada: tanpa adapter, tanpa entri bridge, tanpa slot allowlist.

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
- **Bukti live audit menyeluruh — SELESAI (2026-10-14)**: `SecuredCapabilityGuard` (`packages/permissions/src/guard.ts`) kini menulis **satu baris `audit_logs` per pemanggilan**, setelah hasil diketahui (`metadata.outcome` `success`/`failure` + `durationMs` + `error`). Guard diberi `auditLogger` di kedua proses: API (`apps/api/src/index.ts` → `createDefaultToolRegistry`) dan worker (`apps/agent-worker/src/index.ts` → registry + browser). Artifact write diaudit lewat `ArtifactManager.auditSink` (`packages/tools/src/artifacts/artifact-manager.ts`) yang dipakai API maupun worker. Kolom `audit_logs.resource_id` diubah dari `uuid` ke `varchar(512)` (migrasi `0010_audit_resource_id_text.sql`) karena tool call menulis path/URL/nama tool. Kegagalan sink tidak pernah mengubah hasil yang dilihat pemanggil. Pemanggilan tool MCP tercakup jalur guard yang sama (`action: tool:mcp_<server>_<tool>`, `resource_type: external_mcp`), jadi audit MCP tidak lagi hanya ke `console.log` (sink console.log di worker dihapus). Bukti live di §8.E "Cacat 5".
- **Keterbatasan / Mengapa SEBAGIAN**:
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
| **Windows device identity + allowlist**          | **SEBAGIAN** | **Identitas kriptografis SELESAI 2026-10-14**: agent membuktikan kepemilikan keypair P-256 atas challenge server, `deviceId` diterbitkan server (query string `deviceId` ditolak `DEVICE_IDENTITY_REQUIRED`), dan `devices.public_key` diisi serta diverifikasi. **Dispatch diperbaiki 2026-10-13**: `dispatchCommand` kini dipanggil dari jalur task dengan approval HIGH per perintah dan bukti live task → perangkat → hasil (lihat Butir 11). Path allowlist, capability registry, dan **allowlist teks-perintah/biner (SELESAI 2026-10-14)** nyata dan ditegakkan. Sisa: sesi koneksi in-memory. |
| **MCP / tools / browser ber-permission & audit** | **LULUS** | Semua eksekusi melewati `SecuredCapabilityGuard` (`packages/permissions/src/guard.ts`), dan MCP live terbukti `waiting_approval` → approve → `completed`. **Audit diperbaiki 2026-10-14**: setiap pemanggilan guard menulis satu baris `audit_logs` dengan aktor, action, resource, `decision`, dan `metadata.outcome` (`success`/`failure`) + `durationMs`/`error`; artifact write lewat `ArtifactManager.auditSink`. Tool call (`web:fetch`/`web:search`), MCP call (`tool:mcp_echo_echo`, `resource_type: external_mcp`), browser action (`browser:navigate`), dan artifact write (`artifact:write`) semua tercatat di produksi; audit MCP tidak lagi hanya `console.log`. Bukti live di §8.E "Cacat 5". |
| **Evaluator menentukan completion**              | **SEBAGIAN** | Evaluator dipanggil pada keempat jalur (coding, research, standard, tool). **Jalur tool diperbaiki 2026-10-13**: `executeRegisteredTool` menjalankan `GenericEvaluator` atas hasil tool sebelum menulis `completed`, dan tidak melampirkan bukti palsu bila tool mengembalikan `null`/`undefined` (`apps/agent-worker/src/task-executor.ts:637-674`). **Bukti coding kini nyata**: `LocalCodingEnvironment` menjalankan `node --run lint/typecheck/test/build` di workspace per task; bukti live task `3f5aeee2-…` → `failed` (`score 0.71`, lint keluar 1), task `a5776358-…` → `completed` (`score 1`). **Bukti research kini nyata**: `ResearchAgent` mencari dan membuka halaman sungguhan; bukti live task `46098f3e-…` → `completed` (`score 1`, 5 sumber nyata), task `c38ae271-…` → `failed` (`score 0`, tanpa sumber). Sisa: acceptance criteria belum dipersist sebelum eksekusi, dan klaim research belum disintesis model. Lihat Butir 7 dan 8. |
| **Approval terikat aksi spesifik**               | **LULUS**    | Model approval mencakup `action`, `resource`, `riskLevel`, `consequence` di `apps/api/src/routes/approvals.ts`.                                                                                |
| **Scheduler & Event Deduplication**              | **LULUS**    | Idempotency key dan dedupe window ada, `EventEngine` tidak dapat dispatch tanpa `PermissionEngine`. `NotificationEngine` di API kini memakai `SqlNotificationRepository` + `createFcmProviderFromEnv()`, dan event task dari Redis menjadi baris `notifications` durable (`apps/api/src/services/task-notifications.ts`). Lihat Butir 10 dan §8.E "Cacat 6". |
| **FCM Push Notification Live Kredensial**        | **SEBAGIAN** | Alur OAuth nyata ada: `ServiceAccountTokenSource` menandatangani JWT RS256 dengan `client_email`/`private_key` service account dan menukarnya ke `token_uri`; `HttpFcmProvider` memakai bearer token itu per pengiriman. Literal `dummy-env-token` sudah dihapus. **Belum**: pengiriman sungguhan ke Google, karena `FCM_SERVICE_ACCOUNT_JSON` belum diisi di produksi. |
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
| 5   | Windows Agent terhubung, allowlist berjalan, luar allowlist ditolak, offline ditangani | LULUS       | **Ya** (live 2026-10-13, identitas 2026-10-14)     | Handshake `/v1/agent/ws` (sejak 2026-10-14 bertanda tangan P-256 dengan `deviceId` terbitan server), eksekusi perintah allowlist, penolakan traversal `C:\Windows\System32`, dan transisi offline diuji di dalam satu proses test; klaim produksinya kini juga dibuktikan live: task `windows_command` dengan `payload.targetDevice` → `waiting_approval` → approve → perangkat menerima `command.execute` → `completed` dengan artifact berisi `stdout` perangkat; perangkat offline → `failed` (`offlineReason: device_unreachable`). |
| 6   | Jadwal berulang berjalan tepat sekali                                                  | LULUS       | **Ya**                       | `SchedulerEngine` mengeksekusi slot waktu tepat sekali; pemanggilan berulang pada timestamp yang sama diabaikan oleh deduplikasi idempotency key.                                             |
| 7   | Isolasi: user A tidak bisa membaca project/task/memori user B                          | LULUS       | **Ya**                       | User B mendapat `HTTP 404` dan list kosong. Isolasi memori kini juga terverifikasi live di produksi (2026-10-13) setelah tabel `memories` ada: user B `GET /v1/memories/<id-milik-A>` → `404 Memory not found`, `GET /v1/memories` → `count=0`, sementara user A `GET` id yang sama → `200`. |

---

## 5. Daftar Gap yang Tersisa

Dibagi dua: cacat fungsional yang dapat diperbaiki sekarang, dan gap operasional yang menunggu lingkungan atau kredensial eksternal.

### 5.1 Cacat fungsional (tidak memerlukan kredensial eksternal)

1. **Memory tidak persisten — SELESAI (2026-10-13)**. Migrasi `0007_memories.sql` membuat tabel `memories` + `vector(1536)` + 5 index + check constraint; `DrizzleMemoryRepository` tidak lagi menelan error DB; `artifacts` yang tak terpakai dihapus dari schema. Bukti live: create → restart API → data tetap ada. Sisa: provider embedding (eksternal) dan sweeper retensi.
2. **Recovery task menggantung — SELESAI (2026-10-13)**. `recoverInterruptedTasks` sekarang menerima `queue` wajib, `createAgentWorker` menyediakan queue, dan test regresi baru gagal bila queue tidak diteruskan. Diverifikasi live: task `running` tanpa job → restart → `completed`.
3. **Evaluator tidak memverifikasi apa pun pada jalur coding — SELESAI (2026-10-13)**. `createDefaultEnvironment()` yang mengembalikan `{passed:true}` dihapus dan diganti `LocalCodingEnvironment` yang menjalankan `node --run lint/typecheck/test/build` di workspace per task (`packages/agent-core/src/coding/local-environment.ts`); `executeRegisteredTool` kini menjalankan `GenericEvaluator` sebelum `completed` (`apps/agent-worker/src/task-executor.ts:637-674`). Bukti live: workspace dengan `lint` gagal → `failed` (`score 0.71`); workspace dengan script lulus → `completed` (`score 1`).
4. **Research tanpa jalur pencarian — SELESAI (2026-10-13)**. `web_search` kini mencari sungguhan lewat DuckDuckGo HTML (`duckDuckGoSearch`) dan terdaftar di `createDefaultToolRegistry`; `LocalResearchEnvironment` (`packages/agent-core/src/research/local-environment.ts`) memakai `web_search` + `web_fetch` melalui `ToolRegistry` yang sama, jadi `web:search`/`web:fetch` diperiksa `PermissionEngine`. Sumber dan claim hardcoded di `ResearchAgent` dihapus: tanpa environment, run berakhir `failed` dengan `No valid sources provided`. Bukti live: query nyata → `completed` (`score 1`, 5 sumber nyata); query tanpa hasil → `failed` (`score 0`). Sisa: sintesis lintas sumber oleh model belum ada, sehingga klaim berupa kutipan awal halaman.
5. **Tidak ada jalur dispatch perintah ke Windows Agent — SELESAI (2026-10-13)**. `dispatchCommand` kini dipanggil dari jalur task: worker meminta presence ke API (`DeviceDispatcher.listOnlineDevices`), route internal ber-token `POST /v1/internal/device-commands` mengirim `command.execute` ke socket perangkat, dan hasil perangkat menjadi artifact. Aksi `device:command` berisiko HIGH dan selalu butuh approval yang terikat pada teks perintah + `deviceId`. Bukti live: task `954db21a-…` → `waiting_approval` → approve → `completed` (`exitCode 0`, `stdout` perangkat di artifact); perangkat offline → `failed` (`offlineReason: device_unreachable`). Cacat ikutan yang ditemukan dan diperbaiki: task `queued` yang gagal sebelum mulai melanggar state machine dan tertinggal `queued` selamanya. Sisa: belum ada allowlist teks-perintah/biner, dan identitas perangkat belum kriptografis (butir 9).
6. **Notifikasi belum pernah terkirim — SELESAI (2026-10-14)**. `NotificationEngine` di API kini dibuat dengan `SqlNotificationRepository` dan `createFcmProviderFromEnv()`; `broadcaster.subscribe(createTaskNotificationListener(...))` mengubah event task (`task.completed`, `task.failed`, `task.waiting_approval`) dari Redis menjadi baris `notifications` durable dengan `delivery_state` dan `deep_link`. Preferensi notifikasi juga durable (bertahan setelah `docker compose restart api`). Bukti live di §8.E "Cacat 6". Sisa: tidak ada dead-letter queue untuk push yang gagal `maxAttempts`.
7. **Token FCM hardcoded `dummy-env-token` — SELESAI (2026-10-14)**. `HttpFcmProvider` kini menerima `FcmAccessTokenSource`; `ServiceAccountTokenSource` menandatangani JWT RS256 dengan `client_email`/`private_key` service account dan menukarnya ke `token_uri` lewat grant `jwt-bearer`, lalu menyimpan access token sampai mendekati `expires_in` (margin 60 detik). Service account yang tidak lengkap menghasilkan `DisabledFcmProvider`, bukan pengiriman dengan token literal. Test: `apps/scheduler/test/fcm-provider.test.ts` (4/4, stub HTTP server).
8. **Audit tidak menyeluruh — SELESAI (2026-10-14)**. `SecuredCapabilityGuard` menulis satu baris `audit_logs` per pemanggilan setelah hasil diketahui (`metadata.outcome` + `durationMs` + `error`), guard diberi `auditLogger` di API dan worker, artifact write diaudit lewat `ArtifactManager.auditSink`, dan `audit_logs.resource_id` menjadi `varchar(512)` (migrasi `0010`). Bukti live: §8.E "Cacat 5".
9. **Identitas perangkat tidak kriptografis — SELESAI (2026-10-14)**. `/v1/agent/ws` menerbitkan challenge acak; agent menandatanganinya dengan private key P-256 dan server memverifikasi sebelum membuat sesi. `deviceId` dari query string ditolak (`DEVICE_IDENTITY_REQUIRED`), id perangkat adalah uuid yang diterbitkan server, dan `devices.public_key` diisi dengan JWK kanonik (unique parsial `devices_public_key_uq`, migrasi `0008_device_key_identity.sql`). Bukti live di §8.E. Sisa: private key disimpan di `localStorage` webview, bukan OS keystore.
10. **Skema menyimpang dari migrasi — SELESAI (2026-10-14)**. `memories` kini punya migrasi dan tabel `artifacts` yang tidak terpakai sudah dihapus dari `schema.ts`. Pemeriksaan paritas otomatis ditambahkan: `apps/api/test/schema-parity.test.ts` membuat database sementara, menerapkan **seluruh** migrasi `apps/api/src/db/migrations/` dari nol, mengintrospeksi hasilnya (`pg_attribute` + `format_type`), lalu membandingkannya dengan setiap tabel di `schema.ts` (`getTableConfig`). Test gagal bila `schema.ts` mendeklarasikan tabel/kolom yang tidak dibuat migrasi, atau bila tipe kolom menyimpang. Diverifikasi menangkap dua arah: kolom `ghost_column` yang hanya ada di `schema.ts` → gagal; `resource_id` dikembalikan ke `uuid` (kondisi sebelum migrasi 0010) → gagal dengan `column audit_logs.resource_id is varchar(512) after the migrations but uuid in schema.ts`.
11. **Dead code produksi — SELESAI (2026-10-14)**. `AiCouncil` dan `SelfHealingEngine` punya test tetapi nol pemanggil di `apps/` maupun di paket lain, jadi keduanya **dihapus, bukan disambungkan**: subdirektori `council/` dan `healing/` di dalam paket `agent-core`, dua baris `export *` di `packages/agent-core/src/index.ts`, serta dua file test `council.test.ts` dan `self-healing.test.ts`. Test paket turun dari 40 menjadi 31 (9 test milik kedua modul itu), `tsc --build` tetap bersih, dan tidak ada satu pun importer yang tersisa.

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
| **Koneksi Windows Worker Terputus Saat Eksekusi**  | Sedang | Sedang       | **Sebagian dimitigasi 2026-10-13.** Jalur dispatch kini ada (lihat Butir 11), jadi perangkat yang terputus membuat task `failed` dengan `offlineReason: device_unreachable` alih-alih sukses palsu. **Identitas tidak lagi hilang saat API restart (2026-10-14)**: baris `devices` dan `public_key` tersimpan di Postgres, dan agent yang reconnect dengan key yang sama menerima `deviceId` yang sama, jadi tidak ada perangkat duplikat setelah restart. Sesi koneksi tetap **in-memory** (`apps/api/src/services/device-connection-manager.ts`), sehingga sampai agent reconnect semua perangkat tampak offline dan task yang sudah disetujui untuk perangkat offline langsung gagal dan harus dijalankan ulang. |
| **Exhaustion Disk Akibat Log atau Database**       | Rendah | Rendah       | Rotasi log Docker aktif (`/etc/docker/daemon.json`: `max-size 10m`, `max-file 3`). Retensi backup **14 hari** (`RETENTION_DAYS` default di `scripts/backup-postgres.sh:15`), bukan 7 hari seperti tertulis sebelumnya. Disk terpakai 42G/174G (25%). |
| **Kehilangan Memori Diam-diam**                    | Tinggi | **Rendah**   | **Dimitigasi 2026-10-13.** Tabel `memories` kini dibuat oleh migrasi `0007_memories.sql`, dan `DrizzleMemoryRepository` tidak lagi menelan kegagalan database, sehingga error terlihat alih-alih menjadi `201` palsu. Bukti live: create → restart API → data tetap ada. Sisa risiko: pencarian semantik tidak aktif (bukan kehilangan data) dan retensi tidak ditegakkan. |
| **Klaim Completion Palsu**                         | Tinggi | **Rendah**   | **Dimitigasi 2026-10-13.** Lingkungan coding mock `{passed:true}` dihapus dan diganti eksekusi nyata di workspace per task; `executeRegisteredTool` kini menjalankan `GenericEvaluator` sebelum menulis `completed` dan tidak melampirkan bukti bila tool tidak mengembalikan data; `ResearchAgent` tidak lagi punya daftar sumber/claim hardcoded, sehingga riset tanpa sumber nyata berakhir `failed`. Bukti live: check gagal → `failed` (`score 0.71`), check lulus → `completed` (`score 1`), riset tanpa hasil → `failed` (`score 0`), riset nyata → `completed` (`score 1`, 5 sumber). Sisa risiko: `GenericEvaluator` pada jalur tool memakai kriteria default dan belum memeriksa apakah output memenuhi permintaan pengguna; acceptance criteria belum dipersist sebelum eksekusi; klaim riset belum disintesis model sehingga relevansinya belum dinilai. |
| **Pencarian web bergantung pada markup pihak ketiga** | Sedang | Sedang       | `web_search` membaca HTML `html.duckduckgo.com` karena tidak ada API key yang tersedia. Selama pengujian live 2026-10-13 endpoint ini membalas `202` tanpa hasil untuk user agent yang memuat kata `bot`; UA kini dijaga bebas kata itu. Markup yang berubah **tidak** menghasilkan "0 hasil" palsu: `duckDuckGoSearch` melempar error, `ResearchAgent` mencatatnya sebagai limitation, dan task berakhir `failed`. `createWebSearchTool(provider)` menerima provider pengganti (mis. SearXNG self-host) tanpa mengubah `ResearchAgent`. |

---

## 7. Rencana Perbaikan Berurutan Prioritas

### Prioritas P0 (cacat fungsional, tidak memerlukan kredensial eksternal)

Diurutkan berdasarkan dampak terhadap kepercayaan pengguna. **Kedelapan butir P0 sudah selesai** (1–4 pada 2026-10-13, 5–6 pada 2026-10-13/2026-10-14, 7–8 pada 2026-10-14) dan dipertahankan di daftar ini sebagai catatan riwayat.

1. **Perbaiki pemulihan task — SELESAI (2026-10-13)**. `queue` kini diteruskan dan wajib; test regresi baru (`live-worker-execution.test.ts`) gagal bila queue tidak diteruskan; bukti live task `running` tanpa job → restart → `completed`.
2. **Buat memory persisten — SELESAI untuk persistensi (2026-10-13)**. Migrasi `0007_memories.sql` membuat tabel `memories` + `vector(1536)` + index, dan fallback diam-diam ke `InMemoryMemoryStore` dihapus. `:id` pada route memory kini divalidasi sebagai uuid, sehingga `GET`/`DELETE /v1/memories/search` menjawab `400`, bukan `500`. Sisa: provider embedding (9Router belum menyediakan; `No credentials for provider: openai`) dan sweeper retensi.
3. **Buat evaluator menilai bukti nyata — SELESAI (2026-10-13)**. `createDefaultEnvironment()` diganti `LocalCodingEnvironment` (perintah nyata, timeout, output terpotong) dan `executeRegisteredTool` digerbangi evaluator. Sisa yang belum selesai dari butir ini: acceptance criteria harus dipersist sebelum eksekusi agar evaluator menilai terhadap kriteria task, bukan kriteria default.
4. **Beri research jalur pencarian nyata — SELESAI (2026-10-13)**. Provider pencarian nyata (DuckDuckGo HTML, tanpa API key) terdaftar di `createDefaultToolRegistry` (`packages/tools/src/builtin/web-search.ts`, `packages/tools/src/registry/create-default-tool-registry.ts:20-21`); `LocalResearchEnvironment` mencari dan membuka halaman lewat `ToolRegistry` ber-permission; sumber dan claim hardcoded dihapus. Sisa yang belum selesai dari butir ini: sintesis klaim lintas sumber oleh `ModelGateway`, dan `ResearchEvaluator` belum mem-fetch URL untuk memverifikasi isi sitasi.
5. **Sambungkan dispatch perintah ke Windows Agent — SELESAI (2026-10-13 dispatch, 2026-10-14 identitas + allowlist)**. `dispatchCommand` terhubung ke jalur task dengan approval HIGH per perintah, verdict dari exit code perangkat, dan bukti live task → perangkat → hasil. Identitas perangkat kriptografis menyusul: `devices.public_key` diisi dari handshake bertanda tangan dan `deviceId` diterbitkan server (lihat butir 9). **Allowlist teks-perintah/biner SELESAI 2026-10-14**: parser lokal menolak program di luar allowlist (`COMMAND_NOT_ALLOWED`) beserta `;`/`&&`/`||`/`|`, subshell, `-EncodedCommand`, `Invoke-Expression`/`iex`, shell wrapper, dan program bernama path; dikonfigurasi lewat capability registry yang sama (lihat Butir 11). Sisa dari butir ini: sesi perangkat in-memory sehingga hilang saat API restart.
6. **Perbaiki notifikasi dan FCM — SELESAI (2026-10-14)**. `NotificationEngine` di API memakai `SqlNotificationRepository`, dan `fcm-provider.ts` memperoleh access token OAuth2 nyata dari service account (`ServiceAccountTokenSource`, JWT RS256 → `token_uri`). Literal `dummy-env-token` dihapus; service account tak lengkap → `DisabledFcmProvider`. Bukti live di §8.E "Cacat 6". Sisa: pengiriman ke Google belum pernah terjadi (Gap 2), dan push yang gagal `maxAttempts` tidak masuk dead-letter queue.
7. **Perluas audit — SELESAI (2026-10-14)**. Tool call, MCP call, browser action, dan artifact write kini menulis baris `audit_logs` (bukan hanya keputusan approval). `SecuredCapabilityGuard` menulis satu baris per pemanggilan setelah hasil diketahui; artifact lewat `ArtifactManager.auditSink`; `resource_id` menjadi `varchar(512)` (migrasi `0010_audit_resource_id_text.sql`). Bukti live di §8.E "Cacat 5".
8. **Tambahkan pemeriksaan paritas schema ↔ migrasi — SELESAI (2026-10-14)**. `apps/api/test/schema-parity.test.ts` membuat database sementara, menerapkan seluruh migrasi dari nol, dan membandingkan tabel/kolom/tipe hasilnya dengan `schema.ts`; test itu bagian dari suite API (`node --test test/*.test.ts`), jadi berjalan di CI setelah langkah `sh scripts/migrate-db.sh`. Bukti negatif: kolom hantu di `schema.ts` dan `resource_id` yang dikembalikan ke `uuid` keduanya menggagalkan test.

### Prioritas P1 (kebersihan dan pengerasan)

1. **Hapus atau sambungkan dead code — SELESAI (2026-10-14)**. Diputuskan **dibuang**, bukan disambungkan: `AiCouncil` dan `SelfHealingEngine` tidak dipanggil dari `apps/`, dan menyambungkannya berarti menambah subsistem yang tidak diminta. Subdirektori `council/` dan `healing/` di dalam paket `agent-core` dihapus bersama dua baris `export *` di `packages/agent-core/src/index.ts` dan kedua file test-nya. Test paket turun 40 → 31.
2. **Streaming upload artifact — SELESAI (2026-10-14)**. Route baru `POST /v1/artifacts/stream` menerima byte mentah (`application/octet-stream`, parser khusus supaya Fastify tidak membuffer) dengan `filename`/`mimeType` sebagai query parameter dan batas 25 MiB, lalu mengalirkannya ke `storage.putStream` (tulis ke file temporer + `rename`). Route JSON lama tetap ada untuk klien kecil. Validasi MIME kini membandingkan **magic bytes** isi unggahan dengan tipe yang dideklarasikan (`magic-bytes.ts`; PNG/JPEG/GIF/WebP/PDF/ZIP + fallback teks/JSON) dan menolak ketidakcocokan dengan `InvalidMimeTypeError`; `GET /v1/artifacts/:id/download` kini memakai `getArtifactStream` sehingga unduhan juga tidak dibuffer. Bukti: `packages/tools/test/artifacts.test.ts` dan `apps/api/test/artifacts.test.ts`, ditambah unggahan 2 MiB live ke API produksi (sha256 unduhan cocok).
3. **Sweeper retention — SELESAI (2026-10-14) untuk artifact**. `apps/api/src/services/artifact-retention-sweeper.ts` menghapus artifact sesuai enum `ArtifactRetention`: `ephemeral` setelah TTL (`ARTIFACT_EPHEMERAL_TTL_MS`, default 24 jam), `task_duration` begitu task-nya terminal atau barisnya hilang, `project_lifetime` begitu project-nya hilang, `permanent` tidak pernah. Sweep berjalan periodik di proses API (`ARTIFACT_RETENTION_SWEEP_INTERVAL_MS`; kosong/0 = mati) dan memakai `ArtifactManager.listAllArtifacts()`. Bukti live: artifact `ephemeral` → `404` pada poll ketiga, `permanent` tetap `200`. **Sisa**: retensi memori (`memories.retention`) belum punya sweeper; enum-nya (`ephemeral`/`session`/`30d`/`90d`/`permanent`) belum dipetakan ke penghapusan.
4. **Rate limit dan timeout pada jalur tool — SELESAI (2026-10-14)**. Timeout per tool sudah ada (`tool-registry.ts` menegakkan `tool.timeoutMs`), dan `registerTool` kini menormalkan nilai tak finit ke default 30 dtk sehingga setiap tool terdaftar punya batas. Batas laju/konkurensi baru (`ExecutionLimiter`, `packages/tools/src/execution-limiter.ts`) ditegakkan di dalam `ToolRegistry.executeTool` — jadi berlaku untuk tool bawaan maupun tool hasil registrasi MCP (`mcp_<server>_<tool>`) — dan di `RuntimeManager.execute` untuk jalur bridge runtime yang sebelumnya melewati registry. Pemanggilan melebihi batas gagal cepat dengan `ExecutionLimitExceededError` (tanpa antrean). Bukti: `packages/tools/test/execution-limiter.test.ts` (5 test), `packages/mcp/test/registry-limits.test.ts` (tool MCP nyata lewat `echo-server.mjs`), `packages/agent-core/test/runtime-limits.test.ts` (2 test). Knob: `TOOL_MAX_IN_FLIGHT`, `TOOL_MAX_STARTS_PER_MINUTE`, `RUNTIME_MAX_IN_FLIGHT`, `RUNTIME_MAX_STARTS_PER_MINUTE` (`.env.example`).

### Prioritas P2 (operasional dan peningkatan)

1. **Konfigurasi FCM Push Notification Live** — menempatkan service account key pada direktori terisolasi server dan menetapkan `FCM_SERVICE_ACCOUNT_JSON`. Jalur kode sudah siap (P0 nomor 6 selesai); yang kurang hanya kredensial Google itu sendiri, dan tanpa kredensial provider aktif adalah `DisabledFcmProvider` yang jujur.
2. **Restore drill terjadwal** — prosedur pemulihan sudah lulus sekali terhadap arsip nyata, tetapi belum dijalankan sebagai rutinitas berkala.
3. **Integrasi OpenTelemetry Collector Eksternal** — menghubungkan `/metrics` di `apps/api/src/app.ts` ke Prometheus/Grafana untuk pemantauan jangka panjang dan alerting.
4. **Pengujian adapter runtime tambahan — DIKOREKSI 2026-10-14**. Klaim lama ("Hermes dan OpenHands masih `UnverifiedRuntimeAdapter`") hanya benar untuk OpenHands. Jalur produksi runtime adalah `RemoteRuntimeAdapter` (`packages/agent-core/src/runtimes/remote-adapter.ts`) → HTTP → `apps/runtime-bridge` (unit systemd di host) → binary host, dengan `RuntimeId = 'omp' | 'hermes'` (`apps/runtime-bridge/src/index.ts:10`); keduanya **sudah terverifikasi live** (`docs/verification/runtimes-live.md`: OMP 18.6.1 mode JSONL, Hermes 0.20.5 `-z`). Adapter stub `UnverifiedRuntimeAdapter`/`HermesRuntimeAdapter`/`OpenHandsRuntimeAdapter` **dihapus 2026-10-14** karena nol pemanggil produksi dan menyesatkan. Yang benar-benar belum ada hanya OpenHands: tanpa adapter, tanpa entri bridge, tanpa slot allowlist.
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
@personal-ai-os/tools          44/44
@personal-ai-os/mcp            18/18
@personal-ai-os/agent-worker   43/43
@personal-ai-os/memory          7/7
@personal-ai-os/permissions     6/6
@personal-ai-os/agent-core     33/33
@personal-ai-os/evaluator       9/9
API (in-container)             66/66, 0 skipped
scheduler (in-container)       25/25, 0 skipped
android                        19/19
windows                        35 tests, 31 lulus, 4 skipped (eksekusi PowerShell butuh Windows)
```

Angka di atas adalah keadaan setelah M9–M14 (2026-10-14). Perubahan dari revisi sebelumnya: `agent-core` 40 → 33 (9 test `council`/`self-healing` hilang bersama dead code-nya, 2 test batas runtime bertambah), `tools` 35 → 44, `mcp` 17 → 18, `agent-worker` 39 → 43, `windows` 18/22 → 35 test, API 63 → 66.

Suite API dijalankan di dalam image `personal-ai-os-api:latest`; image `node:22-bookworm-slim` polos gagal satu test karena tidak memiliki `git`, yang dibutuhkan `prepareWorkspace`.

### D. Verifikasi Referensi Path Dokumen (`pnpm verify:audit`)

```text
[Verify Audit Refs] Memeriksa 204 referensi path dari docs/final-audit.md...
[Verify Audit Refs] Berhasil memverifikasi 122 path unik yang valid.
[SUKSES] Semua referensi path file dalam docs/final-audit.md 100% valid dan ada di filesystem.
```

### E. Bukti live produksi (2026-10-13, dilanjutkan 2026-10-14)

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
# Cacat 4 (DIPERBAIKI 2026-10-13): research tanpa jalur pencarian
# Sebelum: ResearchAgent tanpa env memakai 2 sumber hardcoded (developer.mozilla.org,
#          nodejs.org) dan 3 claim hardcoded; ResearchEvaluator lulus tanpa satu pun fetch nyata.
# Sesudah, query nyata (task 46098f3e-4cd6-4958-b94e-b2bf30ea283e, "durable execution in PostgreSQL"):
#   POST /v1/tasks {kind:"research_task", payload:{query:"durable execution in PostgreSQL"}}
#   -> completed, progress 100, evaluationResult.passed=true, score=1
#      "5 sources analyzed. Average credibility score: 0.74."
#      "5 factual claims mapped to 5 sources without unlinked claims."
#      artifact-research-report-... memuat 5 URL nyata (temporal.io, learn.microsoft.com x2, github.com x2)
#      limitation: "Klaim fakta adalah kutipan awal halaman yang benar-benar diambil dan tidak disintesis lintas sumber."
# Sesudah, query tanpa hasil (task c38ae271-1237-4d58-8ff2-6cf27927be00):
#   -> failed, score=0, "Research completion blocked: No valid sources provided."
#      limitation mencatat: "1 pencarian gagal: ... membalas HTTP 200 tanpa markup hasil yang dikenal."
# Sumber tunggal ditolak (task 597838e9-304e-4aec-8c0a-ed62f679011e): failed, score=0.8,
#   cross_check gagal karena hanya 1 sumber dapat dibaca; 4 URL yang gagal dibaca disebut namanya.

# Cacat 5 (DIPERBAIKI 2026-10-14): audit hanya approval
# Sebelum: SELECT action, count(*) FROM audit_logs GROUP BY action;
#            approval:denied   | 5
#            approval:approved | 5
#          (10 baris; tool call, MCP call, browser action, dan artifact write tidak ada)
# Sesudah: migrasi 0010_audit_resource_id_text.sql diterapkan ke DB produksi
#          (ALTER TABLE audit_logs ALTER COLUMN resource_id TYPE varchar(512) USING resource_id::text),
#          karena tool call menulis path/URL/nama tool dan kolom uuid melempar 22P02.
#          SELECT action, resource_type, count(*), ... FROM audit_logs GROUP BY action, resource_type;
#            web:fetch             | global       | 13 | success 10 | failure 3
#            approval:denied       | git          |  3
#            approval:approved     | device       |  3
#            tool:search_knowledge | workspace    |  3 | success 3
#            web:search            | global       |  3 | success 3
#            approval:approved     | git          |  2
#            approval:approved     | external_mcp |  2
#            tool:mcp_echo_echo    | external_mcp |  2 | success 1 | failure 1
#            artifact:write        | artifact     |  2
#            browser:navigate      | global       |  1 | success 1
#            (total 38 baris; keputusan approval lama tetap ada)
# Artifact write: POST /v1/artifacts {filename:"audit-smoke.txt", mimeType:"text/plain"} -> 201
#   -> baris artifact:write | artifact | 65f45807-9fda-4bb4-a57d-848b49ebc3b9 | allow
#   -> baris kedua untuk screenshot browser 627093d6-089d-4cb8-8fe4-620611b6750d
# Tool call (research nyata, task 242fe26e-a8f7-4ec4-9d57-18d3bb350217, query "postgres advisory locks") -> completed:
#   -> 3 baris web:search | global | web_search | allow | success
#   -> 11 baris web:fetch | global | <URL nyata> | allow | success   (resource_id = URL, bukan uuid)
# Browser action (task 9627db03-22bd-4fd3-947a-06ca2d4ba415, browser_navigate https://example.com) -> completed:
#   -> browser:navigate | global | https://example.com | allow | success | durationMs 1324
#   -> artifact:write untuk screenshot PNG 627093d6-089d-4cb8-8fe4-620611b6750d
# MCP call (task b351d773-dd40-4424-9159-98b08df33430, mcp_echo_echo) -> waiting_approval:
#   -> tool:mcp_echo_echo | external_mcp | mcp_echo_echo | require_approval | failure | error "approval_required"
#   POST /v1/approvals/53036637-…/approve -> 200 -> completed:
#   -> tool:mcp_echo_echo | external_mcp | mcp_echo_echo | require_approval | success | durationMs 2
#   (jalur guard yang sama; audit MCP tidak lagi hanya console.log)
# Hasil nyata tercatat, bukan hanya keputusan evaluasi (task b2a34028-1ee7-4bf2-84f4-c380261e280b, web_fetch SSRF):
#   -> web:fetch | global | http://169.254.169.254/latest/meta-data/ | allow | failure | durationMs 0
#      error "SSRF Protection: Permintaan ke 'http://169.254.169.254/latest/meta-data…"
# Setiap baris memuat user_id (aktor), action, resource_type, resource_id, decision, trace_id,
# dan metadata {riskLevel, reason, evaluationId, outcome, durationMs, error}.

# Cacat 6 (DIPERBAIKI 2026-10-14): notifikasi belum pernah terkirim
# Sebelum: NotificationEngine di API tanpa storage; SELECT count(*) FROM notifications -> 0;
#          fcm-provider.ts menyuntikkan accessToken:'dummy-env-token' saat kredensial ada.
# Sesudah: migrasi 0009_device_push_token.sql (ALTER TABLE devices ADD push_token + unique parsial
#          devices_push_token_uq WHERE push_token IS NOT NULL) diterapkan ke DB produksi.
# Task terjadwal (kind smoke.echo, task 100d45a2-726c-4586-b9ca-5a32ff0f0718) -> completed:
#   SELECT id, type, delivery_state, deep_link FROM notifications;
#    53153b18-… | task_completed | delivered | personal-ai://tasks/100d45a2-…
#   GET /v1/notifications -> 200, 1 baris, deliveryState 'delivered', maxAttempts 3
#   POST /v1/notifications/53153b18-…/read -> 200, deliveryState 'read' + readAt
#   GET/PUT /v1/notifications/preferences -> 200, dan nilainya sama setelah
#     docker compose restart api (PREFS_AFTER_RESTART identik)
# Device push token (device 8d6eab52-f367-419c-80d8-51b876e3127a, "Proof Android"):
#   POST /v1/devices -> 201; POST /v1/devices/<id>/push-token {pushToken:"proof-fcm-token-…"} -> 204
#   POST dengan body pushToken kosong -> 400; devices.push_token terisi di DB
# Task gagal (kind windows_command, targetDevice offline, task d21ee40d-…):
#   task status failed; baris notifikasi cf9c9e48-… | task_failed | failed | attempts 1
#   last_error "Pengiriman dinonaktifkan: FCM_SERVICE_ACCOUNT_JSON tidak dikonfigurasi…"
#   deep_link personal-ai://tasks/d21ee40d-…  (kegagalan push dilaporkan jujur, bukan delivered)
# Event approval lewat Redis (channel nyata personal-ai-os:events:all, 1 receiver):
#   publish {eventType:"task.waiting_approval", payload:{approvalId:"appr-proof-1"}}
#   -> baris approval_required | failed | deep_link personal-ai://approvals/appr-proof-1
# Setelah restart API: GET /v1/notifications -> 2 baris (task_failed:failed, task_completed:read)
# Catatan: FCM_SERVICE_ACCOUNT_JSON belum diisi di produksi, jadi provider aktif adalah
#          DisabledFcmProvider dengan log "[FCM] Peringatan: … dinonaktifkan (bukan mock)".
#          Alur OAuth nyata diuji terhadap stub HTTP server: apps/scheduler/test/fcm-provider.test.ts (4/4).

# Cacat 7 (DIPERBAIKI 2026-10-13): tidak ada jalur dispatch perintah ke Windows Agent
# Sebelum: agent Windows palsu terhubung ke ws://.../v1/agent/ws?deviceId=win-smoke-m5
#   -> API mati: PostgresError: invalid input syntax for type uuid: "win-smoke-m5"
#      (apps/api/src/db/device-repository.ts updateLastSeen -> devices.id bertipe uuid)
#   POST /v1/tasks -> 502 (proses API sudah tidak ada)
# Sesudah (task 954db21a-b14f-44ad-b2c2-49b4a2e99d55):
#   POST /v1/tasks {kind:"windows_command", payload:{targetDevice:"win-smoke-m5", command:"hostname"}} -> 201
#   -> task.waiting_approval {action:"device:command", deviceId:"win-smoke-m5", riskLevel:"HIGH",
#                             fingerprint:"e7267d41…"}   (progress 50)
#   POST /v1/approvals/9de2a024-…/approve -> 200
#   -> perangkat menerima {"type":"command.execute","commandId":"71092194-…","command":"hostname","timeoutMs":60000}
#   -> task.resumed {action:"approval_granted"}
#   -> task.completed {exitCode:0, deviceId:"win-smoke-m5",
#                      artifacts:[{id:"artifact-device-954db21a-…", type:"device_command_output",
#                      content:{stdout:"SMOKE-WORKSTATION", stderr:"", truncated:false, durationMs:11}}]}
#   GET /v1/devices -> {"devices":[{"id":"win-smoke-m5","platform":"windows","isOnline":true}]}
#     (bentuk dari baris terdaftar + presence dari sesi online; sebelum perbaikan route ini hanya
#      membaca baris tabel devices, lalu sempat membaca hanya sesi online)
# Perangkat offline (targetDevice:"win-smoke-absent"):
#   -> failed, error: Windows Agent "win-smoke-absent" sedang offline: perangkat tidak terhubung…
#   -> task.failed {offlineReason:"device_unreachable", deviceId:"win-smoke-absent"}   (bukan sukses palsu)
# Cacat ikutan (task 88386a0c-3696-4815-aee3-a947e482c20e) sebelum perbaikan state machine:
#   job BullMQ gagal dengan IllegalTaskStateTransitionError: from 'queued' to 'failed'
#   (apps/agent-worker/src/task-executor.ts:192) -> task tertinggal queued selamanya tanpa error terlihat.
#   Sesudah: transisi melewati planning, dan test device-dispatch kini memakai TaskStateMachine asli
#   sehingga fake repo tidak bisa lagi menyembunyikan pelanggaran transisi.
# Cacat 8 (DIPERBAIKI 2026-10-14): identitas perangkat tidak kriptografis
# Sebelum: agent memilih sendiri id lewat query string, dan devices.public_key tidak pernah diisi.
# Sesudah (agent palsu menandatangani challenge dengan keypair P-256 nyata, seperti agent asli):
#   ws://127.0.0.1:8080/v1/agent/ws?token=…&deviceId=win-smoke-legacy
#     -> device.error {code:"DEVICE_IDENTITY_REQUIRED", message:"This server issues device ids
#        itself; connect without deviceId and answer the signed challenge"}
#   ws://127.0.0.1:8080/v1/agent/ws?token=… (tanpa deviceId)
#     -> device.challenge {challenge:"device-handshake:…"} (32 byte acak)
#     -> device.handshake {publicKey:{kty:"EC",crv:"P-256",x,y}, signature:"<raw r||s base64>",
#                          name:"Signed Workstation", platform:"windows"}
#     -> device.handshake_ack {deviceId:"4067f93f-4c57-42c9-bcd5-310f968adb7a", status:"connected"}
#   SELECT id, public_key FROM devices:
#     4067f93f-… | {"crv":"P-256","kty":"EC","x":"Ov8WtYYp1vr45brzT4TcbqtT8WPMF…"}  (126 byte)
#   Reconnect dengan keypair yang sama -> deviceId identik, socket lama ditutup server:
#     RECONNECT_SAME_KEY true 4067f93f-… ; STALE_SOCKET_CLOSED true
#   Task lewat id terbitan server (task 6a823bb3-b815-450e-ae72-75d80c9ec47d):
#     POST /v1/tasks {kind:"windows_command", payload:{targetDevice:"4067f93f-…", command:"hostname"}} -> 201
#     -> task.waiting_approval {action:"device:command", deviceId:"4067f93f-…", riskLevel:"HIGH"} -> approve 200
#     -> perangkat menerima {"type":"command.execute","command":"hostname"} -> task.completed {exitCode:0,
#        stdout:"SMOKE-WORKSTATION-SIGNED"}   (dispatch M4 tidak teregresi)
#   Index: devices_public_key_uq UNIQUE, btree (public_key) WHERE public_key IS NOT NULL
#
# Cacat 9 (DIPERBAIKI 2026-10-14): tidak ada pemeriksaan paritas schema <-> migrasi
# Sebelum: `memories` dideklarasikan di schema.ts tanpa satu pun CREATE TABLE di migrasi 0000-0006,
#          dan tabel `artifacts` ada di schema.ts tanpa migrasi; keduanya hanya ketahuan dari audit manual.
# Sesudah: apps/api/test/schema-parity.test.ts membuat database sementara, menerapkan seluruh
#          apps/api/src/db/migrations/*.sql dari nol, mengintrospeksi public schema
#          (pg_class/pg_attribute + format_type(atttypid, atttypmod)), lalu membandingkannya
#          dengan setiap tabel di schema.ts lewat getTableConfig(); database sementara selalu di-drop.
#          node --test test/schema-parity.test.ts -> ok 1 (916 ms), suite API 63/63.
# Bukti test itu benar-benar bisa gagal (dua arah, masing-masing dijalankan terpisah):
#   schema.ts users + ghostColumn: varchar('ghost_column', {length:10})
#     -> not ok: 'column users.ghost_column is declared in schema.ts but no migration creates it'
#   schema.ts audit_logs.resourceId dikembalikan ke uuid('resource_id') (kondisi sebelum 0010)
#     -> not ok: 'column audit_logs.resource_id is varchar(512) after the migrations but uuid in schema.ts'
#   Keduanya dijalankan lewat image personal-ai-os-api:latest pada network Docker internal;
#   setelah selesai tidak ada database sisa (SELECT datname FROM pg_database WHERE datname LIKE 'schema_parity%' -> 0 baris).
```

### F. Bukti live M9–M14 (2026-10-14)

Semua dijalankan terhadap produksi yang sedang berjalan (`docker compose`, image dibangun ulang dari working tree). Skrip bukti ada di `/tmp` host dan disalin ke dalam container.

```text
# Cacat 10 (DIPERBAIKI 2026-10-14): dead code produksi
# Sebelum: AiCouncil + SelfHealingEngine + 2 file test, nol pemanggil di apps/.
# Sesudah: subdirektori council/ dan healing/ dihapus, dua baris export * dibuang dari
#          packages/agent-core/src/index.ts; grep lima nama kelas adapter lama -> 0 match;
#          agent-core 40 -> 33 test; npx tsc --build --force -> exit 0.
#          Adapter runtime palsu (UnverifiedRuntimeAdapter/HermesRuntimeAdapter/OpenHandsRuntimeAdapter)
#          juga dihapus: Hermes sudah nyata lewat apps/runtime-bridge, jadi stub itu menyesatkan.
#
# Cacat 11 (DIPERBAIKI 2026-10-14): batas laju/konkurensi jalur tool
# Dijalankan di dalam container worker, memakai bundle dist yang benar-benar dikirim:
#   docker exec -e TOOL_MAX_IN_FLIGHT=1 -e TOOL_MAX_STARTS_PER_MINUTE=2 personal-ai-os-worker-1 \
#     node /tmp/live-limits.mjs
#   concurrent same tool -> ExecutionLimitExceededError(in_flight) | body invocations = 1
#   other tool -> allowed
#   after 2 starts -> ExecutionLimitExceededError(starts_per_interval)
#   unknown runtime -> {"status":"failed","untrusted":true}
# MCP mewarisi batas yang sama (server stdio nyata, tool mcp_echo_echo):
#   registered: mcp_echo_echo, mcp_echo_boom
#   second concurrent MCP call -> ExecutionLimitExceededError(in_flight, key=mcp_echo_echo)
#   first MCP call -> success {"content":"<untrusted_content source=\"mcp:echo/echo\" is_instruction=\"false\">…
#
# Cacat 12 (DIPERBAIKI 2026-10-14): healthcheck worker tidak memprobe apa pun
# Sebelum: file /tmp/healthy disentuh pada timer; Redis mati pun worker tetap "healthy".
# Sesudah: docker compose stop redis; 75 detik -> health=healthy (file masih segar);
#          195 detik -> health=unhealthy running=true restarts=0, dan
#          16 log {"event":"healthcheck_failed","error":"Reached the max retries per request limit…"}
#          docker compose start redis; 60 detik -> health=healthy, restarts=0 (worker tidak keluar).
#
# Cacat 13 (DIPERBAIKI 2026-10-14): upload artifact tidak streaming, MIME dari deklarasi klien,
#                                   retention tanpa sweeper
# Upload 2 MiB byte mentah lewat POST /v1/artifacts/stream (di dalam container API; tepi publik
# Caddy/nginx menolak body besar lebih dulu, 413):
#   upload status = 201 declared size = 2097152 stored size = 2097152
#   download status = 200 bytes = 2097152 sha256 match = true
# Magic bytes menolak deklarasi yang bertentangan dengan isi:
#   real.png as image/png     -> 201 id=903d1674-5e8a-4b4f-ae90-53bae708aa56
#   liar.txt as text/plain    -> 400 Tipe MIME 'text/plain' tidak diizinkan dalam kebijakan penyimpanan artefak.
#   garbage.png as image/png  -> 400 Tipe MIME 'image/png' tidak diizinkan dalam kebijakan penyimpanan artefak.
# Sweeper retention (ARTIFACT_RETENTION_SWEEP_INTERVAL_MS=2000, ARTIFACT_EPHEMERAL_TTL_MS=3000):
#   created ephemeral 7f987204-2be7-4c3a-805b-6df7af828607 permanent c2b32682-55c6-4d4c-a33d-0a707399eca4
#   poll 1 ephemeral 200 permanent 200
#   poll 2 ephemeral 200 permanent 200
#   poll 3 ephemeral 404 permanent 200
#   poll 4 ephemeral 404 permanent 200
#   poll 5 ephemeral 404 permanent 200
#
# Cacat 14 (DIPERBAIKI 2026-10-14): approval perangkat terbakar saat agent reconnect
# Sebelum: sesi device in-memory; API restart membuat agent tampak offline, dispatch gagal seketika,
#          dan approval yang baru diberikan harus diulang.
# Sesudah (agent palsu dengan keypair P-256 nyata, dispatch lewat route internal ber-token):
#   handshake ok, deviceId = b79ab6bd-aaa4-4abb-8532-c5e48119a4ea
#   [socket ditutup, lalu dispatch dikirim saat tidak ada sesi]
#   reconnected, same deviceId = true b79ab6bd-aaa4-4abb-8532-c5e48119a4ea
#   received frame: {"type":"command.execute","commandId":"b15f7bd4-…","command":"hostname","timeoutMs":10000}
#   dispatch status = 200 stdout = "AFTER-RECONNECT\r\n"
# Kontrol negatif dengan DEVICE_RECONNECT_GRACE_MS=0 (API di-restart ulang, env dikembalikan sesudahnya):
#   status = 404 elapsedMs = 13
#   {"error":{"code":"DEVICE_OFFLINE","message":"Device \"b55ae55b-…\" is offline or unreachable"}}
#
# Cacat 15 (DIPERBAIKI 2026-10-14, tanpa bukti perangkat): allowlist teks-perintah Windows
#   apps/windows/test/command-allowlist.test.ts 13 test lulus; suite paket 35 test, 31 lulus, 4 skip;
#   cargo test --offline di apps/windows/src-tauri -> 5 test lulus.
#   BATAS BUKTI: tidak ada perangkat Windows di lingkungan ini, jadi jalur nyata (hardware) belum
#   pernah dijalankan untuk allowlist ini.
#
# Cacat 16 (DIPERBAIKI 2026-10-14): tidak ada login terfederasi — user harus menempel JWT manual
# Sebelum: satu-satunya cara masuk adalah POST /v1/auth/login (email+sandi) atau /v1/auth/register,
#          lalu access token ditempel manual di Settings Windows Agent. Access token berumur 900
#          detik, jadi pemakaian normal berarti menempel ulang terus-menerus.
# Sesudah: Authorization Code + PKCE dengan penukaran token di server
#   (apps/api/src/auth/google.ts, apps/api/src/auth/service.ts, apps/api/src/app.ts):
#     GET  /v1/auth/google/start?redirect_uri&code_challenge&state -> 302 ke Google
#     GET  /v1/auth/google/callback  -> verifikasi id_token ke JWKS Google (issuer, audience,
#          email_verified) -> 302 balik ke redirect_uri dengan login code 60 detik + state klien
#     POST /v1/auth/exchange {code, codeVerifier} -> {accessToken, refreshToken, user}
#   Migrasi 0011_user_identities.sql menambah tabel user_identities dan membuat
#   users.password_hash nullable (akun yang hanya lewat provider tidak punya sandi).
# Bukti live terhadap API produksi (image baru, kredensial Google dummy di container sementara,
# tidak ada permintaan ke Google karena kode otorisasi palsu):
#   tanpa kredensial -> 503 {"code":"NOT_CONFIGURED"}
#   dengan kredensial:
#     start personal-ai://auth            -> 302, location =
#       https://accounts.google.com/o/oauth2/v2/auth?client_id=…&redirect_uri=https%3A%2F%2Fai.ojixx.my.id%2Fv1%2Fauth%2Fgoogle%2Fcallback
#       &response_type=code&scope=openid+email&state=<JWT HS256>&code_challenge=<S256>&code_challenge_method=S256
#       (code_challenge di state BERBEDA dari code_challenge klien — server punya leg PKCE sendiri)
#     start https://evil.example/x           -> 400 INVALID_REDIRECT_URI
#     start http://127.0.0.1:51000/auth      -> 302 (loopback agent Windows)
#     callback state palsu                   -> 400 INVALID_OAUTH_STATE
#     callback code Google palsu             -> 401 GOOGLE_EXCHANGE_FAILED (Google menolak kode itu)
#     POST /v1/auth/exchange kode sampah     -> 400 INVALID_LOGIN_CODE
# Suite: apps/api/test/auth-google.test.ts 4 test lulus (round trip penuh -> /v1/me, satu identitas
#   = satu user lokal, redirect di luar allowlist ditolak, deployment tanpa kredensial 503);
#   apps/api suite penuh 70 test lulus; test/schema-parity.test.ts lulus setelah migrasi 0011.
#   apps/android/test/pkce.test.ts (26 test paket android) memverifikasi S256 terhadap vektor
#   RFC 7636 lampiran B dan base64url terhadap Buffer.toString('base64url') untuk tiap panjang 0..40;
#   apps/windows/test/google-auth.test.ts 4 test lulus; suite windows 39 test, 35 lulus, 4 skip.
# Bukti end-to-end dengan akun Google sungguhan (2026-10-14, produksi ai.ojixx.my.id):
#   Login dijalankan di browser nyata terhadap client OAuth asli
#   (905088938174-k5ln7231shdd1h30dnccjmjunelocq88.apps.googleusercontent.com).
#   start -> 302 accounts.google.com -> consent -> Google mengembalikan ke callback dengan kode
#   otorisasi asli -> callback -> 302 http://127.0.0.1:51234/auth?code=<login code>&state=verify2
#   POST /v1/auth/exchange {code, codeVerifier} -> 200 dalam 18 ms
#     user.id = 60fed462-3efb-4767-8431-3fe096f5f2dc, email = rizkyfauzi132@gmail.com
#     accessToken 233 byte, refreshToken 43 byte
#   GET /v1/me dengan accessToken itu -> 200 {"user":{"id":"60fed462-…","email":"rizkyfauzi132@gmail.com"}}
#   POST /v1/auth/refresh -> 200, accessToken berbeda, refresh token dirotasi, token baru juga 200 di /v1/me
#   Token yang sama juga dipakai ke permukaan produksi lain: /v1/models 200 ("source":"live"),
#   /v1/tasks 200, /v1/devices 200, /v1/memories 200 — jadi sesi hasil login Google benar-benar
#   diterima di seluruh API, bukan hanya di /v1/me.
#   DB: user_identities berisi (user_id 60fed462-…, provider google, subject 103900276835349006686,
#       email rizkyfauzi132@gmail.com); satu baris, satu identitas.
#   Kontrol negatif pada jalur yang sama:
#     codeVerifier salah -> 400 INVALID_LOGIN_CODE ("login code does not match this device")
#     /v1/me tanpa Authorization -> 401; dengan "Bearer not.a.token" -> 401
#   Catatan: akun ini sudah ada sejak 2026-10-12 dengan password_hash terisi, dan login Google
#   memakai ulang user id yang sama (password_hash tetap ada). Ini memang desain yang dipilih —
#   email terverifikasi Google jadi anchor identitas — tapi konsekuensinya: siapa pun yang
#   menguasai akun Google dengan email itu otomatis mendapat akun lokal yang sudah ada, termasuk
#   yang punya sandi. Kalau nanti ada alur verifikasi email sendiri, urutannya perlu ditinjau.
#   Observasi, bukan cacat: login code 60 detik itu bisa ditukar lebih dari sekali dalam masa
#   berlakunya (replay menghasilkan 200 lagi). Dampaknya kecil karena penukaran tetap menuntut
#   codeVerifier PKCE yang hanya dipegang klien, tapi single-use akan lebih ketat; itu menuntut
#   penyimpanan state yang sengaja dihindari (state saat ini ditandatangani, bukan disimpan).
```

