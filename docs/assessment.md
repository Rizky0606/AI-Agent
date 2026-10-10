# Assessment awal — Personal AI OS

Tanggal: 2026-10-09 (Asia/Jakarta)  
Ruang lingkup: audit read-only terhadap checkout ini dan workstation Windows yang menjalankan assessment. Hanya `docs/` dan `scripts/` ditulis. Tidak ada kode aplikasi yang dimodifikasi.

## Ringkasan eksekutif

Checkout fisik praktis kosong, tetapi bukan repository baru yang bersih: commit `6d43275` (`feat(p1.1): initialize monorepo foundation`) masih memiliki scaffold monorepo, dan semua file scaffold itu saat ini berstatus `D` di working tree. Hanya `AGENTS.md` dan direktori `docs/` yang ada secara fisik sebelum assessment. Penghapusan tersebut diperlakukan sebagai perubahan pengguna dan tidak dipulihkan.

Karena sumber aplikasi, manifest, `.env.example`, lockfile, dan test helper tidak ada secara fisik, instalasi, lint, typecheck, test, build, dan inspeksi runtime aplikasi tidak dapat dijalankan secara sah. Isi `HEAD` dibaca hanya untuk memahami fondasi yang hilang.

## Repository

### Git dan struktur

- Branch: `master`; commit terakhir: `6d43275`.
- `git status --short --branch` menunjukkan seluruh fondasi monorepo terhapus (`D`), serta `AGENTS.md` termodifikasi (`M`) sebelum pekerjaan ini.
- Struktur yang tercatat pada `HEAD`: `apps/{api,agent-worker,scheduler,web,android,windows}`, `packages/{agent-core,evaluator,mcp,memory,model-gateway,permissions,shared,task-system,ui}`, `runtimes/{pi,omp,hermes,openhands}-adapter`, `infrastructure/`, `scripts/`, `skills/`, dan `docs/`.
- Setiap `src/index.ts` pada `HEAD` hanya `export {};`: fondasi compile-safe, belum ada feature aplikasi.

### Dependency, environment, migrasi, test, dokumen

- Root pada `HEAD` memakai pnpm `10.13.1`, Turbo `2.5.2`, TypeScript `5.8.3`, ESLint `9.25.0`, dan Prettier `3.5.3`; engine Node `>=20`.
- Package workspace tidak mendeklarasikan dependency runtime. Ini belum memenuhi stack target (Fastify, Drizzle, PostgreSQL/pgvector, Redis/BullMQ, WebSocket, OpenTelemetry, React Native/Expo, Tauri/Rust).
- `.env.example` pada `HEAD` hanya mendefinisikan `NODE_ENV`, API host/port, `DATABASE_URL`, `REDIS_URL`, `NINEROUTER_API_KEY`, dan `JWT_SECRET`; file itu kini terhapus dari checkout. Tidak ada populated `.env` yang diperiksa atau dicetak.
- Tidak ada migrasi SQL/Drizzle pada `HEAD`; tidak ada konfigurasi Drizzle.
- Script test workspace semuanya `node --test`, tetapi satu-satunya helper `scripts/test.mjs` hanya mencetak “No tests configured…”. Tidak ada test file produk yang tercatat.
- Dokumen Phase 0 ada di `HEAD` (PRD hingga deployment/roadmap), tetapi seluruhnya terhapus dari checkout fisik. Dokumentasi assessment ini berdiri sendiri dan tidak menggantikan file yang dihapus.

## 9Router

Hasil verifikasi aktual dan instruksi rerun tersedia di [verification/9router.md](verification/9router.md). Endpoint dapat dicapai namun membalas `401` tanpa key; tidak ada fitur model yang boleh dianggap tersedia sampai probe terautentikasi dijalankan.

## VPS dan container (Data Aktual Empiris dari `servernic`)

Detail verifikasi dan log eksekusi lengkap tersedia di [verification/vps-and-runtimes.md](verification/vps-and-runtimes.md). Data berikut dikumpulkan langsung dari mesin Oracle Cloud VPS pengguna (`ubuntu@servernic`):

### 1. Spesifikasi Hardware dan OS VPS

- **Hostname & Arsitektur**: `servernic`, `aarch64` (ARM64), 2 OCPU (`nproc = 2`).
- **OS & Kernel**: Ubuntu 24.04.5 LTS (`noble`), Linux kernel `6.17.0-1018-oracle #18~24.04.1-Ubuntu SMP`.
- **Memori Fisik**: Total `11 GiB` (~12 GB nominal), Used `2.0 GiB`, Free `1.6 GiB`, Buff/Cache `8.5 GiB`, Available `9.7 GiB`. Swap: `0B` (tidak ada swap).
- **Penyimpanan Disk**: `/dev/sda1` kapasitas 174 GiB, Used 19 GiB (11%), Available 155 GiB.
- **Docker Engine & Compose**: Docker `29.8.2` (build `7fc2dff`), Docker Compose `v5.6.0`.

### 2. Port Listener dan Proses Host Aktif (`ss -tulpn`)

- **TCP 22**: `sshd` (SSH server).
- **TCP 80 & 443**: Web server / reverse proxy host (LISTEN).
- **TCP 111**: `rpcbind`.
- **TCP 631**: `cupsd` (IPP printing).
- **TCP 9119**: `hermes` (PID 613535, fd=10) — **Hermes daemon aktif berjalan**.
- **TCP 5432**: `127.0.0.1:5432` — PostgreSQL host lokal (LISTEN pada loopback).
- **TCP 8000**: `uvicorn`/`python` (PID 940273) (LISTEN).
- **UDP 53, 68, 111**: `systemd-resolved`, `dhclient`, `rpcbind`.

> [!IMPORTANT]
> Karena port loopback 5432 dan port 80/443 sudah berstatus LISTEN di host, database container PostgreSQL Personal AI OS **tidak boleh** mempublikasikan port 5432 ke host network (wajib tetap terisolasi di internal Docker network `internal: true`).

### 3. Ketersediaan Image ARM64 (`docker manifest inspect` di VPS)

Verifikasi manifest langsung di VPS mengonfirmasi dukungan arsitektur native `arm64`:

| Peran                 | Tag Image                                    | Status Manifest ARM64                         |
| --------------------- | -------------------------------------------- | --------------------------------------------- |
| PostgreSQL + pgvector | `pgvector/pgvector:pg17`                     | **TERVERIFIKASI** (`arm64`)                   |
| Redis                 | `redis:7-alpine`                             | **TERVERIFIKASI** (`arm64`)                   |
| Caddy                 | `caddy:2-alpine`                             | **TERVERIFIKASI** (`arm64`)                   |
| Node.js               | `node:22-bookworm-slim`                      | **TERVERIFIKASI** (`arm64`)                   |
| Playwright Chromium   | `mcr.microsoft.com/playwright:v1.57.0-noble` | Manifest ada, **live run belum diuji di VPS** |

## Runtime Agent (Hasil Verifikasi Aktual di VPS dan Workstation)

Pemeriksaan aktual `which hermes omp pi openhands` dan inspeksi versi menghasilkan status nyata berikut:

| Runtime       | Status VPS            | Status Workstation  | Versi & Path VPS                                                                                                                                  | Interface yang Terbukti                                           | Cara Menjalankan Non-Interaktif                                                       |
| ------------- | --------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Hermes**    | **TERPASANG & AKTIF** | tidak terpasang     | `Hermes Agent v0.20.5 (2026.8.19)`<br>Path: `/home/ubuntu/.local/bin/hermes`<br>Python 3.11.15, OpenAI SDK 2.24.0<br>PID: 613535 di port TCP 9119 | 1. CLI (`hermes`)<br>2. API daemon port `9119`                    | **Via API**: HTTP/RPC ke `http://127.0.0.1:9119`<br>**Via CLI**: `hermes -p "prompt"` |
| **OMP**       | **TERPASANG**         | terpasang (v18.8.4) | `omp/18.6.1`<br>Path: `/home/ubuntu/.local/bin/omp`                                                                                               | CLI (`omp`); opsi `--mode text\|json\|rpc\|rpc-ui`, command `acp` | `omp -p "prompt" --mode json` atau `--mode rpc`                                       |
| **Pi**        | **TIDAK TERPASANG**   | terpasang (v1.1.0)  | Tidak ada di PATH VPS (`which pi` kosong)                                                                                                         | CLI di workstation saja                                           | `pi -p "prompt" --mode json` (di workstation)                                         |
| **OpenHands** | **TIDAK TERPASANG**   | tidak terpasang     | Tidak ada di PATH VPS (`which openhands` kosong)                                                                                                  | —                                                                 | —                                                                                     |

### Hal-hal yang Masih Belum Teruji (Unverified)

1. **Autentikasi & Kontrak API Hermes Port 9119**: Skema endpoint (REST/WebSocket), payload format, dan autentikasi token untuk daemon port 9119 belum diuji dengan probe HTTP terautentikasi.
2. **Identitas Proses Port 8000**: Peran proses Uvicorn/Python (PID 940273) apakah terkait dashboard Hermes atau service pihak ketiga independen belum diinspeksi.
3. **Playwright Chromium ARM64 Live Execution**: Kemampuan menjalankan browser headless Chromium di dalam Docker container di Ubuntu ARM64 belum diuji live.
4. **Resiko Ketiadaan Swap (Swap = 0B)**: Mitigasi OOM killer bila konsumsi memori melonjak mendekati 11 GiB belum diuji beban nyata.

## Gap terhadap visi

1. **Checkout recoverability**: bekerja di atas checkout dengan hampir semua file terhapus tidak aman; kepemilikan dan nasib perubahan `D` harus jelas lebih dahulu.
2. **Backend core**: Fastify, auth, database schema/migration, Redis/BullMQ, WebSocket, model provider implementasi, dan observability belum ada.
3. **Security boundary**: Permission Engine, approval ledger, audit, redaksi, credential lifecycle, policy runtime, dan sandbox belum diimplementasikan.
4. **Durability**: task/event schema, outbox, idempotency, retry cap, lease, recovery, artifact lifecycle, serta backup/restore belum ada.
5. **Clients/execution**: Android/Expo dan Windows/Tauri/Rust belum ada; browser automation, MCP hub, memory/pgvector, evaluator, scheduler, dan notifikasi juga belum ada.
6. **Operational proof**: tidak ada compose, deployment, image digest pinning, VPS benchmark, CI, tests, SLO/alerting, atau disaster-recovery drill.

## Risiko dan dependency utama

- Mengimplementasikan di checkout yang terhapus dapat tanpa sengaja menggabungkan assessment dengan pemulihan pengguna.
- 9Router compatibility, model list, pricing/usage, vision/tool calling, dan rate limits belum terbukti; desain wajib feature-gated.
- Baseline VPS 2 OCPU/12 GB berisiko tidak cukup untuk Postgres, Redis, API, worker, monitoring, dan browser bersamaan tanpa budget resource dan queue concurrency.
- Runtime agent punya kemampuan tool eksekusi; adapter tanpa sandbox/approval yang benar akan menjadi eskalasi privilege.
- Browser container ARM64 perlu uji nyata (Chromium, shared memory, seccomp, user namespace) sebelum menjadi dependency MVP.

## Keputusan terbuka — jawaban yang diperlukan

1. **MCP/connector MVP:** connector persis mana yang diizinkan pada rilis pertama? Pilih daftar eksplisit (mis. filesystem Windows, GitHub, Playwright/browser, Google Calendar, Gmail, Slack) beserta read/write boundary dan akun yang dipakai.
2. **Artefak:** apakah MVP menyimpan artefak hanya pada disk VPS dengan quota/retensi ketat, atau langsung memakai object storage? Jika object storage, pilih provider/region, enkripsi, dan target retensi.
3. **Web + voice:** apakah web dashboard termasuk MVP (selain Android), dan apakah voice input/output termasuk MVP? Jawab ya/tidak untuk masing-masing agar auth, realtime, dan media pipeline tidak dibangun spekulatif.
4. **Embedding:** provider embedding apa yang diizinkan melalui 9Router, model mana, bahasa prioritas (Indonesia/Inggris), dan batas biaya/latensi per ingest/query?
5. **Windows offline:** ketika worker Windows offline, apakah task yang belum mulai di-queue sampai TTL lalu fail, dialihkan ke sandbox/VPS bila capability setara, atau menunggu tanpa fallback? Berapa TTL dan bagaimana approval yang sudah diberikan diperlakukan?
6. **Gateway model outage:** ketika 9Router unavailable/rate-limited, apakah chat harus fail-fast dengan retry manual, queue task durable untuk retry terbatas, atau memakai fallback model yang juga harus melewati 9Router? Tentukan UX, max retry, dan perilaku task berbiaya/berdampak.

## Urutan implementasi aman dan milestone berikutnya

| Milestone                      | Acceptance criteria terukur                                                                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Workspace recovery decision | Owner mengonfirmasi apakah file `D` dipulihkan, dibuang, atau diganti; `git status` bersih/terjelaskan; dependency install dapat direproduksi.                       |
| 1. Environment proof           | VPS evidence dikumpulkan; compose minimal ARM64 berhasil `pull`/`up`; service database/Redis hanya internal; Caddy hanya mengekspos port disetujui.                  |
| 2. Secure vertical slice       | Fastify auth + PostgreSQL migration + Redis/BullMQ + one durable chat task bekerja; 9Router model list/capability check terautentikasi; secret tidak keluar backend. |
| 3. Permissioned tool slice     | Satu tool read-only dan satu tindakan HIGH dengan approval; audit event, idempotency, cancellation, retry cap, dan telemetry diuji.                                  |
| 4. Client + worker slice       | Android chat/stream/approval; Windows worker registration/capability/heartbeat/offline scenario teruji sesuai keputusan terbuka.                                     |
| 5. Memory/artifacts + browser  | Storage yang dipilih, artifact policy, embedding provider, pgvector pipeline, dan Playwright ARM64 smoke test tersedia dengan quota dan policy.                      |
| 6. Operations hardening        | Backup/restore drill, OTel dashboards/alerts, rate-limit/outage game day, image digests, CI lint/typecheck/test/build, dan security review lulus.                    |

ADR awal: [0001 backend-only model gateway](adr/0001-backend-only-model-gateway.md) dan [0002 control plane/execution plane + permissions](adr/0002-control-plane-execution-plane-and-permissions.md).
