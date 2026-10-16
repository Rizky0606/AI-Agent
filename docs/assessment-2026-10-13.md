# Assessment repository — Personal AI OS

Tanggal: 2026-10-13 (Asia/Jakarta).
Branch: `release/installers`, HEAD `e67bae7`.
Metode: audit read-only terhadap checkout, database produksi live, dan container produksi. Setiap klaim di bawah memiliki `path:line` atau output perintah yang dapat diulang. Tidak ada kode aplikasi yang diubah.

**Status per 2026-10-14**: dokumen ini adalah potret kondisi 2026-10-13. Cacat yang sudah diperbaiki setelahnya ditandai di tempatnya masing-masing (M1–M7 di §6). **Audit menyeluruh (M7) SELESAI 2026-10-14**: `audit_logs` tidak lagi hanya keputusan approval — tool call, MCP call, browser action, dan artifact write semuanya tercatat (lihat §3.8 dan baris M7 di §6).

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

Selain itu: notifikasi belum pernah terkirim sekali pun (`notifications` = 0 baris) — **SELESAI 2026-10-14** (lihat M7 di §6); `audit_logs` hanya berisi keputusan approval — **SELESAI 2026-10-14** (lihat M7 di §6); dan `AI Council`/`SelfHealingEngine` adalah dead code produksi — **SELESAI 2026-10-14**, keduanya dihapus dari `agent-core` (§3.9).

Konsekuensi: **setiap keputusan arsitektur berikutnya tidak boleh dibangun di atas `docs/final-audit.md` sampai klaim di dalamnya dikoreksi.** Itulah pekerjaan pertama.

---

## 2. Yang benar-benar bekerja (terverifikasi live)

| Kapabilitas | Bukti |
|---|---|
| Auth register/login/JWT/refresh | `POST /v1/auth/register` → 201 + `accessToken` |
| Chat melalui 9Router, tanpa secret di klien | `POST /v1/chat` → 200 `{"content":"OK","resolvedModel":"agentic/space-bunny-free","usage":{"totalTokens":2972}}` |
| Chat streaming WebSocket | `apps/api/src/routes/chat.ts:169-398`; e2e Skenario 1 lulus |
| Task durable + BullMQ + event realtime | 1597 task, 7979 event di produksi |
| Approval gate + audit keputusan | `waiting_approval` → `approve` → `completed`; `audit_logs` 10 baris (`approval:approved` 5, `approval:denied` 5) — **SELESAI 2026-10-14**: 38 baris, termasuk `web:fetch`/`web:search` (tool call), `tool:mcp_echo_echo` (MCP call), `browser:navigate`, dan `artifact:write` |
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
- **Masih gap (khusus memori).** Tidak ada sweeper TTL/retention untuk `memories`; `retention` hanya field tersimpan yang divalidasi check constraint. Sweeper artifact yang ditambahkan 2026-10-14 (`apps/api/src/services/artifact-retention-sweeper.ts`) tidak menyentuh tabel ini.
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
- **Diperbaiki 2026-10-14**: allowlist teks-perintah/biner ada. `assertCommandAllowed` (`apps/windows/src/security/command-allowlist.ts`) dipanggil `CommandExecutor` dan `TauriCommandExecutor` sebelum spawn, dan backend Rust mengulang pemeriksaan di `execute_local_command`. Daftar program yang diizinkan berasal dari aturan `CapabilityRegistry` lokal yang sama dengan flag kapabilitas, jadi tidak ada jalur masuk yang bisa memperlebarnya. Deny by default; rantai perintah (`;`, `&&`, `|`), subshell, `-EncodedCommand`, `Invoke-Expression`/`iex`, shell wrapper (`cmd`, `powershell`, `wscript`, `bash`, `wsl`), operator `&`, dan nama program ber-path/ber-ekstensi ditolak dengan `COMMAND_NOT_ALLOWED` plus alasan bernama. **Belum**: allowlist ini belum pernah dijalankan di perangkat Windows nyata — hanya di unit test. Tidak ada pemetaan capability Windows → capability Personal AI OS.
- **Diperbaiki 2026-10-14**: identitas perangkat kini kriptografis. `/v1/agent/ws` menolak `deviceId` dari query string (`DEVICE_IDENTITY_REQUIRED`), mengirim `device.challenge`, dan hanya membuat sesi setelah agent menandatangani challenge itu dengan private key P-256; verifikasi di server memakai `crypto.verify(..., { dsaEncoding: 'ieee-p1363' })` (`apps/api/src/services/device-identity.ts`). `devices.public_key` diisi JWK kanonik dan `DeviceRepository.registerAgent` mencari baris berdasarkan `(userId, public_key)`, sehingga key sama → baris sama. Id perangkat adalah uuid terbitan server; agent tidak lagi membuat id sendiri (`win-dev-<hash>` dihapus). Migrasi `0008_device_key_identity.sql` mengganti unique `devices_user_name_uq` dengan `devices_public_key_uq` parsial. Sisa: private key disimpan di `localStorage` webview, bukan OS keystore.
- Masih terbuka (dimitigasi 2026-10-14): sesi koneksi device in-memory (`apps/api/src/services/device-connection-manager.ts`) — hilang saat restart API. Dispatch kini menunggu agent reconnect sampai `DEVICE_RECONNECT_GRACE_MS` (default 30 dtk) lewat `DeviceConnectionManager.waitForConnection`, dan task yang sudah disetujui melewati gate presence sehingga approval tidak terbakar saat API restart. Sesi tetap tidak persisten.
- **Dikoreksi 2026-10-14.** Direktori `runtimes/{pi,omp,hermes,openhands}-adapter` memang **tidak ada**, tetapi klaim bahwa Hermes dan OpenHands hanya `UnverifiedRuntimeAdapter` yang menolak eksekusi hanya benar untuk OpenHands. Jalur produksi adalah `apps/agent-worker/src/index.ts` → `RemoteRuntimeAdapter` → HTTP → `apps/runtime-bridge` (unit systemd di host, `172.20.0.1:9120`) → binary host; `RuntimeId` di bridge hanya `omp` dan `hermes` (`apps/runtime-bridge/src/index.ts:10`), dan keduanya terverifikasi live (`docs/verification/runtimes-live.md`: OMP 18.6.1 JSONL, Hermes 0.20.5 `-z`). `UnverifiedRuntimeAdapter` di `packages/agent-core/src/runtimes/unverified-adapter.ts` **dead code produksi** — hanya disentuh `packages/agent-core/test/runtimes.test.ts`. OpenHands tetap tidak terpasang dan tidak punya adapter, entri bridge, atau slot allowlist.

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

- Tabel `artifacts` (dulu `apps/api/src/db/schema.ts:293-323`) **tanpa migrasi** dan tanpa repository; **sudah dihapus dari schema pada 2026-10-13**. Artifact sebenarnya selalu disimpan di disk. **Sejak 2026-10-14 paritas `schema.ts` ↔ migrasi diperiksa otomatis** oleh `apps/api/test/schema-parity.test.ts`, yang membuat database sementara, menerapkan seluruh migrasi dari nol, dan membandingkan tabel/kolom/tipe hasilnya dengan `schema.ts`.
- **SELESAI 2026-10-14.** Upload streaming: route baru `POST /v1/artifacts/stream` menerima byte mentah (`application/octet-stream` dengan content-type parser khusus supaya Fastify tidak membuffer, batas 25 MiB per route) dan mengalirkannya ke `storage.putStream` (file temporer + `rename`), jadi body tidak pernah ditahan di memori. `GET /v1/artifacts/:id/download` kini memakai `getArtifactStream` yang sebelumnya tidak terpakai, sehingga unduhan juga streaming. Route JSON lama (`content: string`, batas 1 MiB) tetap ada untuk klien kecil.
- **SELESAI 2026-10-14.** MIME divalidasi dengan magic bytes: `packages/tools/src/artifacts/magic-bytes.ts` membaca byte awal unggahan (PNG/JPEG/GIF/WebP/PDF/ZIP, fallback teks/JSON) dan menolak ketidakcocokan dengan `InvalidMimeTypeError`. Stream diintip tanpa dibuffer (`stream.read(32)` + `unshift` sinkron), sehingga tidak ada byte yang hilang.
- **SELESAI 2026-10-14 untuk artifact.** `apps/api/src/services/artifact-retention-sweeper.ts` menghapus artifact kedaluwarsa menurut enum `ArtifactRetention`: `ephemeral` setelah TTL, `task_duration` begitu task-nya terminal, `project_lifetime` begitu project-nya hilang, `permanent` tidak pernah. Sweep berjalan periodik di proses API (`ARTIFACT_RETENTION_SWEEP_INTERVAL_MS`; kosong/0 = mati). Bukti live: artifact `ephemeral` → `404` pada poll ketiga, `permanent` tetap `200`. **Retensi memori masih gap** — `memories.retention` belum punya sweeper.
- `accessPolicy: 'project_members'` diabaikan.
- Quota dihitung dari sidecar (lintas proses), tetapi check-then-put non-atomik (TOCTOU).
- Path traversal divalidasi: `sanitizeFilename` (`packages/tools/src/artifacts/artifact-manager.ts:90`) + `resolveSafePath` (`disk-storage.ts:17`).
- Skills: 3 manifest di `skills/`, loader hanya membaca `manifest.json` (`packages/agent-core/src/skills/skill-loader.ts:19,37`); `skills/*/index.ts` tidak pernah di-import; handler hardcoded di `apps/api/src/routes/skills.ts:44-46`. Katalog skills di produksi kosong.
- Validasi manifest nyata (semver, schema, denylist action) dan permission ditegakkan via `PermissionEngine` (`skill-executor.ts:32`).

### 3.8 Audit dan observability

- **SELESAI 2026-10-14 (M7).** `audit_logs` produksi kini 38 baris dan mencakup tool call (`web:fetch`/`web:search`, `tool:search_knowledge`), MCP call (`tool:mcp_echo_echo`, `resource_type: external_mcp`), browser action (`browser:navigate`), dan artifact write (`artifact:write`) — bukan hanya `approval:approved|denied`. `SecuredCapabilityGuard` (`packages/permissions/src/guard.ts`) menulis satu baris per pemanggilan setelah hasil diketahui (`metadata.outcome` `success`/`failure` + `durationMs` + `error`); guard diberi `auditLogger` di API dan worker. Artifact write lewat `ArtifactManager.auditSink` (`packages/tools/src/artifacts/artifact-manager.ts`). `audit_logs.resource_id` diubah `uuid` → `varchar(512)` (migrasi `0010_audit_resource_id_text.sql`) karena tool call menulis path/URL/nama tool.
- MCP tidak lagi hanya `console.log`: pemanggilan tool MCP lewat guard yang sama, dan sink console.log di `apps/agent-worker/src/index.ts` dihapus.
- **SELESAI 2026-10-14.** Worker healthcheck tidak lagi hanya menyentuh file: `refreshHealthFile` (`apps/agent-worker/src/index.ts`) menjalankan `select 1` ke Postgres dan `PING` ke Redis lebih dulu, dan hanya me-refresh `/tmp/healthy` bila keduanya berhasil. Kegagalan menulis log `healthcheck_failed` terstruktur dan meninggalkan file basi sehingga container ditandai unhealthy — worker sendiri tidak keluar, jadi gangguan sesaat tidak mematikan proses. Test: `apps/agent-worker/test/health.test.ts` (3/3).

### 3.9 Dead code produksi

**SELESAI 2026-10-14.** `AiCouncil` dan `SelfHealingEngine` punya test, lolos, dan nol pemanggil di `apps/` maupun di paket lain. Keduanya **dihapus**, bukan disambungkan: subdirektori `council/` dan `healing/` di dalam paket `agent-core`, dua baris `export *` di `packages/agent-core/src/index.ts`, dan kedua file test-nya. Test paket turun 40 → 31. Tidak ada importer tersisa dan `tsc --build` bersih, sehingga klaim "AI Council" dan "self-healing" kini benar-benar tidak ada lagi di kode — bukan sekadar tidak dipanggil.

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
| MCP/tools/browser ber-permission & audit | **Bekerja** | **Audit SELESAI 2026-10-14 (M7)**: tool call, MCP call, browser action, dan artifact write menulis baris `audit_logs` dengan aktor, action, resource, dan hasil |
| Coding/research menghasilkan bukti | **Tidak** | Evaluator membaca boolean; research tanpa search |
| Evaluator menentukan completion | **Tidak** | Evaluator tidak mengeksekusi apa pun; satu jalur `completed` tanpa evaluator |
| Approval mengikat tindakan | **Bekerja** | Fingerprint, action, resource, expiry ada |
| Scheduler/event/notification | **Bekerja** | Notifikasi durable terkirim (task selesai/gagal/approval), preferensi bertahan restart; FCM memakai access token OAuth2 dari service account. Sisa: kredensial Google belum disuntikkan (Gap 2), tanpa verifikasi signature event, tanpa dead-letter |
| Windows Agent capability-limited | Sebagian | Dispatch, identitas kriptografis, dan allowlist teks-perintah/biner sudah nyata; sisa: sesi device in-memory (dimitigasi dengan grace reconnect, tetap tidak persisten), private key di webview `localStorage`, dan allowlist belum diuji di perangkat Windows nyata |
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
7. **Tabel `artifacts` dan `memories` tanpa migrasi — DITUTUP 2026-10-14.** Keduanya sudah dibereskan (`memories` punya migrasi `0007`, `artifacts` dihapus dari schema), dan kelas bug ini kini dicegah oleh `apps/api/test/schema-parity.test.ts`: database sementara dibangun dari seluruh migrasi lalu dibandingkan dengan `schema.ts` (tabel, kolom, dan tipe). Diverifikasi menangkap dua arah drift: kolom hantu di `schema.ts` dan `resource_id` yang dikembalikan ke `uuid`.
8. **VPS 2 OCPU / 11 GiB tanpa swap** dengan worker 2048m + Chromium. Belum ada bukti beban puncak.

---

## 6. Urutan implementasi yang aman

Setiap milestone harus menghasilkan bukti yang dapat diulang. Tidak ada milestone yang dimulai sebelum milestone sebelumnya terverifikasi.

| Milestone | Acceptance criteria terukur |
|---|---|
| **M0. Koreksi kebenaran dokumen** | `docs/final-audit.md` dan `docs/capability-matrix.yaml` tidak lagi menyatakan LULUS untuk memory, recovery, evaluator, research, Windows dispatch, dan notifikasi. Setiap status punya bukti live atau diturunkan ke `partial`/`not_implemented`. Tanpa perubahan kode. |
| **M1. Recovery task** | Task `running` yang ditinggal restart worker kembali dieksekusi otomatis tanpa duplikasi side effect. Test regresi memanggil `recoverInterruptedTasks(queue)` sungguhan dan gagal bila task tetap `running` setelah worker hidup. Reproduksi live: task `running/40` → restart → `completed`. |
| **M2. Memory durable** | **SELESAI untuk persistensi (2026-10-13).** Migrasi `0007_memories.sql` + `vector(1536)` + 5 index; memori bertahan setelah restart API (create → restart → list masih 1, terverifikasi live). Fallback senyap ke `InMemoryMemoryStore` dihapus. `:id` divalidasi uuid, jadi `GET`/`DELETE /v1/memories/search` → `400`, bukan `500`. **Belum**: provider embedding (9Router tidak menyediakan) dan sweeper retention memori (sweeper 2026-10-14 hanya mencakup artifact). |
| **M3. Evaluator berbasis bukti** | **SELESAI (2026-10-13).** `LocalCodingEnvironment` (`packages/agent-core/src/coding/local-environment.ts`) menjalankan `node --run lint/typecheck/test/build` di workspace per task; `createDefaultEnvironment()` yang mengembalikan `{passed:true}` dihapus. Worker memberi setiap task coding workspace git sendiri di `CODING_WORKSPACE_ROOT=/app/data/workspaces` (named volume `coding-workspaces`). `executeRegisteredTool` menjalankan `GenericEvaluator` sebelum `completed`. Bukti live: workspace dengan `lint` keluar 1 → `failed` (`score 0.71`); workspace dengan script lulus → `completed` (`score 1`, artifact diff nyata). **Belum**: acceptance criteria belum dipersist sebelum eksekusi, sehingga `GenericEvaluator` pada jalur tool masih memakai kriteria default. |
| **M4. Windows dispatch + identitas perangkat** | **SELESAI (2026-10-13 dispatch, 2026-10-14 identitas + allowlist).** Task dengan `payload.targetDevice` mengirim `command.execute` melalui WSS ke device yang online, menerima hasil, dan menyimpannya sebagai artifact: `TaskExecutor` meminta presence lewat `DeviceDispatcher.listOnlineDevices`, worker memakai `HttpDeviceDispatcher` (`apps/agent-worker/src/device-dispatcher.ts`) ke route internal ber-token `POST /v1/internal/device-commands` (`apps/api/src/routes/device-commands.ts`) — Caddy menutup `/v1/internal/*` dengan `404`, jadi hanya terjangkau dari network Docker internal. Aksi `device:command` berisiko HIGH dan tidak diizinkan tanpa approval (`packages/permissions/src/engine.ts:127`); fingerprint memuat teks perintah + `deviceId`, jadi satu approval tidak mengotorisasi perintah lain. **Identitas kriptografis (2026-10-14)**: agent menandatangani `device.challenge` dengan keypair P-256, `deviceId` diterbitkan server (`DEVICE_IDENTITY_REQUIRED` bila agent mengklaim sendiri), `devices.public_key` diisi JWK kanonik, dan key yang sama selalu memetakan ke baris device yang sama (migrasi `0008_device_key_identity.sql`). **Allowlist teks-perintah/biner (2026-10-14)**: `assertCommandAllowed` (`apps/windows/src/security/command-allowlist.ts`) menegakkan deny-by-default di `CommandExecutor` dan `TauriCommandExecutor` sebelum spawn, dengan aturan berasal dari `CapabilityRegistry` lokal dan pemeriksaan ulang di Rust (`execute_local_command`). **Grace reconnect (2026-10-14)**: dispatch menunggu agent kembali sampai `DEVICE_RECONNECT_GRACE_MS`, dan task yang sudah disetujui melewati gate presence, sehingga API restart tidak membakar approval. **Belum**: sesi device tetap in-memory (tidak persisten), private key di `localStorage` webview, dan allowlist belum diuji di perangkat Windows nyata. |
| **M5. Notifikasi + scheduler** | **SELESAI (2026-10-14).** `NotificationEngine` di API memakai `SqlNotificationRepository` + `createFcmProviderFromEnv()`; `broadcaster.subscribe(createTaskNotificationListener(...))` (`apps/api/src/services/task-notifications.ts`) mengubah event task Redis menjadi baris `notifications` durable dengan `delivery_state`/`deep_link`. Bukti live: task selesai terjadwal → `task_completed`/`delivered`; task gagal (device offline) → `task_failed`/`failed` + `last_error` jujur; event `task.waiting_approval` di channel `personal-ai-os:events:all` → `approval_required`/`failed` deep link approval; preferensi bertahan `docker compose restart api`; `devices.push_token` terisi lewat `POST /v1/devices/:id/push-token` (204/404/400). FCM memakai access token OAuth2 dari service account (`ServiceAccountTokenSource`, JWT RS256 → `token_uri`), literal `dummy-env-token` dihapus. Dispatcher duplikat di API dihapus; `tick()` hanya di container `scheduler`. **Belum**: pengiriman sungguhan ke Google (`FCM_SERVICE_ACCOUNT_JSON` belum diisi), tanpa dead-letter, tanpa verifikasi signature event. |
| **M6. Research** | **SELESAI (2026-10-13).** Provider pencarian nyata terdaftar: `duckDuckGoSearch` (`packages/tools/src/builtin/web-search.ts`) di `createDefaultToolRegistry` (`packages/tools/src/registry/create-default-tool-registry.ts:20-21`), tanpa API key. `LocalResearchEnvironment` (`packages/agent-core/src/research/local-environment.ts`) mencari lewat `web_search` dan membuka setiap hasil lewat `web_fetch`, keduanya melalui `ToolRegistry` ber-permission (`web:search`/`web:fetch`). Sumber dan claim hardcoded dihapus; klaim terikat ke URL yang benar-benar di-fetch. Bukti live: query nyata → `completed` (`score 1`, 5 sumber nyata, 5 klaim tertaut); query tanpa hasil → `failed` (`score 0`, `No valid sources provided`). **Belum**: sintesis klaim lintas sumber oleh `ModelGateway` — klaim masih kutipan awal halaman, sehingga relevansi terhadap pertanyaan belum dinilai; `ResearchEvaluator` juga belum mem-fetch URL sendiri. |
| **M7. Audit menyeluruh** | **SELESAI (2026-10-14).** `SecuredCapabilityGuard` (`packages/permissions/src/guard.ts`) menulis **satu baris `audit_logs` per pemanggilan**, setelah hasil diketahui (`metadata.outcome` `success`/`failure` + `durationMs` + `error`); guard diberi `auditLogger` di API (`apps/api/src/index.ts`) dan worker (`apps/agent-worker/src/index.ts`). Artifact write diaudit lewat `ArtifactManager.auditSink` (`packages/tools/src/artifacts/artifact-manager.ts`). `audit_logs.resource_id` diubah `uuid` → `varchar(512)` (migrasi `0010_audit_resource_id_text.sql`). Bukti live: `audit_logs` 38 baris, termasuk `web:fetch`/`web:search` (tool call), `tool:mcp_echo_echo` (MCP call, `resource_type: external_mcp`), `browser:navigate` (browser action), dan `artifact:write`; SSRF `169.254.169.254` tercatat `allow | failure` dengan pesan error nyata. Bukan `console.log`. |
| **M8. Kebersihan dan pengerasan (2026-10-14)** | **SELESAI.** (a) Dead code dihapus: `AiCouncil` + `SelfHealingEngine` beserta test-nya (agent-core 40 → 31 test). (b) Upload artifact streaming `POST /v1/artifacts/stream` (byte mentah, batas 25 MiB, `putStream`) + validasi magic bytes + unduhan streaming lewat `getArtifactStream`. (c) Sweeper retention artifact dengan interval env. (d) Batas laju/konkurensi tool (`ExecutionLimiter` di `ToolRegistry.executeTool`, berlaku juga untuk tool MCP) dan batas per runtime (`RuntimeManager.execute`), plus normalisasi `timeoutMs` tak finit. (e) Worker healthcheck memprobe Postgres `select 1` + Redis `PING` sebelum me-refresh `/tmp/healthy`. (f) Allowlist teks-perintah/biner di agent Windows (lihat M4). (g) Sesi device: dispatch menunggu reconnect, approved resume melewati gate presence. Bukti: `packages/tools/test/execution-limiter.test.ts`, `packages/mcp/test/registry-limits.test.ts`, `packages/agent-core/test/runtime-limits.test.ts`, `apps/agent-worker/test/health.test.ts`, `apps/api/test/artifacts.test.ts`, `apps/api/test/device-commands.test.ts`, `apps/agent-worker/test/device-dispatch.test.ts`, `apps/windows/test/command-allowlist.test.ts`; suite API 66/66, `pnpm lint` 14/14, `pnpm build` 14/14, `pnpm verify:audit` sukses. **Belum**: retensi memori, `accessPolicy: 'project_members'`, alerting/tracing, dan semua bukti perangkat fisik. |

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

# 4. Audit menyeluruh (M7, 2026-10-14)
#    Sebelum: SELECT action, count(*) FROM audit_logs GROUP BY action; -> hanya approval:approved|denied
#    Sesudah: tool call, MCP call, browser action, dan artifact write semuanya tercatat.
export RUNTIME_BRIDGE_TOKEN="$(docker exec personal-ai-os-worker-1 printenv RUNTIME_BRIDGE_TOKEN)"
docker compose run --rm migrate          # menerapkan 0010_audit_resource_id_text.sql
docker compose build api worker scheduler && docker compose up -d api worker scheduler
# POST /v1/tasks {kind:"research_task", payload:{query:"postgres advisory locks"}} -> completed
# POST /v1/tasks {kind:"generic", payload:{toolName:"browser_navigate", toolInput:{url:"https://example.com"}}}
# POST /v1/tasks {kind:"generic", payload:{toolName:"mcp_echo_echo", toolInput:{text:"audit-mcp"}}}
#   -> waiting_approval (action "tool:mcp_echo_echo") -> POST /v1/approvals/<id>/approve -> completed
docker exec personal-ai-os-postgres-1 psql -U personal_ai_os -d personal_ai_os \
  -c "SELECT action, resource_type, count(*) FROM audit_logs GROUP BY action, resource_type ORDER BY 3 DESC;"
#   -> web:fetch | global | 13 ; web:search | global | 3 ; tool:search_knowledge | workspace | 3
#   -> tool:mcp_echo_echo | external_mcp | 2 ; artifact:write | artifact | 2 ; browser:navigate | global | 1
docker exec personal-ai-os-postgres-1 psql -U personal_ai_os -d personal_ai_os \
  -c "SELECT action, resource_id, decision, metadata->>'outcome', metadata->>'error' FROM audit_logs
      WHERE action = 'web:fetch' AND metadata->>'outcome' = 'failure';"
#   -> web:fetch | http://169.254.169.254/latest/meta-data/ | allow | failure | SSRF Protection: …

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
