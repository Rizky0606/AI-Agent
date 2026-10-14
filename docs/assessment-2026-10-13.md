# Assessment repository — Personal AI OS

Tanggal: 2026-10-13 (Asia/Jakarta).
Branch: `release/installers`, HEAD `e67bae7`.
Metode: audit read-only terhadap checkout, database produksi live, dan container produksi. Setiap klaim di bawah memiliki `path:line` atau output perintah yang dapat diulang. Tidak ada kode aplikasi yang diubah.

Dokumen ini menggantikan `docs/assessment.md` (2026-10-09) yang ditulis ketika checkout masih hampir kosong. Dokumen lama tidak dihapus.

---

## 1. Ringkasan eksekutif

Platform ini jauh lebih matang daripada `docs/assessment.md`. Auth, task durable, queue, event realtime, approval, browser automation, MCP stdio, artifact storage, backup harian, dan isolasi jaringan **bekerja dan terverifikasi live**.

Namun `docs/final-audit.md` menyatakan **LULUS** pada beberapa butir yang secara faktual tidak lulus. Empat yang paling serius, semuanya direproduksi langsung pada produksi hari ini:

| # | Klaim dokumen | Kenyataan | Bukti |
|---|---|---|---|
| 1 | Butir 5 "Memory/Context punya scope/retensi" **LULUS** | Memori hilang setiap restart API. Tabel `memories` tidak ada di database. | `POST /v1/memories` → 201, `count=1`; `docker compose restart api` → `count=0`. `psql: relation "memories" does not exist`. 18 tabel di produksi, `memories` bukan salah satunya. |
| 2 | Butir 3 "Background task pulih setelah worker restart" **LULUS** | Task `running` yang pulih **tidak pernah di-enqueue ulang**. Menggantung permanen. | Task dipaksa `running/progress=40` → `docker compose restart worker` → log `{"action":"recovery","recoveredCount":1}` + event `task.resumed` → 40 detik kemudian masih `running/progress=40`, tidak ada job. Akar: `recoverInterruptedTasks()` dipanggil tanpa queue. |
| 3 | Butir 7 "Coding dan Research menghasilkan bukti" **LULUS** | Evaluator tidak pernah menjalankan lint/typecheck/test/build. Research tidak punya search. | `packages/agent-core/src/coding/coding-agent.ts:414-438` mengembalikan `passed: true` hardcoded; worker memakai default env itu (`apps/agent-worker/src/task-executor.ts:134`). `web_search` tidak terdaftar di registry mana pun. |
| 4 | Butir 11 "Windows Agent capability-limited" **LULUS** | Device connect dan handshake jalan, tapi **tidak ada kode yang mengirim perintah dari task ke device**. **DIPERBAIKI 2026-10-13** (lihat M4 di §6): jalur task → perangkat → hasil kini ada dan dibuktikan live. | Sebelum: `dispatchCommand` (`apps/api/src/services/device-connection-manager.ts:174`) punya nol pemanggil di `apps/`. Sesudah: task `954db21a-…` → `waiting_approval` → approve → perangkat menerima `command.execute` → `completed` (`exitCode 0`). |

Selain itu: notifikasi belum pernah terkirim sekali pun (`notifications` = 0 baris), `AI Council` dan `SelfHealingEngine` adalah dead code produksi (nol pemanggil di `apps/`), dan `audit_logs` hanya berisi keputusan approval.

Konsekuensi: **setiap keputusan arsitektur berikutnya tidak boleh dibangun di atas `docs/final-audit.md` sampai klaim di dalamnya dikoreksi.** Itulah pekerjaan pertama.

---

## 2. Yang benar-benar bekerja (terverifikasi live)

| Kapabilitas | Bukti |
|---|---|
| Auth register/login/JWT/refresh | `POST /v1/auth/register` → 201 + `accessToken` |
| Chat melalui 9Router, tanpa secret di klien | `POST /v1/chat` → 200 `{"content":"OK","resolvedModel":"agentic/space-bunny-free","usage":{"totalTokens":2972}}` |
| Chat streaming WebSocket | `apps/api/src/routes/chat.ts:169-398`; e2e Skenario 1 lulus |
| Task durable + BullMQ + event realtime | 1597 task, 7979 event di produksi |
| Approval gate + audit keputusan | `waiting_approval` → `approve` → `completed`; `audit_logs` 10 baris (`approval:approved` 5, `approval:denied` 5) |
| Browser automation Chromium nyata | `browser_navigate` `completed` dengan konten halaman nyata; SSRF `169.254.169.254` ditolak |
| MCP stdio end-to-end | `mcp_registered` 2 tool; approval MEDIUM; output `<untrusted_content is_instruction="false">` |
| Artifact disk storage | checksum sha256, quota lintas proses, path traversal ditolak |
| PermissionEngine deny-by-default | `packages/permissions/src/engine.ts:150-160` |
| Rate limit | `apps/api/src/app.ts:167` (100/min), auth 10/min (`:251`) |
| Backup harian + retensi | 5 dump; `scripts/backup-postgres.sh:15` |
| PostgreSQL/Redis tidak publik | `ss -tulpn`: 5432 hanya `127.0.0.1`; container tanpa port mapping |
| APK bersih dari secret | scan bundle: nol `sk-*`, nol JWT, nol `NINEROUTER_API_KEY` |
| Docker log rotation | `/etc/docker/daemon.json` `max-size 10m, max-file 3` |
| Disk | 42G/174G (25%) |

---

## 3. Gap per komponen

### 3.1 Memory — persistensi diperbaiki 2026-10-13; semantik dan retensi masih gap

- **Diperbaiki.** Migrasi `apps/api/src/db/migrations/0007_memories.sql` membuat tabel `memories` (`vector(1536)`, 5 index, 2 check constraint, 2 FK) dan sudah diterapkan di produksi. `DrizzleMemoryRepository` tidak lagi menelan kegagalan DB: seluruh `try/catch` yang jatuh ke `InMemoryMemoryStore` dihapus, dan fallback hanya tersisa untuk `db === null` (seam unit test route). Bukti live: `POST /v1/memories` → 201; `GET /v1/memories` → `count=1`; `docker compose restart api`; `GET /v1/memories` → **`count=1`**. Test regresi: `apps/api/test/memory.test.ts` (gagal bila `catch` dikembalikan).
- Tabel `artifacts` yang tidak terpakai (tanpa migrasi, tanpa repository, tanpa konsumen) dihapus dari `apps/api/src/db/schema.ts`.
- **Masih gap.** Tidak ada provider embedding: `POST https://9router.ojixx.my.id/v1/embeddings` → `{"error":{"message":"No credentials for provider: openai"}}`, sehingga `InactiveEmbeddingProvider` tetap dipakai, `isSemanticSearchActive()` tetap `false`, dan tidak ada index ivfflat/hnsw. Kolom `vector(1536)` siap tetapi belum dipakai. `POST /v1/memories/search` menjawab jujur `{"data":[],"semanticSearchActive":false,"status":"inactive"}`.
- **Masih gap.** Tidak ada sweeper TTL/retention; `retention` hanya field tersimpan yang divalidasi check constraint.
- **Masih gap.** Tidak ada ekstraksi memori otomatis: `apps/agent-worker` tidak mengimpor `@personal-ai-os/memory`. Satu-satunya jalur tulis adalah `POST /v1/memories` dari klien.
- `GET`/`DELETE /v1/memories/search` → `400 VALIDATION_ERROR` (`params/id must match format "uuid"`). Route `/:id` (`apps/api/src/routes/memory.ts`) memang menangkap path itu, dan sekarang menolaknya di lapisan validasi; sebelumnya request itu mencapai Postgres sebagai literal uuid dan gagal `500 22P02`. Kontrak pencarian yang benar adalah `POST` (`:212`).

### 3.2 Task recovery — bug fungsional

- `apps/agent-worker/src/index.ts:223` memanggil `workerHandle.executor.recoverInterruptedTasks()` **tanpa argumen `queue`**.
- `apps/agent-worker/src/task-executor.ts:1173-1175` hanya meng-enqueue `if (queue)`.
- Akibat: task dipulihkan dari state, menulis event `task.resumed`, lalu berhenti. Tidak ada yang mengeksekusinya.
- `apps/api/test/e2e-scenarios.test.ts:868-914` (Skenario 4) **tidak memanggil `recoverInterruptedTasks` sama sekali**. Ia memanggil `executor2.execute(...)` langsung dan menaikkan counter yang di-hardcode. Test itu tidak dapat gagal karena apa pun yang terjadi. Klaim "LULUS" pada Butir 3 tidak berasal dari test ini.

### 3.3 Evaluator — struktural ada, verifikasi tidak

- `CodingAgent` memakai `input.mockEnvironment ?? this.createDefaultEnvironment()` (`packages/agent-core/src/coding/coding-agent.ts:90`).
- `createDefaultEnvironment()` mengembalikan `{passed: true}` untuk `runLint`, `runTypecheck`, `runTests`, `runBuild` (`:414-438`).
- Worker membuat `new CodingAgent(undefined, undefined, this.guard)` (`apps/agent-worker/src/task-executor.ts:134`) → selalu default env.
- `CodingEvaluator` (`packages/evaluator/src/coding-evaluator.ts`) membaca 7 field boolean; tidak mengeksekusi perintah apa pun.
- `executeRegisteredTool` menulis status `completed` **tanpa evaluator** (`apps/agent-worker/src/task-executor.ts:624`).
- `ResearchEvaluator` hanya menghitung field (`packages/evaluator/src/research-evaluator.ts`).
- Acceptance criteria tidak dipersist sebelum eksekusi: `TaskCheckpoint` tidak punya field kriteria (`packages/shared/src/tasks/types.ts:13-24`). `planner.ts:31-116,150-216` menulis `acceptanceCriteria` sebagai string plan yang tidak pernah dikonsumsi evaluator.

### 3.4 Research — DIPERBAIKI 2026-10-13 (jalur pencarian dan browse nyata)

Kondisi sebelum perbaikan: `web_search` default menembak `https://example.com/search?q=…` dan tidak terdaftar di registry mana pun; `ResearchAgent` tanpa env memakai sumber hardcoded MDN/nodejs.org dan tiga claim hardcoded yang lolos evaluator tanpa satu pun fetch; tahap `browse` dideklarasikan tetapi tidak pernah diset; `fetchContent` tidak pernah dipanggil.

Kondisi sekarang:
- `duckDuckGoSearch` (`packages/tools/src/builtin/web-search.ts`) menembak `https://html.duckduckgo.com/html/` tanpa API key, membuka pembungkus `/l/?uddg=…`, dan melempar error — bukan mengembalikan 0 hasil — bila markup tak dikenal atau status non-2xx. User agent harus bebas kata `bot` (DuckDuckGo membalas `202` tanpa hasil untuk UA yang menyebut dirinya bot).
- `createDefaultToolRegistry` mendaftarkan `web_search` bersama `web_fetch` (`packages/tools/src/registry/create-default-tool-registry.ts:20-21`), sehingga pencarian diperiksa `PermissionEngine` sebagai `web:search` (LOW).
- `LocalResearchEnvironment` (`packages/agent-core/src/research/local-environment.ts`) mencari lewat `web_search` dan membuka setiap hasil lewat `web_fetch` — keduanya melalui `ToolRegistry` yang sama, bukan klien HTTP privat. Halaman yang outputnya dipotong registry, non-2xx, atau teksnya < 200 karakter setelah `htmlToText` dibuang dan dicatat sebagai limitation.
- `ResearchAgent` tidak lagi punya daftar sumber/claim hardcoded. Tanpa `environment` ia menghasilkan nol sumber dan `ResearchEvaluator` menolak (`No valid sources provided`); tahap `browse` benar-benar diset dan `fetchContent` dipanggil untuk setiap sumber; `snippet` berasal dari konten nyata.
- `htmlToText` (`packages/tools/src/html-text.ts`) membuang blok `<script>`/`<style>` sebelum tag, karena halaman SPA sebelumnya terbaca seperti prosa. `web_fetch.outputLimitBytes` naik 64 KiB → 1 MiB.

Masih terbuka: klaim adalah kutipan awal tiap halaman, bukan sintesis model, sehingga relevansi terhadap pertanyaan belum dinilai; `ResearchEvaluator` tidak mem-fetch URL sendiri.

Sisa temuan lain di bagian ini yang belum diperbaiki:
- `POST /v1/tasks` menerima `kind` string bebas 1-80 karakter (`apps/api/src/routes/tasks.ts:38`) tanpa whitelist. `TaskRecord.kind` bertipe `string` (`packages/shared/src/tasks/types.ts:31`).

### 3.5 Windows Agent — dispatch dan identitas kriptografis DIPERBAIKI

- **Diperbaiki**: `dispatchCommand` kini dipanggil dari jalur task. Worker meminta presence ke API (`DeviceDispatcher.listOnlineDevices` → `GET /v1/internal/devices`) dan mendispatch lewat route internal ber-token `POST /v1/internal/device-commands` (`apps/api/src/routes/device-commands.ts`), karena socket perangkat hanya hidup di proses API. Aksi `device:command` berisiko HIGH dan selalu butuh approval yang terikat pada teks perintah + `deviceId`; verdict task adalah exit code perangkat.
- **Diperbaiki**: handshake `/v1/agent/ws` tidak lagi menulis `deviceId` dari query string ke `devices.id` (kolom `uuid`). Sebelumnya agent Windows mengirim id non-uuid dan API mati dengan `PostgresError: invalid input syntax for type uuid`.
- **Diperbaiki**: task yang gagal sebelum mulai (perangkat offline) tidak lagi melanggar state machine; sebelumnya `queued → failed` melempar `IllegalTaskStateTransitionError` dan task tertinggal `queued` selamanya tanpa error yang terlihat.
- Masih terbuka: capability registry 7 kapabilitas, `default enabled: false`, allowlist ditegakkan (`apps/windows/src/security/capability-registry.ts:116`), tapi **tidak ada allowlist teks-perintah atau biner** — hanya capability + action + `cwd`. Tidak ada pemetaan capability Windows → capability Personal AI OS.
- **Diperbaiki 2026-10-14**: identitas perangkat kini kriptografis. `/v1/agent/ws` menolak `deviceId` dari query string (`DEVICE_IDENTITY_REQUIRED`), mengirim `device.challenge`, dan hanya membuat sesi setelah agent menandatangani challenge itu dengan private key P-256; verifikasi di server memakai `crypto.verify(..., { dsaEncoding: 'ieee-p1363' })` (`apps/api/src/services/device-identity.ts`). `devices.public_key` diisi JWK kanonik dan `DeviceRepository.registerAgent` mencari baris berdasarkan `(userId, public_key)`, sehingga key sama → baris sama. Id perangkat adalah uuid terbitan server; agent tidak lagi membuat id sendiri (`win-dev-<hash>` dihapus). Migrasi `0008_device_key_identity.sql` mengganti unique `devices_user_name_uq` dengan `devices_public_key_uq` parsial. Sisa: private key disimpan di `localStorage` webview, bukan OS keystore.
- Masih terbuka: sesi koneksi device in-memory (`apps/api/src/services/device-connection-manager.ts`) — hilang saat restart API.
- Direktori `runtimes/{pi,omp,hermes,openhands}-adapter` **tidak ada**. Hermes & OpenHands = `UnverifiedRuntimeAdapter` yang menolak eksekusi (`packages/agent-core/src/runtimes/unverified-adapter.ts`).

### 3.6 Scheduler, event, notifikasi

- Jadwal durable di PostgreSQL (`schedules`, migrasi `0005`), tetapi Map in-memory tetap source-of-truth tick (`apps/scheduler/src/scheduler-engine.ts`); kegagalan write di-swallow.
- `SchedulerEngine` di API hanya mendaftarkan jadwal ke tabel `schedules`; dispatcher duplikatnya (yang meng-enqueue BullMQ tanpa `INSERT` ke `tasks`) **dihapus 2026-10-14**. `tick()` dimiliki container `scheduler` (`apps/scheduler/src/index.ts`), yang menulis baris `tasks` lalu meng-enqueue BullMQ.
- Idempotency slot = `sched:<jobId>:<ISO>` di Set in-memory + unique index DB hanya di jalur proses scheduler.
- Ketiga missed-run policy (`skip`/`run_once`/`catch_up`) ada. Timezone hand-rolled via `Intl.DateTimeFormat` (`apps/scheduler/src/cron-parser.ts`), tanpa library cron/tz.
- EventEngine **tidak bisa** dispatch tanpa PermissionEngine (gate di `apps/scheduler/src/event-engine.ts:137`). Namun tidak ada verifikasi signature, dan `registerRule` tidak pernah dipanggil di produksi.
- `NotificationEngine` di API dibuat dengan `SqlNotificationRepository` (`apps/api/src/index.ts`) dan `createFcmProviderFromEnv()`; seluruh baca/tulis notifikasi dan preferensi lewat storage durable.
- `broadcaster.subscribe(createTaskNotificationListener(...))` (`apps/api/src/services/task-notifications.ts`) mengubah event task dari Redis (`task.completed`, `task.failed`, `task.waiting_approval`) menjadi baris `notifications` dengan `delivery_state` dan `deep_link`. **SELESAI 2026-10-14.**
- Dispatcher duplikat di proses API **dihapus** (tidak pernah menulis baris `tasks`); container `scheduler` adalah satu-satunya pemanggil `tick()`.
- Retry notifikasi dibatasi `maxAttempts` (default 3) per perangkat; habis → state `failed` + `last_error`, tanpa dead-letter queue.
- `apps/scheduler/src/fcm-provider.ts` memakai `ServiceAccountTokenSource`: JWT RS256 ditandatangani dengan `client_email`/`private_key` dan ditukar ke `token_uri` (grant `jwt-bearer`), lalu di-cache sampai mendekati `expires_in`. **Literal `dummy-env-token` sudah dihapus 2026-10-14.** Tanpa kredensial → `DisabledFcmProvider` dengan log jujur.

### 3.7 Artifact dan skills

- Tabel `artifacts` (dulu `apps/api/src/db/schema.ts:293-323`) **tanpa migrasi** dan tanpa repository; **sudah dihapus dari schema pada 2026-10-13**. Artifact sebenarnya selalu disimpan di disk.
- Upload tidak streaming: `POST /v1/artifacts` menerima `content: string` JSON (`apps/api/src/routes/artifacts.ts:44-63`); batas efektif = `bodyLimit` Fastify default 1 MiB (`apps/api/src/app.ts:145-159`), bukan 25 MB.
- `getArtifactStream` ada tetapi tidak dipakai route.
- MIME berdasarkan deklarasi klien (allowlist string), tanpa magic bytes.
- `retention` hanya field; tidak ada sweeper.
- `accessPolicy: 'project_members'` diabaikan.
- Quota dihitung dari sidecar (lintas proses), tetapi check-then-put non-atomik (TOCTOU).
- Path traversal divalidasi: `sanitizeFilename` (`packages/tools/src/artifacts/artifact-manager.ts:90`) + `resolveSafePath` (`disk-storage.ts:17`).
- Skills: 3 manifest di `skills/`, loader hanya membaca `manifest.json` (`packages/agent-core/src/skills/skill-loader.ts:19,37`); `skills/*/index.ts` tidak pernah di-import; handler hardcoded di `apps/api/src/routes/skills.ts:44-46`. Katalog skills di produksi kosong.
- Validasi manifest nyata (semver, schema, denylist action) dan permission ditegakkan via `PermissionEngine` (`skill-executor.ts:32`).

### 3.8 Audit dan observability

- `audit_logs` produksi: 10 baris, seluruhnya `approval:approved|denied`. Tool call, MCP call, browser action, dan artifact tidak masuk `audit_logs`.
- `SqlAuditRepository.log` hanya dipanggil dari `apps/api/src/routes/approvals.ts:113,219`.
- MCP audit hanya ke `console.log` (`apps/agent-worker/src/index.ts`) → volatile, hilang saat container recreate.
- Worker healthcheck hanya menyentuh file `/tmp/healthy` pada timer, bukan memprobe database/Redis (`apps/agent-worker/src/index.ts:307-320`).

### 3.9 Dead code produksi

Nol pemanggil di `apps/` untuk:
- `packages/agent-core/src/council/ai-council.ts`
- `packages/agent-core/src/healing/self-healing-engine.ts`

Keduanya punya test, keduanya lolos, dan keduanya tidak pernah dijalankan oleh sistem. Klaim "AI Council" dan "self-healing" pada dokumen audit tidak didukung jalur produksi.

---

## 4. Gap terhadap visi

| Visi | Status | Gap utama |
|---|---|---|
| Android klien AI penuh | Sebagian | 9 layar ada; tidak ada upload attachment, tidak ada layar memory, tidak ada SDK FCM nyata, tidak ada deep link OS |
| Chat streaming via backend + 9Router | **Bekerja** | Tidak ada fallback REST; tidak ada tool calling/vision dari klien |
| Project/conversation/task realtime | **Bekerja** | — |
| Background task pulih setelah restart | **Rusak** | Queue tidak diteruskan saat recovery |
| Routing model/runtime/tool berbasis capability | Sebagian | Kapabilitas model di-hardcode `['chat','streaming']` (`packages/model-gateway/src/nine-router.ts:238`); tool calling & vision tidak pernah diisi probe; runtime Hermes/OpenHands tidak dapat dieksekusi |
| Memory/context ber-scope & ber-budget | **Tidak ada persistensi** | Tabel tidak ada; embedding throw |
| MCP/tools/browser ber-permission & audit | Sebagian | Permission jalan; audit tidak tersimpan |
| Coding/research menghasilkan bukti | **Tidak** | Evaluator membaca boolean; research tanpa search |
| Evaluator menentukan completion | **Tidak** | Evaluator tidak mengeksekusi apa pun; satu jalur `completed` tanpa evaluator |
| Approval mengikat tindakan | **Bekerja** | Fingerprint, action, resource, expiry ada |
| Scheduler/event/notification | **Bekerja** | Notifikasi durable terkirim (task selesai/gagal/approval), preferensi bertahan restart; FCM memakai access token OAuth2 dari service account. Sisa: kredensial Google belum disuntikkan (Gap 2), tanpa verifikasi signature event, tanpa dead-letter |
| Windows Agent capability-limited | Sebagian | Dispatch dan identitas kriptografis sudah nyata; sisa: tidak ada allowlist teks-perintah/biner, sesi device in-memory |
| Tanpa secret di klien/log/repo | **Bekerja** | APK bersih; logger meredaksi |
| PostgreSQL/Redis tidak publik | **Bekerja** | Terverifikasi `ss -tulpn` |
| Backup/restore/observability/ARM64 | Sebagian | Backup+restore drill lulus; tidak ada alerting, tidak ada tracing terdistribusi |

---

## 5. Risiko

1. **Dokumen audit yang salah lebih berbahaya daripada tidak ada dokumen.** Empat butir "LULUS" yang tidak lulus akan membuat pekerjaan berikutnya mengasumsikan fondasi yang tidak ada.
2. **Kehilangan memori diam-diam.** Pengguna dapat menulis memori, menerima `201`, dan kehilangannya tanpa peringatan. Tidak ada error, tidak ada log.
3. **Task menggantung permanen.** Setiap restart worker berpotensi meninggalkan task di `running` selamanya tanpa retry, timeout, atau eskalasi.
4. **Klaim completion palsu.** Sistem dapat melaporkan coding task `completed` tanpa menjalankan satu pun test.
5. **FCM token hardcoded — DITUTUP 2026-10-14.** Provider kini memperoleh access token OAuth2 nyata dari service account; literal `dummy-env-token` dihapus. Sisa: kredensial Google belum disuntikkan, jadi provider aktif adalah `DisabledFcmProvider` yang jujur.
6. **Device identity dipalsukan — DITUTUP 2026-10-14.** `deviceId` dari query string kini ditolak dan `public_key` diverifikasi terhadap challenge bertanda tangan. Sisa risiko: private key agent ada di `localStorage` webview, jadi kompromi webview berarti kompromi identitas perangkat itu.
7. **Tabel `artifacts` dan `memories` tanpa migrasi** menunjukkan tidak ada yang memverifikasi paritas schema↔migrasi. Tabel lain mungkin menyimpang tanpa terdeteksi.
8. **VPS 2 OCPU / 11 GiB tanpa swap** dengan worker 2048m + Chromium. Belum ada bukti beban puncak.

---

## 6. Urutan implementasi yang aman

Setiap milestone harus menghasilkan bukti yang dapat diulang. Tidak ada milestone yang dimulai sebelum milestone sebelumnya terverifikasi.

| Milestone | Acceptance criteria terukur |
|---|---|
| **M0. Koreksi kebenaran dokumen** | `docs/final-audit.md` dan `docs/capability-matrix.yaml` tidak lagi menyatakan LULUS untuk memory, recovery, evaluator, research, Windows dispatch, dan notifikasi. Setiap status punya bukti live atau diturunkan ke `partial`/`not_implemented`. Tanpa perubahan kode. |
| **M1. Recovery task** | Task `running` yang ditinggal restart worker kembali dieksekusi otomatis tanpa duplikasi side effect. Test regresi memanggil `recoverInterruptedTasks(queue)` sungguhan dan gagal bila task tetap `running` setelah worker hidup. Reproduksi live: task `running/40` → restart → `completed`. |
| **M2. Memory durable** | **SELESAI untuk persistensi (2026-10-13).** Migrasi `0007_memories.sql` + `vector(1536)` + 5 index; memori bertahan setelah restart API (create → restart → list masih 1, terverifikasi live). Fallback senyap ke `InMemoryMemoryStore` dihapus. `:id` divalidasi uuid, jadi `GET`/`DELETE /v1/memories/search` → `400`, bukan `500`. **Belum**: provider embedding (9Router tidak menyediakan) dan sweeper retention. |
| **M3. Evaluator berbasis bukti** | **SELESAI (2026-10-13).** `LocalCodingEnvironment` (`packages/agent-core/src/coding/local-environment.ts`) menjalankan `node --run lint/typecheck/test/build` di workspace per task; `createDefaultEnvironment()` yang mengembalikan `{passed:true}` dihapus. Worker memberi setiap task coding workspace git sendiri di `CODING_WORKSPACE_ROOT=/app/data/workspaces` (named volume `coding-workspaces`). `executeRegisteredTool` menjalankan `GenericEvaluator` sebelum `completed`. Bukti live: workspace dengan `lint` keluar 1 → `failed` (`score 0.71`); workspace dengan script lulus → `completed` (`score 1`, artifact diff nyata). **Belum**: acceptance criteria belum dipersist sebelum eksekusi, sehingga `GenericEvaluator` pada jalur tool masih memakai kriteria default. |
| **M4. Windows dispatch + identitas perangkat** | **SELESAI (2026-10-13 dispatch, 2026-10-14 identitas).** Task dengan `payload.targetDevice` mengirim `command.execute` melalui WSS ke device yang online, menerima hasil, dan menyimpannya sebagai artifact: `TaskExecutor` (`apps/agent-worker/src/task-executor.ts:167-205`, `:663-884`) meminta presence lewat `DeviceDispatcher.listOnlineDevices`, worker memakai `HttpDeviceDispatcher` (`apps/agent-worker/src/device-dispatcher.ts:59`) ke route internal ber-token `POST /v1/internal/device-commands` (`apps/api/src/routes/device-commands.ts:43`) — Caddy menutup `/v1/internal/*` dengan `404`, jadi hanya terjangkau dari network Docker internal. Aksi `device:command` berisiko HIGH dan tidak diizinkan tanpa approval (`packages/permissions/src/engine.ts:127`); fingerprint memuat teks perintah + `deviceId`, jadi satu approval tidak mengotorisasi perintah lain. **Identitas kriptografis (2026-10-14)**: agent menandatangani `device.challenge` dengan keypair P-256, `deviceId` diterbitkan server (`DEVICE_IDENTITY_REQUIRED` bila agent mengklaim sendiri), `devices.public_key` diisi JWK kanonik, dan key yang sama selalu memetakan ke baris device yang sama (migrasi `0008_device_key_identity.sql`). **Belum**: allowlist teks-perintah/biner, sesi device in-memory. |
| **M5. Notifikasi + scheduler** | **SELESAI (2026-10-14).** `NotificationEngine` di API memakai `SqlNotificationRepository` + `createFcmProviderFromEnv()`; `broadcaster.subscribe(createTaskNotificationListener(...))` (`apps/api/src/services/task-notifications.ts`) mengubah event task Redis menjadi baris `notifications` durable dengan `delivery_state`/`deep_link`. Bukti live: task selesai terjadwal → `task_completed`/`delivered`; task gagal (device offline) → `task_failed`/`failed` + `last_error` jujur; event `task.waiting_approval` di channel `personal-ai-os:events:all` → `approval_required`/`failed` deep link approval; preferensi bertahan `docker compose restart api`; `devices.push_token` terisi lewat `POST /v1/devices/:id/push-token` (204/404/400). FCM memakai access token OAuth2 dari service account (`ServiceAccountTokenSource`, JWT RS256 → `token_uri`), literal `dummy-env-token` dihapus. Dispatcher duplikat di API dihapus; `tick()` hanya di container `scheduler`. **Belum**: pengiriman sungguhan ke Google (`FCM_SERVICE_ACCOUNT_JSON` belum diisi), tanpa dead-letter, tanpa verifikasi signature event. |
| **M6. Research** | **SELESAI (2026-10-13).** Provider pencarian nyata terdaftar: `duckDuckGoSearch` (`packages/tools/src/builtin/web-search.ts`) di `createDefaultToolRegistry` (`packages/tools/src/registry/create-default-tool-registry.ts:20-21`), tanpa API key. `LocalResearchEnvironment` (`packages/agent-core/src/research/local-environment.ts`) mencari lewat `web_search` dan membuka setiap hasil lewat `web_fetch`, keduanya melalui `ToolRegistry` ber-permission (`web:search`/`web:fetch`). Sumber dan claim hardcoded dihapus; klaim terikat ke URL yang benar-benar di-fetch. Bukti live: query nyata → `completed` (`score 1`, 5 sumber nyata, 5 klaim tertaut); query tanpa hasil → `failed` (`score 0`, `No valid sources provided`). **Belum**: sintesis klaim lintas sumber oleh `ModelGateway` — klaim masih kutipan awal halaman, sehingga relevansi terhadap pertanyaan belum dinilai; `ResearchEvaluator` juga belum mem-fetch URL sendiri. |
| **M7. Audit menyeluruh** | Setiap tool call, MCP call, browser action, dan artifact write menulis baris `audit_logs` dengan aktor, action, resource, hasil. Bukan `console.log`. |

Ketergantungan: M1 dan M2 berdiri sendiri. M3 membawa workspace eksekusinya sendiri (per task, di dalam volume worker) dan M6 membawa jalur pencariannya sendiri, jadi keduanya tidak menunggu M4. M5 membutuhkan M1 agar event task dapat dipercaya. M7 sebaiknya menyertai M3–M6.

---

## 7. Cara mereproduksi bukti dalam dokumen ini

```sh
# 1. Memory hilang saat restart
node /tmp/t5b/mem2.mjs create     # CREATE 201
node /tmp/t5b/mem2.mjs list       # count=1
docker compose restart api
node /tmp/t5b/mem2.mjs list       # count=0

# 2. Tabel memories tidak ada
docker exec personal-ai-os-postgres-1 psql -U personal_ai_os -d personal_ai_os \
  -c "SELECT to_regclass('public.memories'), to_regclass('public.artifacts');"

# 3. Recovery tidak me-requeue
#    (set task running, restart worker, amati status tetap running)

# 4. Audit hanya approval
docker exec personal-ai-os-postgres-1 psql -U personal_ai_os -d personal_ai_os \
  -c "SELECT action, count(*) FROM audit_logs GROUP BY action;"

# 5. Notifikasi durable terkirim (M5, 2026-10-14)
docker exec personal-ai-os-postgres-1 psql -U personal_ai_os -d personal_ai_os \
  -c "SELECT type, delivery_state, attempts, deep_link FROM notifications ORDER BY created_at DESC;"
#   -> task_completed | delivered | 0 | personal-ai://tasks/<taskId terjadwal smoke.echo>
#   -> task_failed    | failed    | 1 | personal-ai://tasks/<taskId windows_command device offline>
#      last_error "Pengiriman dinonaktifkan: FCM_SERVICE_ACCOUNT_JSON tidak dikonfigurasi…"
# Event approval lewat Redis (channel nyata personal-ai-os:events:all):
#   redis-cli PUBSUB CHANNELS '*' -> personal-ai-os:events:all
#   publish {eventType:"task.waiting_approval", payload:{approvalId:"appr-proof-1"}} -> 1 receiver
#   -> baris approval_required | failed | personal-ai://approvals/appr-proof-1
# Push token perangkat: POST /v1/devices -> 201; POST /v1/devices/<id>/push-token -> 204;
#   SELECT push_token FROM devices -> terisi; body kosong -> 400; device milik user lain -> 404
# Durabilitas: docker compose restart api; GET /v1/notifications -> jumlah sama, delivery_state sama;
#   GET /v1/notifications/preferences -> nilai sama
# FCM OAuth nyata diuji terhadap stub HTTP: node --test apps/scheduler/test/fcm-provider.test.ts (4/4)

# 6. Katalog tool produksi
#    GET /v1/catalog -> {"tools":[{"name":"web_fetch"},{"name":"web_search"}]}

# 7. Evaluator menilai bukti nyata (M3)
docker exec -u node personal-ai-os-worker-1 sh -c '
  mkdir -p /app/data/workspaces/m3-fail && cd /app/data/workspaces/m3-fail &&
  printf "process.exit(1);\n" > bad.mjs &&
  printf "{\"name\":\"f\",\"private\":true,\"scripts\":{\"lint\":\"node bad.mjs\"}}\n" > package.json &&
  git init --quiet && git add -A && git -c user.email=p@x -c user.name=p commit -qm init'
# POST /v1/tasks {kind:"coding_task", payload:{workspaceDir:"/app/data/workspaces/m3-fail"}}
#   -> status failed, evaluationResult.score=0.71, issue "Lint issue: Command failed: node --run lint"

# 8. Research mencari, membuka, dan mengutip halaman nyata (M6)
# POST /v1/tasks {kind:"research_task", payload:{query:"durable execution in PostgreSQL"}}
#   -> completed, progress 100, evaluationResult.passed=true, score=1,
#      "5 sources analyzed. Average credibility score: 0.74."
#      artifact-research-report-<taskId> memuat 5 URL nyata yang benar-benar diambil
# POST /v1/tasks {kind:"research_task", payload:{query:"site:nonexistent-domain-9f8c1e2a.invalid xyzzyqwerty"}}
#   -> failed, score=0, "Research completion blocked: No valid sources provided."
#   (sebelum perbaikan: kedua query di atas sama-sama "completed" dengan sumber hardcoded)

# 9. Dispatch perintah ke Windows Agent (M4)
# Terminal 1 — agent Windows palsu terhubung dan menjawab satu perintah:
#   node -e 'const ws=new WebSocket("ws://127.0.0.1:8080/v1/agent/ws?token="+process.env.TOKEN+"&deviceId=win-smoke-m5&platform=windows");
#            -> device.error DEVICE_IDENTITY_REQUIRED (id yang diklaim ditolak sejak 2026-10-14)
# Agent palsu menandatangani challenge dengan keypair P-256 (WebCrypto global Node 22), lalu:
#   ws://127.0.0.1:8080/v1/agent/ws?token=<TOKEN>            (tanpa deviceId)
#     -> device.challenge -> device.handshake {publicKey,signature,name,platform}
#     -> device.handshake_ack {deviceId:"<uuid terbitan server>"}
# POST /v1/tasks {kind:"windows_command", payload:{targetDevice:"<uuid>", command:"hostname"}} -> 201
#   -> task.waiting_approval {action:"device:command", deviceId:"<uuid>", riskLevel:"HIGH"}
# POST /v1/approvals/<approvalId>/approve -> 200
#   -> perangkat menerima {"type":"command.execute","command":"hostname","timeoutMs":60000}
#   -> task.completed {exitCode:0, artifacts:[{type:"device_command_output",
#        content:{stdout:"SMOKE-WORKSTATION-SIGNED"}}]}
# POST /v1/tasks {kind:"windows_command", payload:{targetDevice:"win-smoke-absent", command:"hostname"}}
#   -> failed, "Windows Agent \"win-smoke-absent\" sedang offline…",
#      task.failed {offlineReason:"device_unreachable"}   (bukan sukses palsu)
# GET /v1/devices -> baris terdaftar dengan isOnline dari sesi online
#   (sebelum perbaikan 2026-10-13: route ini hanya membaca baris tabel devices, jadi agent tidak terlihat)
# Reconnect dengan keypair yang sama -> deviceId identik, dan socket lama ditutup server.
