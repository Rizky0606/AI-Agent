# Runbook: Prosedur Deployment, Topologi Jaringan, Resource Limits, dan Rollback (Oracle Cloud ARM64)

Dokumen ini mendefinisikan standar operasional prosedur untuk deployment produksi, isolasi jaringan, manajemen kapasitas memori/CPU pada VPS Oracle Cloud ARM64 Ampere A1 (2 OCPU / 11 GiB RAM / 0B Swap), mekanisme healthcheck & container orchestration, backup terjadwal, dan prosedur rollback darurat.

---

## 1. Spesifikasi Infrastruktur & Alokasi Resource VPS

### 1.1 Karakteristik Host VPS (Hasil Audit Perbaikan 0)

- **Arsitektur**: ARM64 (`aarch64`, Oracle Cloud Ampere A1, 2 OCPU / 4 vCPU).
- **Total Memori Fisik**: 11 GiB RAM (~11,264 MiB).
- **Swap**: 0 Bytes (**KRITIS**: Tanpa swap file, lonjakan alokasi memori berisiko memicu kernel Linux OOM Killer yang mematikan proses utama tanpa peringatan).
- **Layanan Host Eksisting** (~3.0 GiB reservasi):
  - Hermes daemon listening di port `9119`.
  - OpenMP / omp runtime & Uvicorn daemon listening di port `8000`.
  - Systemd, sshd, journald, networking stack.
- **Headroom Headless Chromium / Browser Automation** (di dalam worker container):
  - Alokasi buffer dinamis: ~1.5 – 2.0 GiB.

### 1.2 Resource Budgeting & Batas Container Stack

Total alokasi limit stack container dibatasi ketat ke ~5,056 MiB (~4.94 GiB), menyisakan buffer bebas >1.0 GiB untuk OS host dan perlindungan terhadap OOM:

| Service         | CPU Limit   | CPU Reserv.  | Memory Limit | Memory Reserv. | OOM Score Adj | Keterangan                                                         |
| :-------------- | :---------- | :----------- | :----------- | :------------- | :------------ | :----------------------------------------------------------------- |
| `postgres`      | 0.75        | 0.25         | **1536M**    | 512M           | -500          | Database utama + pgvector; proteksi tinggi dari OOM kill           |
| `redis`         | 0.25        | 0.10         | **384M**     | 128M           | -500          | Queue BullMQ, cache, realtime pub/sub                              |
| `api`           | 0.50        | 0.15         | **768M**     | 256M           | 0             | Fastify REST API, JWT auth, WebSocket events                       |
| `worker`        | 0.75        | 0.25         | **1536M**    | 512M           | 100           | Agent Core, tool execution, LLM routing (buffer Chromium terpisah) |
| `scheduler`     | 0.25        | 0.10         | **384M**     | 128M           | 0             | Cron engine, event deduplication, notification engine              |
| `backup`        | 0.25        | 0.05         | **256M**     | 64M            | 200           | Cron pg_dump berkala setiap 6 jam                                  |
| `caddy`         | 0.25        | 0.05         | **192M**     | 64M            | -200          | Edge reverse proxy, TLS termination, static security headers       |
| **Total Stack** | **3.0 CPU** | **0.90 CPU** | **5056 MiB** | **1664 MiB**   | -             | **Bebas: ~1.2 GiB OS + ~1.8 GiB Chromium + ~3.0 GiB Hermes**       |

---

## 2. Arsitektur dan Segmentasi Jaringan

Keamanan jaringan mengikuti prinsip _Least Privilege_ dan isolasi lapis tiga:

```
[ Internet / Public Clients ]
              │
              ▼ :80, :443
     ┌─────────────────┐
     │  caddy (Edge)   │ ◄─── Hanya Caddy yang mem-publish port ke host
     └────────┬────────┘
              │ (edge bridge)
              ▼
     ┌─────────────────┐             (egress bridge: NAT Outbound)
     │   api (Port 3000)│ ──────────► [ 9Router Gateway / FCM / Web ]
     └────────┬────────┘
              │
    ══════════╪═════════════════════════════════════════════════════════
    Jaringan "internal" (internal: true, NO EGRESS, NO HOST PORTS)
    ══════════╪═════════════════════════════════════════════════════════
              ├───► postgres (PostgreSQL 16 + pgvector) - port 5432
              ├───► redis (Redis 7 Alpine) - port 6379
              │
    ══════════╪═════════════════════════════════════════════════════════
    Jaringan "egress" (NAT Outbound Only, NO INGRESS PORTS EXPOSED)
    ══════════╪═════════════════════════════════════════════════════════
              ├───► worker ──────────► [ 9Router / Web Scraping / Browser ]
              ├───► scheduler ───────► [ 9Router / FCM Push Notifications ]
              └───► backup ──────────► [ Remote storage / S3 jika dikonfigurasi ]
```

1. **Jaringan `internal` (`internal: true`)**:
   - Terisolasi penuh dari internet dan host gateway.
   - Postgres dan Redis HANYA berada di jaringan ini; tidak ada port host (5432 atau 6379) yang dibuka ke host atau jaringan luar.
   - Hanya service backend berizin (`api`, `worker`, `scheduler`, `backup`) yang memiliki antarmuka ke jaringan ini.
2. **Jaringan `egress`**:
   - Memiliki akses keluar internet (NAT egress) tanpa port masuk (ingress port) yang dipublish ke host.
   - Digunakan oleh `worker` dan `scheduler` untuk memanggil 9Router (`https://9router.ojixx.my.id/v1`), penjelajahan web (SSRF guard), dan FCM push service.
3. **Jaringan `edge`**:
   - Menghubungkan `caddy` dan `api`.
   - Hanya `caddy` yang mem-publish port 80 dan 443 ke host.

---

## 3. Healthcheck & Orchestration Dependensi

Semua container mengimplementasikan protokol healthcheck deklaratif dan koordinasi urutan start menggunakan `depends_on: condition: service_healthy`:

- **`postgres`**: Menguji koneksi dengan `pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB`.
- **`redis`**: Menguji respons ping dengan `redis-cli ping`.
- **`api`**: Menguji kesiapan server via endpoint `curl -f http://localhost:3000/ready`.
- **`worker`**: Memeriksa file heartbeat `/tmp/healthy` yang diperbarui secara aktif setiap 15 detik oleh event loop worker runtime (`apps/agent-worker/src/index.ts`). Jika terjadi crash atau unhandled rejection, file heartbeat dihapus saat shutdown atau menjadi stale, menandai container unhealthy.
- **`scheduler`**: Memeriksa file heartbeat `/tmp/healthy` yang diperbarui secara aktif setiap 15 detik oleh loop scheduler runtime (`apps/scheduler/src/index.ts`).
- **`caddy`**: Menunggu `api` berstatus `service_healthy` sebelum mengalirkan trafik masuk.

---

## 4. Keamanan Container & Build Multi-Arch (linux/arm64)

### 4.1 Eksekusi Non-Root

Semua Dockerfile (`infrastructure/docker/Dockerfile.*`) menggunakan user non-root `node:node` (UID:GID 1000:1000). Aplikasi dilarang berjalan sebagai user `root`.

### 4.2 Multi-Arch Build dan Digest Pinning

1. **Build Multi-Arch menggunakan Docker Buildx**:
   ```sh
   # Buat buildx builder jika belum aktif
   docker buildx create --name arm64-builder --use || docker buildx use arm64-builder

   # Build untuk arsitektur linux/arm64 (Oracle Cloud Ampere A1)
   docker buildx build --platform linux/arm64 -f infrastructure/docker/Dockerfile.api -t personal-ai-os/api:latest .
   docker buildx build --platform linux/arm64 -f infrastructure/docker/Dockerfile.worker -t personal-ai-os/worker:latest .
   docker buildx build --platform linux/arm64 -f infrastructure/docker/Dockerfile.scheduler -t personal-ai-os/scheduler:latest .
   ```
2. **Digest Pinning (Produksi Teruji)**:
   Setelah image diuji dan dipush ke container registry internal/private:
   ```sh
   docker inspect --format='{{index .RepoDigests 0}}' personal-ai-os/api:latest
   ```
   Sematkan SHA256 digest ke dalam image tag di `docker-compose.yml` untuk mencegah mutasi image tanpa audit.

---

## 5. Prosedur Backup dan Restore Terjadwal

### 5.1 Service Backup Otomatis

- Dijalankan oleh container `backup` berbasis `postgres:16-alpine`.
- Menjalankan cron wrapper `scripts/backup-cron-wrapper.sh` setiap 6 jam (`0 */6 * * *`).
- Dump biner terkompresi disimpan di volume persisten `postgres_backup_data` (`/var/backups/personal-ai-os`).

### 5.2 Manual Snapshot Sebelum Operasi Berisiko

```sh
# Dari root direktori proyek di host:
docker compose exec -T backup /bin/sh /scripts/backup-postgres.sh
```

### 5.3 Prosedur Restore Database (Uji Pemulihan Bencana)

Jika terjadi kegagalan skema atau data corrupt:

```sh
# 1. Hentikan scheduler dan worker untuk mencegah write concurrency
docker compose stop worker scheduler

# 2. Temukan file dump terbaru di volume backup
LATEST_BACKUP=$(docker compose exec -T backup /bin/sh -c "ls -t /var/backups/personal-ai-os/*.dump | head -n 1")
echo "Restoring from: $LATEST_BACKUP"

# 3. Jalankan restore melalui container backup (atau postgres)
docker compose exec -T -e BACKUP_FILE="$LATEST_BACKUP" backup /bin/sh /scripts/restore-postgres.sh

# 4. Restart seluruh stack dan verifikasi kesiapan
docker compose up -d worker scheduler
curl -f http://localhost:3000/ready
```

---

## 6. Alur Deployment Langkah demi Langkah (Zero Regresi)

1. **Verifikasi Kualitas Pra-Deployment (Lokal / CI)**:
   ```sh
   pnpm run format:check
   pnpm run test:ci
   ```
2. **Snapshot Database di VPS**:
   ```sh
   docker compose exec -T backup /bin/sh /scripts/backup-postgres.sh
   ```
3. **Pull Perubahan dan Build Image**:
   ```sh
   git -C ~/apps/personal-ai-os fetch origin
   git -C ~/apps/personal-ai-os merge origin/main   # atau origin/deploy/vps-setup
   docker compose build api worker scheduler
   docker image inspect personal-ai-os-api:latest --format '{{.Os}}/{{.Architecture}}'  # harapkan linux/arm64
   ```
4. **Jalankan Migrasi Database** (service one-shot `migrate`, idempoten via tabel `schema_migrations`):
   ```sh
   docker compose run --rm migrate
   # ulangi aman: file yang sudah diterapkan di-skip
   ```
5. **Restart Layanan Secara Bertahap**:
   ```sh
   docker compose up -d --no-deps api
   # Verifikasi API healthy
   docker compose ps api
   docker compose up -d --no-deps worker scheduler caddy backup
   ```
6. **Verifikasi Menyeluruh**:
   ```sh
   docker compose ps
   # Pastikan semua layanan berstatus "Up (healthy)"
   curl -f http://127.0.0.1:8080/ready   # caddy di-bind ke 127.0.0.1:8080 (Opsi B)
   docker compose logs --tail=50 worker scheduler
   ```

## 6b. Topologi Edge Aktual (Opsi B)

Port 80/443 host dimiliki **nginx** (vhosts: `api.tradingrai.org` → 127.0.0.1:8000, `hermes.ojixx.my.id` → 127.0.0.1:9119). Caddy **tidak** mem-publish 80/443; Caddy di-bind ke `127.0.0.1:8080`. Untuk ekspos publik: tambahkan vhost nginx baru yang `proxy_pass http://127.0.0.1:8080` dengan header `Upgrade`/`Connection "upgrade"` (wajib untuk WebSocket `/v1/chat/ws` dan `/v1/events/ws`), lalu TLS diterminasi nginx. Sampai vhost itu dibuat, akses hanya via SSH tunnel: `ssh -L 8080:127.0.0.1:8080 vps`.

---

## 7. Prosedur Rollback Darurat

Jika rilis mengalami error fatal (500 internal errors, crash loop, atau OOM):

1. **Kembalikan Kode Git**:
   ```sh
   git checkout <LAST_KNOWN_GOOD_COMMIT>
   ```
2. **Rebuild dan Restart Kontainer**:
   ```sh
   docker compose up -d --build --force-recreate
   ```
3. **Rollback Database (Jika Perlu)**:
   ```sh
   docker compose exec -T -e BACKUP_FILE="/b/<PRE_DEPLOYMENT_SNAPSHOT>.dump" backup /bin/sh /scripts/restore-postgres.sh
   ```
   Alternatif restore manual teruji (2026-10-11):
   ```sh
   PW=$(grep POSTGRES_PASSWORD .env | cut -d= -f2)
   docker run --rm --network personal-ai-os_internal -v personal-ai-os_postgres-backups:/b \
     -e PGPASSWORD="$PW" pgvector/pgvector:pg17 sh -c '
     psql -h postgres -U personal_ai_os -d personal_ai_os -c "CREATE DATABASE restore_tmp OWNER personal_ai_os;"
     pg_restore -h postgres -U personal_ai_os -d restore_tmp --no-owner /b/<DUMP>.dump
     psql -h postgres -U personal_ai_os -d restore_tmp -tc "SELECT count(*) FROM information_schema.tables WHERE table_schema='"'"'public'"'"';"
     psql -h postgres -U personal_ai_os -d personal_ai_os -c "DROP DATABASE restore_tmp;"'
   ```
4. **Verifikasi Pemulihan Sistem**:
   ```sh
   curl -f http://127.0.0.1:8080/ready
   docker compose ps
   ```

## 8. Hardening yang Sudah Diterapkan (2026-10-11)

- Worker production memakai `SecuredCapabilityGuard(new PermissionEngine(), { approvalValidator: approvalRepo })` (commit `7fe8246`): aksi HIGH (`git:push`, `deploy:*`, `external:send`) wajib `waiting_approval` + approve/deny via `/v1/approvals`.
- Migrasi one-shot `migrate` idempoten (`schema_migrations`), `api/worker/scheduler` `depends_on: migrate service_completed_successfully`.
- Backup: `sh /scripts/backup-postgres.sh`, retensi `RETENTION_DAYS` (default 14), tanpa `|| echo` penutup kegagalan.
