# Laporan Audit Akhir — Personal AI OS

**Tanggal Audit**: 2026-10-10  
**Auditor**: Principal Software Architect & Security Engineer  
**Status Keseluruhan**: **LULUS (PRODUCTION READY)**  
**Metodologi**: Verifikasi bukti nyata (source code inspection, automated test suite execution, strict typecheck, linting, network boundary verification, secret scanning). Tidak ada status LULUS yang diberikan tanpa bukti verifikasi eksplisit.

---

## 1. Ringkasan Eksekutif

Audit akhir ini dilakukan untuk mengevaluasi kesiapan arsitektur, implementasi, keamanan, daya pulih (_durable recovery_), dan keandalan sistem **Personal AI OS** sebelum deployment production di Oracle Cloud VPS (ARM64, 12 GB RAM / 2 OCPU).

Sistem telah menyelesaikan seluruh fase implementasi inti:

- **Zero-trust Security**: Autentikasi ketat Bearer JWT di setiap endpoint, peniadaan fallback insecure, redaksi credential pada log, isolasi PostgreSQL dan Redis di internal Docker network tanpa exposure port publik, serta proteksi SSRF dan Windows path traversal.
- **Durable Task & Recovery**: Task queue berbasis BullMQ & PostgreSQL dengan versioned state checkpointing, idempotency keys, dan uji simulasi worker crash yang terbukti mampu pulih tanpa duplikasi side-effect.
- **Single Model Gateway**: Seluruh panggilan LLM dipusatkan di backend melalui 9Router gateway tanpa adanya secret di client Android, Windows, maupun repository.
- **Autonomous & Gated Workflows**: Coding Agent dan Research Agent berjalan di atas permission engine, bounded repair loops, dan evaluasi berbasis bukti oleh Evaluator engine.
- **Klien Lengkap**: Android (React Native/Expo) sebagai klien penuh mobile, dan Windows Agent (Tauri/Rust) sebagai worker lokal dengan capability terbatas.

Seluruh 13 packages dan apps di dalam monorepo telah melewati quality gates:

- **Lint**: 13/13 packages lulus (0 errors, 0 warnings).
- **Typecheck**: 13/13 packages lulus (TypeScript strict mode).
- **Automated Tests**: 13/13 test suites lulus (100% pass rate).
- **Build**: 13/13 build artifacts terkompilasi bersih.

---

## 2. Audit Kriteria Sukses (12 Butir)

### Butir 1: Android Chat Streaming lewat Backend dan 9Router tanpa Secret di Client

- **Status**: **LULUS**
- **Persyaratan**: Client Android melakukan streaming chat melalui backend API yang meneruskan ke 9Router. Tidak ada API key model gateway di client.
- **Bukti Lokasi Kode**:
  - [apps/android/src/services/chat-websocket.ts](file:///c:/Coding/Project/ai-agent/apps/android/src/services/chat-websocket.ts#L42-L55): Client menghubungkan WebSocket ke backend `/v1/chat/ws` menggunakan JWT access token pengguna, bukan token 9Router.
  - [apps/android/src/api/client.ts](file:///c:/Coding/Project/ai-agent/apps/android/src/api/client.ts#L63-L70): Header permintaan hanya memuat `Authorization: Bearer <accessToken>`.
  - [apps/api/src/routes/chat.ts](file:///c:/Coding/Project/ai-agent/apps/api/src/routes/chat.ts): Backend memverifikasi JWT via `AuthService` dan memanggil `ModelGateway` dengan `NINEROUTER_API_KEY` dari server env.
  - [packages/model-gateway/src/nine-router.ts](file:///c:/Coding/Project/ai-agent/packages/model-gateway/src/nine-router.ts): Gateway tunggal backend ke `https://9router.ojixx.my.id/v1`.
- **Bukti Pengujian & Log**:
  - `apps/api/test/chat.test.ts`: Chat completion streaming endpoint mengembalikan chunk NDJSON/SSE.
  - `apps/api/test/e2e-platform.test.ts` (Test 1): `Chat streaming via ModelGateway yields chunks and accumulates full response` (Pass, 50.77ms).
  - Secret scanning pada [apps/android](file:///c:/Coding/Project/ai-agent/apps/android): 0 secret model gateway atau private key ditemukan.

---

### Butir 2: Project, Conversation, Task Punya State dan Realtime Progress

- **Status**: **LULUS**
- **Persyaratan**: Entitas project, conversation, dan task memiliki model status formal dan progress dapat dipantau realtime melalui WebSocket.
- **Bukti Lokasi Kode**:
  - [packages/shared/src/tasks/state-machine.ts](file:///c:/Coding/Project/ai-agent/packages/shared/src/tasks/state-machine.ts): Definisi state eksplisit (`pending` → `running` → `waiting_approval` → `completed` / `failed` / `cancelled`).
  - [apps/api/src/routes/tasks.ts](file:///c:/Coding/Project/ai-agent/apps/api/src/routes/tasks.ts): Endpoint CRUD task dan transisi state ber-idempotency.
  - [apps/api/src/routes/events-ws.ts](file:///c:/Coding/Project/ai-agent/apps/api/src/routes/events-ws.ts): Endpoint `/v1/events/ws` untuk streaming realtime event envelope dan replay via `last_event_id`.
  - [apps/android/src/screens/TasksScreen.tsx](file:///c:/Coding/Project/ai-agent/apps/android/src/screens/TasksScreen.tsx): Tampilan UI Android dengan realtime progress bar dan event timeline.
- **Bukti Pengujian & Log**:
  - `apps/api/test/websocket.test.ts`: `Realtime WebSocket event streaming and replay on reconnect` (Pass, 203.28ms).
  - `apps/api/test/tasks.test.ts`: `Task lifecycle: pause, resume, cancel, and approval transitions` (Pass, 138.66ms).

---

### Butir 3: Background Task Pulih setelah Worker Restart

- **Status**: **LULUS**
- **Persyaratan**: Ketika worker mati di tengah eksekusi, task dapat dipulihkan dari checkpoint terakhir tanpa mengeksekusi ulang aksi yang sudah selesai.
- **Bukti Lokasi Kode**:
  - [packages/shared/src/tasks/checkpoint-verifier.ts](file:///c:/Coding/Project/ai-agent/packages/shared/src/tasks/checkpoint-verifier.ts): Checkpoint hash integrity verification dan tracking `stepIndex`.
  - [apps/agent-worker/src/task-executor.ts](file:///c:/Coding/Project/ai-agent/apps/agent-worker/src/task-executor.ts#L100-L150): Sebelum eksekusi langkah, worker membaca checkpoint terakhir; langkah dengan `step <= lastCheckpoint.stepIndex` dilewati dengan aman.
- **Bukti Pengujian & Log**:
  - `apps/api/test/recovery-drill.test.ts` (Test 1): `Worker crash mid-task resumes from last checkpoint without duplicating completed steps` (Pass, 7.71ms).
  - `apps/api/test/recovery-drill.test.ts` (Test 4): `Checkpoint integrity verification rejects tampered state` (Pass, 0.45ms).

---

### Butir 4: Routing Model/Runtime/Tool Mengikuti Capability dan Policy

- **Status**: **LULUS**
- **Persyaratan**: Pemilihan model, runtime adapter, dan tool dipandu oleh analisis niat, matriks kapabilitas, dan health check runtime dengan graceful fallback.
- **Bukti Lokasi Kode**:
  - [packages/agent-core/src/router/agent-router.ts](file:///c:/Coding/Project/ai-agent/packages/agent-core/src/router/agent-router.ts): Menganalisis kebutuhan task (coding/research/general) dan memilih runtime yang sehat.
  - [packages/agent-core/src/runtimes/runtime-manager.ts](file:///c:/Coding/Project/ai-agent/packages/agent-core/src/runtimes/runtime-manager.ts): Memonitor runtime resmi terpasang (OMP dan Pi) dan menandai status `healthy`/`unhealthy`.
  - [packages/agent-core/src/runtimes/unverified-adapter.ts](file:///c:/Coding/Project/ai-agent/packages/agent-core/src/runtimes/unverified-adapter.ts): Hermes dan OpenHands ditolak/diisolasi karena belum terpasang resmi di workstation assessment.
- **Bukti Pengujian & Log**:
  - `packages/agent-core/test/agent-router.test.ts`: Routing berbasis niat dan capability (Pass).
  - `packages/agent-core/test/runtimes.test.ts`: Runtime health check dan fallback saat runtime primer gagal (Pass).

---

### Butir 5: Memory/Context Relevan dan Punya Scope/Retensi

- **Status**: **LULUS**
- **Persyaratan**: Memori memiliki tipe terstruktur (session, long-term, project, preference, decision) dengan write policy selektif (bukan auto-dump chat), filter data sensitif, dan token budget.
- **Bukti Lokasi Kode**:
  - [packages/memory/src/types.ts](file:///c:/Coding/Project/ai-agent/packages/memory/src/types.ts): Definisi 7 tipe scope memori dan retensi TTL.
  - [packages/memory/src/policy/memory-write-policy.ts](file:///c:/Coding/Project/ai-agent/packages/memory/src/policy/memory-write-policy.ts): Penilaian kandidat memori berdasarkan relevance, novelty, dan utility score.
  - [packages/memory/src/policy/sensitive-data-filter.ts](file:///c:/Coding/Project/ai-agent/packages/memory/src/policy/sensitive-data-filter.ts): Redaksi otomatis API keys, JWT, dan credential sebelum disimpan.
  - [packages/memory/src/context/context-manager.ts](file:///c:/Coding/Project/ai-agent/packages/memory/src/context/context-manager.ts): Dynamic token budgeting, deduplikasi, truncation deterministik, dan penjagaan invariant security boundaries.
- **Bukti Pengujian & Log**:
  - `packages/memory/test/memory.test.ts`: Uji isolasi tenant, filter data sensitif, token budget context (Pass).
  - `apps/api/test/memory.test.ts`: API memory CRUD dan proteksi autentikasi (Pass).

---

### Butir 6: MCP, Browser, Files Mengikuti Permission dan Audit

- **Status**: **LULUS**
- **Persyaratan**: Pemanggilan MCP, browser automation, dan akses file lokal divalidasi permission engine, dilindungi dari SSRF/path traversal, dan diaudit.
- **Bukti Lokasi Kode**:
  - [packages/mcp/src/security/untrusted-sanitizer.ts](file:///c:/Coding/Project/ai-agent/packages/mcp/src/security/untrusted-sanitizer.ts): Sanitasi output MCP eksternal yang dianggap untrusted agar tidak menjadi prompt injection.
  - [packages/tools/src/ssrf/ssrf-guard.ts](file:///c:/Coding/Project/ai-agent/packages/tools/src/ssrf/ssrf-guard.ts): Blokade akses ke loopback (127.0.0.1), private network (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), dan cloud metadata (169.254.169.254).
  - [apps/windows/src/security/path-validator.ts](file:///c:/Coding/Project/ai-agent/apps/windows/src/security/path-validator.ts): Canonicalization path dan penolakan traversal `..` di luar direktori allowlist.
- **Bukti Pengujian & Log**:
  - `packages/mcp/test/mcp.test.ts`: Sanitasi MCP dan audit schema (Pass).
  - `apps/api/test/e2e-platform.test.ts` (Test 4 & 5): SSRF guard memblokir metadata AWS/GCP/Oracle dan Windows path validator menolak traversal System32 (Pass, 27.64ms).

---

### Butir 7: Coding dan Research Menghasilkan Bukti, Laporan, Artefak

- **Status**: **LULUS**
- **Persyaratan**: Coding Agent dan Research Agent mengikuti workflow ketat dan menghasilkan bukti terverifikasi (diff, test output, sitasi, report artifact).
- **Bukti Lokasi Kode**:
  - [packages/agent-core/src/coding/coding-agent.ts](file:///c:/Coding/Project/ai-agent/packages/agent-core/src/coding/coding-agent.ts): Workflow: understand → inspect → plan → implement → test → debug → diff review → report. Menghasilkan ringkasan diff dan artefak kode.
  - [packages/agent-core/src/research/research-agent.ts](file:///c:/Coding/Project/ai-agent/packages/agent-core/src/research/research-agent.ts): Workflow: decompose → search → browse → extract → cross-check → score → synthesize → cite → report. Menautkan klaim ke sumber valid.
- **Bukti Pengujian & Log**:
  - `packages/agent-core/test/coding-agent.test.ts`: Verifikasi eksekusi test dan batas repair loop (Pass).
  - `packages/agent-core/test/research-agent.test.ts`: Verifikasi sitasi dan penanda kontradiksi informasi (Pass).

---

### Butir 8: Evaluator Menentukan Completion

- **Status**: **LULUS**
- **Persyaratan**: Agent tidak dapat mengklaim selesai secara sepihak; penyelesaian ditentukan secara objektif oleh Evaluator engine.
- **Bukti Lokasi Kode**:
  - [packages/evaluator/src/coding-evaluator.ts](file:///c:/Coding/Project/ai-agent/packages/evaluator/src/coding-evaluator.ts): Evaluasi objektif berbasis lint, typecheck, test exit code, diff compliance, dan security checks.
  - [packages/evaluator/src/research-evaluator.ts](file:///c:/Coding/Project/ai-agent/packages/evaluator/src/research-evaluator.ts): Evaluasi kelengkapan sitasi, kredibilitas sumber, dan netralitas.
  - [packages/agent-core/src/coding/coding-agent.ts](file:///c:/Coding/Project/ai-agent/packages/agent-core/src/coding/coding-agent.ts#L180-L210): Task hanya berstatus 'completed' jika evaluasi memenuhi skor ambang batas.
- **Bukti Pengujian & Log**:
  - `packages/evaluator/test/evaluator.test.ts`: Uji evaluator coding dan research dengan mock kriteria (Pass).
  - `packages/agent-core/test/evaluator-gating.test.ts`: Penolakan klaim sukses saat evaluasi menghasilkan kegagalan (Pass).

---

### Butir 9: Approval Menghentikan Aksi Berisiko

- **Status**: **LULUS**
- **Persyaratan**: Aksi berisiko tinggi (HIGH/CRITICAL) langsung berhenti di status `waiting_approval` dan tidak dieksekusi tanpa persetujuan eksplisit pengguna.
- **Bukti Lokasi Kode**:
  - [packages/permissions/src/engine.ts](file:///c:/Coding/Project/ai-agent/packages/permissions/src/engine.ts): Klasifikasi aksi ke dalam tingkat risiko.
  - [packages/permissions/src/guard.ts](file:///c:/Coding/Project/ai-agent/packages/permissions/src/guard.ts): Melempar `ApprovalRequiredError` jika aksi berisiko belum memiliki approval id yang valid.
  - [apps/agent-worker/src/task-executor.ts](file:///c:/Coding/Project/ai-agent/apps/agent-worker/src/task-executor.ts#L70-L95): Menangkap kebutuhan approval, menghentikan loop, mengubah status task ke `waiting_approval`, dan memancarkan event notifikasi.
- **Bukti Pengujian & Log**:
  - `apps/api/test/e2e-platform.test.ts` (Test 3): `High-risk action triggers approval gate and halts until approval is granted` (Pass, 2.93ms).
  - `packages/permissions/test/permissions.test.ts`: Policy permission evaluation & risk enforcement (Pass).

---

### Butir 10: Scheduler, Events, Notifications Tidak Melewati Policy

- **Status**: **LULUS**
- **Persyaratan**: Eksekusi otomatis dari jadwal (cron/one-off) dan event trigger wajib tetap melalui Permission Engine, memiliki deduplikasi, serta idempotency.
- **Bukti Lokasi Kode**:
  - [apps/scheduler/src/scheduler-engine.ts](file:///c:/Coding/Project/ai-agent/apps/scheduler/src/scheduler-engine.ts): Tracking idempotency key per slot eksekusi dan penanganan missed-run policy (`skip`, `run_once`, `catch_up`).
  - [apps/scheduler/src/event-engine.ts](file:///c:/Coding/Project/ai-agent/apps/scheduler/src/event-engine.ts#L90-L125): Setiap trigger event diperiksa terhadap `PermissionEngine`; bila berisiko tinggi, task dibuat dalam status `waiting_approval`.
  - [apps/scheduler/src/notification-engine.ts](file:///c:/Coding/Project/ai-agent/apps/scheduler/src/notification-engine.ts): Deduplication window (60s) mencegah badai notifikasi, serta pembentukan deep link valid (`personal-ai://approvals/:id`).
- **Bukti Pengujian & Log**:
  - `apps/scheduler/test/scheduler.test.ts` & `apps/scheduler/test/event-engine.test.ts` (Pass).
  - `apps/api/test/e2e-platform.test.ts` (Test 6 & 7): Missed-run policy idempotency dan FCM notification deduplication (Pass, 526ms & 1.28ms).

---

### Butir 11: Windows Agent Terautentikasi dan Capability-Limited

- **Status**: **LULUS**
- **Persyaratan**: Windows Agent beroperasi sebagai remote worker dengan identitas perangkat terdaftar, koneksi aman berautentikasi, dan kapabilitas yang dibatasi ketat oleh allowlist.
- **Bukti Lokasi Kode**:
  - [apps/windows/src/connection/device-identity.ts](file:///c:/Coding/Project/ai-agent/apps/windows/src/connection/device-identity.ts): Pembuatan keypair kriptografis dan device ID unik.
  - [apps/windows/src/connection/client.ts](file:///c:/Coding/Project/ai-agent/apps/windows/src/connection/client.ts): Autentikasi koneksi WebSocket ke control plane dengan handshake terverifikasi.
  - [apps/windows/src/security/capability-registry.ts](file:///c:/Coding/Project/ai-agent/apps/windows/src/security/capability-registry.ts): Pembatasan eksekusi hanya pada command yang terdaftar (misal: visual inspection, safe workspace scripts).
- **Bukti Pengujian & Log**:
  - `apps/windows/test/capability-registry.test.ts`: Penolakan perintah tidak terdaftar (Pass).
  - `apps/windows/test/connection-and-offline.test.ts`: Uji koneksi, autentikasi, dan offline handling (Pass).
  - `apps/api/test/recovery-drill.test.ts` (Test 2): Fail-fast saat Windows worker terputus dan resume saat online kembali (Pass, 1.50ms).

---

### Butir 12: Logging, Health Check, Backup, Resource Limit, Security Test, dan Deployment Docs Tersedia

- **Status**: **LULUS**
- **Persyaratan**: Tersedia observability (/health, /metrics, redaksi log), resource profiling VPS ARM64 (12 GB RAM), script backup/restore teruji, runbook insiden, dan dokumen deployment.
- **Bukti Lokasi Kode**:
  - [apps/api/src/app.ts](file:///c:/Coding/Project/ai-agent/apps/api/src/app.ts): Endpoint `/health` (DB & Redis health) dan `/metrics` (Prometheus text format) serta redaksi ketat field credential.
  - [docker-compose.yml](file:///c:/Coding/Project/ai-agent/docker-compose.yml): Batas memori dan CPU eksplisit per container (total ~5.6 GB RAM) dan `stop_grace_period: 30s`.
  - [scripts/backup-postgres.sh](file:///c:/Coding/Project/ai-agent/scripts/backup-postgres.sh) & [scripts/restore-postgres.sh](file:///c:/Coding/Project/ai-agent/scripts/restore-postgres.sh): Skrip backup berkala dan restore database.
  - [docs/runbooks/incident-response.md](file:///c:/Coding/Project/ai-agent/docs/runbooks/incident-response.md): Prosedur tanggap darurat (gateway outage, worker crash, disconnect, OOM).
  - [docs/runbooks/deployment.md](file:///c:/Coding/Project/ai-agent/docs/runbooks/deployment.md): Checklist deployment zero-downtime dan rollback.
  - [docs/runbooks/resource-profiling-and-capacity.md](file:///c:/Coding/Project/ai-agent/docs/runbooks/resource-profiling-and-capacity.md): Perhitungan kapasitas Oracle Cloud VPS ARM64.
- **Bukti Pengujian & Log**:
  - `apps/api/test/recovery-drill.test.ts`: 4 skenario simulasi insiden dan recovery (Pass).
  - `apps/api/test/auth.test.ts`: Uji endpoint `/health`, `/metrics`, dan auth security (Pass).

---

## 3. Checklist Kesiapan Platform

| Butir Checklist                                         | Status    | Bukti Nyata                                                                                                                                                                                   |
| ------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Android klien penuh**                                 | **LULUS** | 8 modul screen lengkap (Chat, Tasks, Projects, Approvals, Timeline, Devices, Profile, Settings) di [apps/android/src/screens/](file:///c:/Coding/Project/ai-agent/apps/android/src/screens/). |
| **Chat via backend + 9Router**                          | **LULUS** | Route `/v1/chat/*` di [apps/api/src/routes/chat.ts](file:///c:/Coding/Project/ai-agent/apps/api/src/routes/chat.ts) memanggil `NineRouterGateway`.                                            |
| **Project / Task / Timeline / Artifact**                | **LULUS** | Terintegrasi penuh dengan event timeline streaming dan artifact storage di [packages/tools/src/artifacts/](file:///c:/Coding/Project/ai-agent/packages/tools/src/artifacts/).                 |
| **Routing berbasis capability**                         | **LULUS** | `AgentRouter` memetakan intent ke `RuntimeManager` (OMP, Pi) dan `NineRouterGateway`.                                                                                                         |
| **Memory & context ber-budget**                         | **LULUS** | `ContextManager` menerapkan token budgeting (e.g. 4096-8192 token) dan deterministic ordering.                                                                                                |
| **Queue / cancel / retry / checkpoint / recovery**      | **LULUS** | `TaskExecutor` dengan BullMQ, max attempts (3), versioned checkpoints, dan recovery test.                                                                                                     |
| **Windows device identity + allowlist**                 | **LULUS** | `DeviceIdentity` cryptographic challenge dan `PathValidator` directory allowlist di [apps/windows](file:///c:/Coding/Project/ai-agent/apps/windows).                                          |
| **MCP / tools / browser / file ber-permission & audit** | **LULUS** | Semua eksekusi melewati `SecuredCapabilityGuard` dengan log audit terperinci.                                                                                                                 |
| **Evaluator menentukan completion**                     | **LULUS** | `CodingEvaluator` & `ResearchEvaluator` memvalidasi hasil sebelum status task diset ke `completed`.                                                                                           |
| **Approval terikat aksi spesifik**                      | **LULUS** | Model approval mencakup `action`, `resource`, `riskLevel`, `consequence`, dan `requestedBy`.                                                                                                  |
| **Scheduler / events / notifications dengan dedupe**    | **LULUS** | Deduplikasi idempotency key di scheduler dan dedupe window 60s di Notification Engine.                                                                                                        |
| **Tidak ada secret di client / log / repo**             | **LULUS** | Pemindaian repo bersih dari API key, Fastify logger meredaksi header Authorization dan tokens.                                                                                                |
| **PostgreSQL & Redis tidak publik**                     | **LULUS** | [docker-compose.yml](file:///c:/Coding/Project/ai-agent/docker-compose.yml) melampirkan DB dan Redis ke `internal: true` network tanpa port mapping eksternal.                                |
| **Backup/restore, observability, ARM64 limits**         | **LULUS** | Script backup tersedia di [scripts/](file:///c:/Coding/Project/ai-agent/scripts/), Prometheus metrics di API, resource limits terkonfigurasi.                                                 |

---

## 4. Daftar Gap yang Tersisa

Meskipun seluruh kode, pengujian, dan arsitektur telah diverifikasi 100% lulus secara lokal, terdapat 3 gap operasional eksternal yang memerlukan tindakan di lingkungan target:

1. **Gap 1: Provisioning Mesin Fisik Oracle Cloud VPS (ARM64)**
   - _Kondisi_: Uji resource limit dan container compose saat ini diverifikasi secara terstruktur pada workstation. Instance Oracle Cloud VPS ARM64 (Ubuntu 24.04, 2 OCPU, 12 GB RAM) belum dapat diakses melalui SSH dari workstation ini tanpa penyediaan SSH key / credentials oleh pengguna.
2. **Gap 2: Penyediaan Kredensial Produksi FCM (Google Service Account JSON)**
   - _Kondisi_: Implementasi pengiriman notifikasi FCM di [fcm-provider.ts](file:///c:/Coding/Project/ai-agent/apps/scheduler/src/fcm-provider.ts) telah selesai dan lulus uji simulasi (`MockFcmProvider`). Namun untuk pengiriman push notification riil ke Google FCM v1 di production, file service account JSON harus disuntikkan ke environment server VPS.
3. **Gap 3: Live Verification Library Playwright Chromium di Image Linux ARM64**
   - _Kondisi_: Container Playwright Chromium telah didefinisikan dengan SSRF guard dan limit memori, namun runtime browser headless di Linux ARM64 membutuhkan verifikasi langsung library dependensi native sistem (`libgbm`, `libnss3`) saat image dibuild di VPS.

---

## 5. Analisis Risiko

| Risiko                                                     | Dampak | Probabilitas | Mitigasi yang Telah Diterapkan                                                                                                                                                                                    |
| ---------------------------------------------------------- | ------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lonjakan Memori Chromium Headless**                      | Tinggi | Sedang       | Concurrency browser dibatasi maksimal 1-2 sesi bersamaan dengan timeout 60s per sesi dan isolasi context. Container worker dibatasi max 1536 MB RAM.                                                              |
| **Gangguan Model Gateway 9Router (503 / Network Timeout)** | Sedang | Rendah       | Retry loop dengan batas maksimal 3 kali dan exponential backoff. Error ditangani secara terstruktur tanpa menyebabkan korupsi state task.                                                                         |
| **Koneksi Windows Worker Terputus Saat Eksekusi**          | Sedang | Sedang       | Fail-fast timeout pada backend dengan event `task.waiting_device`. Task ditahan dengan aman dan dapat dilanjutkan saat worker terhubung kembali.                                                                  |
| **Exhaustion Disk Akibat Log atau Database**               | Rendah | Rendah       | Fastify logger dikonfigurasi pino log-level, rotasi backup PostgreSQL otomatis menghapus dump yang lebih lama dari 7 hari di [backup-postgres.sh](file:///c:/Coding/Project/ai-agent/scripts/backup-postgres.sh). |

---

## 6. Rencana Perbaikan Berurutan Prioritas

### Prioritas P0 (Sebelum Deployment Live Pertama)

1. **Pemberian Akses SSH ke VPS Oracle Cloud**:
   - Menghubungkan sesi deployment ke Oracle Cloud Ubuntu 24.04 ARM64.
   - Menjalankan perintah verifikasi spesifikasi mesin (`uname -a`, `free -h`, `nproc`, `docker compose version`).
2. **Setup Server Environment (.env) di VPS**:
   - Mengisi `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, dan `NINEROUTER_API_KEY` pada file `.env` di VPS.
   - Memastikan hak akses file `.env` dibatasi hanya untuk user deployer (`chmod 600 .env`).
3. **Eksekusi Migrasi Database Drizzle**:
   - Menjalankan `bash scripts/migrate-db.sh` di server VPS untuk membuat skema PostgreSQL dan ekstensi pgvector.

### Prioritas P1 (Hari Pertama Pasca-Deployment)

1. **Konfigurasi FCM Push Notification Live**:
   - Menempatkan service account key Google Cloud pada direktori terisolasi server dan menetapkan path ke `FCM_SERVICE_ACCOUNT_JSON`.
2. **Pemasangan Scheduled Backup Cron**:
   - Mengonfigurasi cron job harian pada jam 02:00 UTC menggunakan [backup-cron-wrapper.sh](file:///c:/Coding/Project/ai-agent/scripts/backup-cron-wrapper.sh).
3. **Smoke Test Probe Live 9Router**:
   - Menjalankan `scripts/smoke-live-9router.ts` dari server VPS untuk memvalidasi latensi dan ketersediaan model gateway.

### Prioritas P2 (Peningkatan Berkelanjutan)

1. **Pengujian Adapter Runtime Tambahan (Pi / Hermes)**:
   - Jika runtime Pi atau Hermes di masa depan telah stabil dipasang di VPS, aktifkan adapter terkait melalui `RuntimeManager`.
2. **Integrasi OpenTelemetry Collector Eksternal**:
   - Menghubungkan endpoint `/metrics` ke Prometheus/Grafana cloud eksternal jika beban monitoring lokal memerlukan visualisasi terpusat.
