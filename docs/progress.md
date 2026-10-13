# Progres Deployment VPS — Personal AI OS

Tanggal: 2026-10-10. Branch: `deploy/vps-setup` (lokal, belum push).

> **SUPERSEDED.** Catatan ini adalah snapshot titik-waktu dari branch `deploy/vps-setup`
> (2026-10-10) dan tidak lagi akurat. Khususnya, "TEMUAN KRITIS" di bawah sudah tidak berlaku:
> worker menjalankan loop BullMQ sungguhan (`startWorkerProcess` di `apps/agent-worker/src/index.ts`)
> dan `TaskExecutor` mengeksekusi model/tool nyata untuk task non-simulasi. Status terkini ada di
> `docs/capability-acceptance-report.md` dan `docs/capability-matrix.yaml`.


## Fase 0 — SELESAI
- Ubuntu 24.04.5, aarch64, 2 OCPU, 11 GiB RAM (no swap), disk 155G avail.
- Docker 29.8.2, Compose v5.6.0, enabled, user ubuntu di grup docker.
- Web server 80/443 = **nginx.service**, vhost: api.tradingrai.org → 127.0.0.1:8000 (crypto-ai-bot), hermes.ojixx.my.id → 127.0.0.1:9119, short/apishort.ojixx.my.id → 8501/8080.
- `/etc/docker/daemon.json` TIDAK ADA (log tanpa rotasi).
- Hermes bind 0.0.0.0:9119 (publik). Postgres host service bind 127.0.0.1 saja.
- Container lama exited (tidak disentuh): moneyprinterturbo x2, 9router.
- omp: tidak ditemukan di host.

## Fase 1 — SELESAI
- Repo di `~/apps/personal-ai-os`, branch `deploy/vps-setup` dari `7f74f72`.

## Fase 2 — Sebagian (A, B, C selesai; D sebagian)
- A: LULUS. Reproduksi error FK di temp db; fix `tasks_scope_uq UNIQUE (id, user_id)` di 0001_core.sql + schema.ts. Commit `e0fca55`. Ulangi migrasi 0000–0005 di temp db = sukses, 17 tabel.
- B: LULUS. Service `migrate` (pgvector:pg17, mount ro, `schema_migrations` tracking, idempoten) di docker-compose.yml; api/worker/scheduler `depends_on: migrate service_completed_successfully`. `docker compose config` valid.
- C: LULUS. Service `backup` BARU (compose semula tidak punya) dengan `sh /scripts/backup-postgres.sh`, retensi `BACKUP_RETENTION_DAYS` default 14, tanpa pola penutup kegagalan. `git update-index --chmod=+x` untuk 4 skrip. Commit `fc66321`.
- D: `.dockerignore` dibuat. **Tidak dapat dilakukan sepenuhnya**: `resolveDatabaseUrl` TIDAK ADA di apps/scheduler (grep kosong). Worker fail-fast NINEROUTER belum dipasang — lihat temuan kritis.

## TEMUAN KRITIS — perlu keputusan pemilik sebelum lanjut
1. `apps/scheduler/src/index.ts` HANYA re-export modul; tidak ada entrypoint standalone. Scheduler container akan exit langsung setelah start (bukan service jangka panjang).
2. `apps/agent-worker/src/index.ts` standalone mode hanya mencetak log "initialized [PLACEHOLDER_GENERIC_WORKER]" lalu exit — tidak ada loop BullMQ berjalan. TaskExecutor sendiri berlabel PLACEHOLDER (eksekusi simulasi, tidak memanggil model/tool sungguhan).
3. Worker/scheduler juga tidak memproses DATABASE_URL/NINEROUTER env sama sekali (tidak ada konsumsi `process.env` di keduanya).
4. Dockerfile api/worker/scheduler tidak menjalankan `pnpm build`; berjalan langsung via `node --experimental-strip-types` (OK untuk TS strip, tapi perlu verifikasi dependency prod cukup).
Implikasi: Fase 6 (worker/scheduler "healthy, tetap hidup") dan Fase 7 (worker memproses task nyata) tidak mungkin LULUS dengan kode saat ini tanpa menambah entrypoint + implementasi executor sungguhan — itu pekerjaan pengembangan fitur, bukan sekadar perbaikan deploy. Menunggu arahan.

## PENDING
- Fase 2D sisa (fail-fast worker) — menunggu keputusan di atas.
- pnpm install/lint/typecheck/build — belum dijalankan.
- Fase 3 (.env) — menunggu NINEROUTER_API_KEY, PUBLIC_HOSTNAME, ACME_EMAIL.
- Fase 4 — pilihan opsi A/B/C untuk 80/443 (nginx vs Caddy). Rekomendasi: Opsi B.
