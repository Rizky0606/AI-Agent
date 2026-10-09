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

## VPS dan container

### Yang benar-benar diketahui

Target arsitektur dalam dokumentasi `HEAD` adalah Oracle Cloud Ubuntu 24.04 ARM64, baseline 2 OCPU/12 GB, Docker Compose. Itu adalah target, **bukan** data aktual server.

Workstation assessment adalah Windows 11 64-bit, AMD Ryzen 7 5700U (8 core/16 thread), sekitar 15.4 GiB RAM terlihat, dan disk C tersisa sekitar 25.9 GB. Docker CLI tidak terpasang. Tidak ada alias `~/.ssh/config` yang dapat dipakai untuk mengakses VPS. Karena itu Ubuntu version, arsitektur, OCPU, RAM, disk, Docker/Compose version, dan open ports VPS = **belum diuji**.

Port listener yang terlihat selama assessment adalah milik workstation, bukan VPS, sehingga sengaja tidak dipakai untuk menyimpulkan exposure server.

### Ketersediaan image ARM64 (manifest registry, bukan pull/run di VPS)

Pada 2026-10-09, manifest multi-arch registry mencantumkan `linux/arm64` atau `linux/arm64/v8` untuk:

| Peran                 | Tag yang dicek                               | ARM64                 |
| --------------------- | -------------------------------------------- | --------------------- |
| PostgreSQL            | `postgres:17-bookworm`                       | tersedia (`arm64/v8`) |
| PostgreSQL + pgvector | `pgvector/pgvector:pg17`                     | tersedia              |
| Redis                 | `redis:7-alpine`                             | tersedia (`arm64/v8`) |
| Caddy                 | `caddy:2-alpine`                             | tersedia (`arm64/v8`) |
| Node                  | `node:22-bookworm-slim`                      | tersedia (`arm64/v8`) |
| Playwright/Chromium   | `mcr.microsoft.com/playwright:v1.57.0-noble` | tersedia              |

Tag mutable harus dipin ke digest setelah uji pull/run pada VPS. Ketersediaan manifest tidak membuktikan konsumsi RAM/disk, browser sandboxing, atau performa di Oracle ARM.

### Perintah bukti yang harus dijalankan di VPS

```bash
uname -a; lsb_release -a; nproc; free -h; df -h
docker version; docker compose version
docker info --format '{{.Architecture}}/{{.OSType}}'
ss -lntup
docker buildx imagetools inspect pgvector/pgvector:pg17
```

Jalankan melalui akses SSH yang Anda berikan/konfigurasikan, lalu tambahkan output yang telah direview (tanpa secret) ke dokumen verifikasi.

## Runtime agent pada workstation assessment

| Runtime   | Status          | Versi / lisensi                                | Interface yang terbukti                             | Non-interaktif |
| --------- | --------------- | ---------------------------------------------- | --------------------------------------------------- | -------------- |
| Pi        | terpasang       | `@earendil-works/pi-coding-agent` `1.1.0`, MIT | CLI; `--mode text                                   | json           | rpc`, MCP command/options terlihat di `pi --help` | `pi -p "prompt"` (opsional `--mode json`/`rpc`)        |
| OMP       | terpasang       | `@oh-my-pi/pi-coding-agent` `18.8.4`, MIT      | CLI; `--mode text                                   | json           | rpc                                               | rpc-ui`, command `acp`, auth-gateway pada `omp --help` | `omp -p "prompt"` (opsional `--mode json`/`rpc`; `--max-time`) |
| Hermes    | tidak terpasang | —                                              | Tidak ada CLI/API/SDK lokal yang dapat diverifikasi | —              |
| OpenHands | tidak terpasang | —                                              | Tidak ada CLI/API/SDK lokal yang dapat diverifikasi | —              |

Pi dan OMP memiliki interface CLI yang tampak dari binary lokal; API/SDK yang stabil untuk adapter backend belum diverifikasi dan tidak boleh diasumsikan. OMP menemukan plugin `pi-hermes-memory`, tetapi itu bukan bukti bahwa runtime Hermes agent terpasang. `oh` di PowerShell adalah alias `Out-Host`, bukan OpenHands.

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
