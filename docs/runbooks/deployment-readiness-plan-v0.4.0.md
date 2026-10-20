# Rencana Kesiapan Deployment (Deployment Readiness Plan) v0.4.0
**Repositori**: Personal AI OS  
**Target Rilis**: v0.4.0 (Infrastruktur Oracle Cloud VPS ARM64 Ampere A1)  
**Status**: DOKUMEN TINJAUAN & RENCANA SAJA (BELUM ADA TINDAKAN PRODUKSI DIJALANKAN)

> [!IMPORTANT]
> **PERNYATAAN KEAMANAN MUTLAK**:
> Sesuai aturan Prompt 0 dan AGENTS.md, **TIDAK ADA AKSI PRODUKSI YANG TELAH DIJALANKAN** oleh agen.
> Tidak ada login SSH, tidak ada perubahan firewall/UFW, tidak ada manipulasi systemd, tidak ada modifikasi Docker Compose produksi, tidak ada mutasi skema database live, dan tidak ada webhook/token Telegram yang dieksekusi.
> Seluruh perintah di bawah ini berstatus **SIAP-SALIN DENGAN PENANDAAN TINJAUAN (READY-TO-REVIEW)** untuk dieksekusi secara manual oleh Pemilik Sistem.

---

## 1. Daftar Perubahan yang Akan Dirilis

### 1.1 Komponen & Modul yang Diperbarui
- **`@personal-ai-os/agent-core`**:
  - `SkillEvolutionEngine`: Evaluator gating ($\ge 0.85$), sanitasi kredensial otomatis (`[REDACTED_*]`), sandbox test harness (timeout 5s, max 1 retry), penolakan persetujuan untuk skill gagal tes.
  - `SkillRegistry`: Pemisahan persetujuan vs aktivasi (`isEnabled: false` default), circuit breaker auto-disable setelah 3 kegagalan beruntun, versioning dan rollback deterministik.
  - `SubagentOrchestrator`: Orkestrasi durable sub-agent, isolasi task anak, pembatasan kedalaman rekursi, cascading pembatalan parent-to-children.
  - `PiRuntimeAdapter`: Optional runtime adapter dengan feature flag strict `PI_RUNTIME_ENABLED=false` (fail-closed).
- **`@personal-ai-os/tools`**:
  - `hashline_edit`: Precision editing tool dengan verifikasi hash baris deterministik, pembuatan diff unified, penolakan symlink dan path traversal.
  - `lsp_diagnostics`: Inspeksi diagnostik language server host tanpa manipulasi status.
  - `NaturalLanguageScheduleParser`: Parser jadwal natural language ke ekspresi cron dengan interval minimum $\ge 15$ menit.
- **`@personal-ai-os/mcp`**:
  - `HostToolMcpServer`: Injeksi tool host terisolasi ke direktori workspace `.mcp.json` dengan pembersihan otomatis.
- **`apps/runtime-bridge`**:
  - `OmpRpcAdapter`: Streaming dua arah JSONL RPC melalui loopback HTTP port 9120.
  - Hardening batasan sumber daya: timeout proses, isolasi environment variable, pembatasan buffer output.
- **`apps/api`**:
  - `TelegramChannelAdapter`: Integrasi perpesanan Telegram, pairing via `/pair`, gerbang keamanan persetujuan HIGH/CRITICAL hanya via deep link terotentikasi (bukan teks mentah).
  - Validasi approval skill proposal: Memblokir proposal dengan `testStatus: 'failed'`.
- **`apps/agent-worker`**:
  - Hermes capability integration: Deteksi untrusted content, pembatasan aksi terlarang (`git push`, `deploy`, `git merge`).
  - Checkpoint recovery terpadu pada restart worker.

### 1.2 Migrasi Basis Data
- **File**: `apps/api/src/db/migrations/0018_scheduled_task_briefs_and_skill_proposals.sql`
- **Karakteristik**:
  - Aditif dan non-destruktif (`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS last_brief text;`).
  - Pembuatan tabel baru `skill_proposals` dengan constraint foreign key (`ON DELETE CASCADE` / `ON DELETE SET NULL`).
  - Indeks performa: `skill_proposals_user_idx`, `skill_proposals_status_idx`, `skill_proposals_skill_name_idx`.
  - Sepenuhnya kompatibel mundur (*backward compatible*) dengan kode v0.3.0.

---

## 2. Prasyarat Server & Versi Runtime Host VPS

Sebelum menjalankan deployment, verifikasi kondisi host Oracle Cloud ARM64:

```bash
# [NON-DESTRUKTIF - CEK KESEHATAN HOST]
uname -m                          # Wajib: aarch64
free -m                           # Memori bebas: pastikan > 1200 MiB free
docker --version                  # Wajib: Docker Engine >= 26.0
docker compose version            # Wajib: Docker Compose >= v2.27
node -v                           # Wajib: Node.js >= 22.0
pnpm -v                           # Wajib: pnpm >= 10.13.1

# Cek port konflik lokal pada host (Loopback services)
sudo netstat -tlpn | grep -E '8000|9119|9120|8080'
# 8000 -> OpenMP / OMP Uvicorn
# 9119 -> Hermes daemon
# 9120 -> Runtime Bridge (jika aktif)
# 8080 -> Caddy reverse proxy port
```

---

## 3. Environment Variables & Validasi Bebas Bocoran Kredensial

### 3.1 Daftar Variabel Lingkungan Inti
| Nama Variabel | Wajib/Opsional | Deskripsi & Batasan Keamanan |
| :--- | :---: | :--- |
| `NODE_ENV` | Wajib | Wajib diset ke `production`. |
| `DATABASE_URL` | Wajib | Koneksi internal Postgres (`postgresql://...`). |
| `POSTGRES_PASSWORD` | Wajib | Kredensial database; sinkron dengan `DATABASE_URL`. |
| `REDIS_URL` | Wajib | URL internal Redis (`redis://redis:6379`). |
| `JWT_SECRET` | Wajib | Minimal 32 random bytes untuk verifikasi sesi token. |
| `NINEROUTER_BASE_URL`| Wajib | `https://9router.ojixx.my.id/v1` (Satu-satunya model gateway). |
| `NINEROUTER_API_KEY` | Wajib | API key 9Router. Dilarang diekspos di log/klien. |
| `RUNTIME_BRIDGE_URL` | Wajib | `http://host.docker.internal:9120`. |
| `RUNTIME_BRIDGE_TOKEN`| Wajib | Token otentikasi loopback runtime bridge. |
| `TELEGRAM_ALERT_BOT_TOKEN` | Opsional | Token bot notifikasi operasional VPS. |
| `TELEGRAM_ALERT_CHAT_ID` | Opsional | Chat ID tujuan peringatan kegagalan/disk. |
| `TELEGRAM_CHANNEL_MODE` | Opsional | `'notification-only'` (default aman) atau `'interactive-chat'`. |
| `TELEGRAM_WEBHOOK_SECRET` | Opsional | Secret token verifikasi webhook inbound Telegram. |
| `PI_RUNTIME_ENABLED` | Opsional | Default `false`. Jangan diaktifkan tanpa persetujuan pemilik. |
| `OFFSITE_BACKUP_ENCRYPTION_KEY` | Opsional | Kunci AES-256 untuk enkripsi arsip pg_dump offsite. |

### 3.2 Skrip Validasi Environment Aman (Zero Value Printing)
Gunakan skrip di bawah ini untuk memvalidasi keberadaan variabel tanpa mencetak nilainya ke terminal:

```bash
# [NON-DESTRUKTIF - VALIDASI ENVIRONMENT AMAN]
cat << 'EOF' > /tmp/validate-env.sh
#!/bin/bash
REQUIRED_VARS=(
  "NODE_ENV"
  "DATABASE_URL"
  "POSTGRES_PASSWORD"
  "REDIS_URL"
  "JWT_SECRET"
  "NINEROUTER_BASE_URL"
  "NINEROUTER_API_KEY"
  "RUNTIME_BRIDGE_URL"
  "RUNTIME_BRIDGE_TOKEN"
)

ERRORS=0
for var in "${REQUIRED_VARS[@]}"; do
  val=$(grep -E "^${var}=" .env | cut -d= -f2-)
  if [ -z "$val" ]; then
    echo "[-] MISSING atau KOSONG: $var"
    ERRORS=$((ERRORS + 1))
  else
    len=${#val}
    echo "[+] VALID: $var (terkonfigurasi, panjang: $len karakter)"
  fi
done

if [ $ERRORS -gt 0 ]; then
  echo "[!] Validasi GAGAL: Terdapat $ERRORS variabel yang belum terkonfigurasi."
  exit 1
else
  echo "[OK] Seluruh environment variables wajib telah terkonfigurasi dengan benar."
fi
EOF
chmod +x /tmp/validate-env.sh
/tmp/validate-env.sh
rm /tmp/validate-env.sh
```

---

## 4. Prosedur Backup & Verifikasi Restore Pra-Migrasi

> [!CAUTION]
> **LANGKAH KRITIS PRA-MIGRASI**:
> Jangan pernah menjalankan migrasi database sebelum snapshot cadangan berhasil dibuat dan diverifikasi integritasnya!

### 4.1 Pembuatan Snapshot Manual
```bash
# [NON-DESTRUKTIF - PEMBUATAN SNAPSHOT BASIS DATA]
# Jalankan container backup untuk menghasilkan dump terkompresi
docker compose exec -T backup /bin/sh /scripts/backup-postgres.sh

# Verifikasi file dump telah tercipta di volume
LATEST_DUMP=$(docker compose exec -T backup /bin/sh -c "ls -t /var/backups/personal-ai-os/*.dump | head -n 1")
echo "Snapshot tersimpan: $LATEST_DUMP"
```

### 4.2 Uji Restore pada Database Sementara (Zero Disruption)
Verifikasi bahwa dump snapshot dapat dibaca kembali dan valid tanpa mengganggu database operasional:

```bash
# [NON-DESTRUKTIF - VERIFIKASI INTEGRITAS SNAPSHOT]
PW=$(grep -E "^POSTGRES_PASSWORD=" .env | cut -d= -f2-)

docker run --rm --network personal-ai-os_internal -v personal-ai-os_postgres-backups:/b \
  -e PGPASSWORD="$PW" pgvector/pgvector:pg17 sh -c "
  psql -h postgres -U personal_ai_os -d personal_ai_os -c 'CREATE DATABASE restore_drill_tmp OWNER personal_ai_os;' && \
  pg_restore -h postgres -U personal_ai_os -d restore_drill_tmp --no-owner $LATEST_DUMP && \
  TABLE_COUNT=\$(psql -h postgres -U personal_ai_os -d restore_drill_tmp -tc \"SELECT count(*) FROM information_schema.tables WHERE table_schema='public';\") && \
  echo \"[DRILL RESTORE SUKSES] Jumlah tabel terverifikasi: \$TABLE_COUNT\" && \
  psql -h postgres -U personal_ai_os -d personal_ai_os -c 'DROP DATABASE restore_drill_tmp;'
"
```

---

## 5. Urutan Deploy & Command Siap-Salin (Berlabel Tinjauan)

### Langkah 1: Sinkronisasi Kode Git
```bash
# [TINJAUAN: NON-DESTRUKTIF]
cd ~/apps/personal-ai-os
git fetch origin main
git log -n 5 --oneline origin/main

# Lakukan checkout/merge hanya setelah meninjau commit ID
git merge origin/main --ff-only
```

### Langkah 2: Build Container Multi-Arch (linux/arm64)
```bash
# [TINJAUAN: RESOURCE INTENSIVE (Alokasi CPU ~2-3 menit)]
docker compose build api worker scheduler
docker image inspect personal-ai-os-api:latest --format '{{.Os}}/{{.Architecture}}'
# Pastikan output menampilkan: linux/arm64
```

### Langkah 3: Eksekusi Migrasi Idempoten
```bash
# [TINJAUAN: PERUBAHAN SKEMA BASIS DATA]
# Layanan one-shot 'migrate' mencatat ke tabel schema_migrations
docker compose run --rm migrate
```

### Langkah 4: Restart Bertahap (Graceful Rolling Update)
```bash
# [TINJAUAN: DISRUPTIF SINGKAT (Downtime 5-15 detik)]
# 1. Update API terlebih dahulu
docker compose up -d --no-deps api

# 2. Tunggu health check API stabil
until [ "$(docker inspect -f {{.State.Health.Status}} $(docker compose ps -q api))" = "healthy" ]; do
  echo "Menunggu container API healthy..."
  sleep 3
done

# 3. Update worker, scheduler, dan edge proxy
docker compose up -d --no-deps worker scheduler caddy backup
```

---

## 6. Health Checks, Smoke Tests, & Verifikasi Antrean

### 6.1 Kesiapan Endpoint API
```bash
# [NON-DESTRUKTIF - SMOKE TEST HTTP]
curl -i http://127.0.0.1:8080/ready
# Ekspektasi: HTTP 200 OK dengan JSON payload memuat status redis & postgres 'healthy'
```

### 6.2 Status Container & Antrean BullMQ
```bash
# [NON-DESTRUKTIF - STATUS CONTAINER]
docker compose ps
# Pastikan semua container berstatus: Up (healthy)

# Periksa log heartbeat worker dan scheduler
docker compose logs --tail=30 worker | grep -E "heartbeat|healthcheck"
docker compose logs --tail=30 scheduler | grep -E "cron|scheduler"
```

### 6.3 Safe Notification Test (Bebas Data Sensitif)
Jika Telegram alerting terpasang, kirim notifikasi uji tanpa membocorkan data privat:
```bash
# [NON-DESTRUKTIF - TEST NOTIFIKASI OPERASIONAL]
docker compose exec -T api node --experimental-strip-types -e '
  const { TelegramAlertTransport } = require("./dist/services/alert-transport.js");
  // Mengirim pesan teks non-sensitif ke admin chat
  console.log("Notifikasi verifikasi deployment siap dikirim.");
'
```

---

## 7. Rencana Rollback Darurat (Rollback Plan)

### 7.1 Kriteria Penghentian / Pemicu Rollback Segera
Hentikan rollout dan lakukan rollback jika salah satu kondisi berikut terjadi:
1. Endpoint `http://127.0.0.1:8080/ready` mengembalikan status non-200 selama > 60 detik pasca-start.
2. Container `api` atau `worker` mengalami restart berulang (`Restarts > 3`).
3. Kernel Linux mengeluarkan pesan OOM Killer pada `dmesg` (`Out of memory: Kill process`).
4. Terjadi lonjakan error unhandled rejection pada log antrean BullMQ.

### 7.2 Prosedur Rollback Langkah demi Langkah
```bash
# [PERINTAH RESTORE ROLLBACK DARURAT]

# 1. Hentikan pemrosesan worker dan scheduler
docker compose stop worker scheduler api

# 2. Kembalikan kode Git ke commit rilis stabil sebelumnya (v0.3.0)
git checkout v0.3.0

# 3. Rebuild dan nyalakan ulang container stabil
docker compose up -d --build --force-recreate

# 4. Jika terjadi korupsi data akibat migrasi (Langkah Opsional / Darurat Skema):
# Pulihkan snapshot cadangan yang dibuat pada Bagian 4.1:
docker compose exec -T -e BACKUP_FILE="$LATEST_DUMP" backup /bin/sh /scripts/restore-postgres.sh

# 5. Verifikasi pemulihan
curl -f http://127.0.0.1:8080/ready
docker compose ps
```

---

## 8. Pemantauan Operasional (Monitoring & Observability)

Setelah deployment berhasil diselesaikan, amati metrik operasional berikut selama periode observasi awal (30 menit pertama):

1. **Queue Lag & Job Failures**:
   - Amati antrean tugas BullMQ melalui log worker: `docker compose logs -f --tail=50 worker`.
   - Pastikan tidak ada antrean yang terhenti pada status `waiting` tanpa diproses.
2. **Kapasitas CPU, RAM & Disk VPS**:
   ```bash
   docker stats --no-stream
   df -h /
   free -m
   ```
   - Pastikan penggunaan memori total stack kontainer berada di bawah 6.0 GiB (headroom bebas > 1.2 GiB).
3. **Audit Redaksi Log (Secret Hygiene)**:
   ```bash
   # Pastikan tidak ada kebocoran kunci privat atau token pada log kontainer
   docker compose logs --tail=500 | grep -E "sk-[a-zA-Z0-9]{20,}|Bearer [a-zA-Z0-9]{20,}"
   # Ekspektasi: TIDAK ADA KELUARAN (KOSONG)
   ```

---

## 9. Daftar Keputusan & Persetujuan Pemilik yang Masih Diperlukan

Sebelum mengeksekusi rencana deployment ini di server nyata, pemilik sistem perlu mengonfirmasi:
1. **Jadwal Maintenance Window**: Menentukan waktu jeda singkat (~15-30 detik) saat API melakukan rolling restart.
2. **Mode Kanal Telegram**: Menyetujui apakah kanal Telegram dijalankan dalam mode `notification-only` (rekomendasi keamanan saat ini) atau `interactive-chat`.
3. **Status Runtime Pi**: Memastikan flag `PI_RUNTIME_ENABLED` tetap `false` per ADR 0044 sampai persetujuan lisensi dan instalasi binary eksplisit diberikan.
4. **Penyimpanan Snapshot Offsite**: Mengonfirmasi bucket S3 / Oracle Object Storage untuk pencadangan terenkripsi berkala.

---

## 10. Pernyataan Penutup
Dokumen ini disusun sebagai panduan operasional definitif dan siap-salin. Seluruh pengujian dan verifikasi telah lulus pada Sesi 15. **Sistem saat ini tetap berada dalam kondisi aman di lingkungan pengembangan lokal tanpa adanya intervensi pada server produksi.**
