# PostgreSQL backup dan restore

Dokumen runbook operasional untuk Personal AI OS control plane database.

---

## 1. Backup Terjadwal Lokal

### Mekanisme

- Menggunakan `pg_dump --format=custom --no-owner` untuk menghasilkan archive yang fleksibel (dapat di-restore per tabel atau full schema).
- Izin file backup dibatasi ke `0600` via `umask 077` untuk melindungi data at-rest.
- Secret (`DATABASE_URL`) tidak pernah dicetak ke stdout/stderr atau command log.

### Eksekusi Manual

Jalankan dari deployment host atau container admin:

```sh
export DATABASE_URL='postgresql://personal_ai_os:password@postgres:5432/personal_ai_os'
export BACKUP_DIR='/var/backups/personal-ai-os'
./scripts/backup-postgres.sh
```

### Konfigurasi Cron Terjadwal Lokal

Direkomendasikan jadwal harian off-peak (misal 02:15 UTC):

```cron
# /etc/cron.d/personal-ai-os-backup
15 2 * * * root cd /srv/personal-ai-os && DATABASE_URL_FILE=/etc/personal-ai-os/database-url BACKUP_DIR=/var/backups/personal-ai-os ./scripts/backup-cron-wrapper.sh >> /var/log/personal-ai-os-backup.log 2>&1
```

Catatan keamanan:
- `/etc/personal-ai-os/database-url` harus memiliki permission `0400` milik `root`.
- Backup archive lama dibersihkan secara berkala sesuai retensi (misal 14 hari).

---

## 2. Backup Offsite Terenkripsi & Sinkronisasi S3 (Oracle Object Storage)

Sesuai [ADR 0021](file:///C:/Coding/Project/AI-Agent/docs/adr/0021-authenticated-encryption-offsite-backup.md), backup offsite menerapkan pengerasan keamanan penuh:

### Fitur Keamanan Offsite:
1. **Enkripsi Terautentikasi (AES-256-GCM)**: Dijalankan via `scripts/backup-crypto.js` dengan Scrypt KDF dan 128-bit authentication tag. Melindungi dari manipulasi bit (*bit-flipping*) dan korupsi ciphertext.
2. **Kunci Enkripsi Wajib & Izin Ketat (0600)**: File `ENCRYPTION_KEY_FILE` (default `/etc/personal-ai-os/backup-encryption.key`) wajib ada dan memiliki permission `0600` (atau lebih ketat). Kunci tidak pernah diteruskan via argumen proses (`-pass pass:...` dilarang keras). Ketiadaan kunci memicu **gagal keras (exit 1)**; tidak ada fallback kunci default berbasis timestamp.
3. **Pembersihan Dump Mentah Seketika**: File dump mentah yang tidak terenkripsi dihapus seketika (`rm -f`) setelah enkripsi dan unggahan offsite berhasil.
4. **Unggahan S3 Wajib**: Parameter `S3_BUCKET`, `S3_ENDPOINT_URL`, dan ketersediaan `aws` CLI wajib ada. Jika gagal mengunggah, skrip keluar dengan status non-nol dan mengirimkan alert Telegram jika dikonfigurasi.
5. **Verifikasi Checksum SHA-256**: File `.sha256` wajib dihasilkan saat backup dan diverifikasi secara mutlak sebelum proses dekripsi saat restore.

### Eksekusi Backup Offsite Manual:

```sh
export DATABASE_URL='postgresql://personal_ai_os:password@postgres:5432/personal_ai_os'
export ENCRYPTION_KEY_FILE='/etc/personal-ai-os/backup-encryption.key'
export S3_BUCKET='my-database-backups'
export S3_ENDPOINT_URL='https://axxxxx.compat.objectstorage.ap-singapore-1.oraclecloud.com'
./scripts/backup-offsite.sh
```

---

## 3. Prosedur Uji Restore (Drill)

Uji restore **TIDAK BOLEH** dijalankan di database produksi aktif. Gunakan database terisolasi untuk memverifikasi integritas archive.

### Status Verifikasi:
- **Uji Unit & Integritas Skrip Lokal (Mock)**: **TERVERIFIKASI LULUS** (`apps/api/test/offsite-backup-restore.test.ts`).
- **Restore Drill Offsite Nyata di Cloud**: **BELUM DIVERIFIKASI** (*Menunggu pemilik sistem mengonfigurasi bucket dan kredensial Oracle Object Storage*).

### Langkah-langkah Uji Restore Lokal / Uji Mandiri:

1. **Siapkan database uji terisolasi**:

   ```sh
   psql "$ADMIN_DB_URL" -c "DROP DATABASE IF EXISTS personal_ai_os_restore_test;"
   psql "$ADMIN_DB_URL" -c "CREATE DATABASE personal_ai_os_restore_test;"
   ```

2. **Jalankan script restore**:

   Untuk backup reguler:
   ```sh
   export DATABASE_URL='postgresql://personal_ai_os:password@postgres:5432/personal_ai_os_restore_test'
   export BACKUP_FILE='/var/backups/personal-ai-os/personal_ai_os-20261009T021500Z.dump'
   ./scripts/restore-postgres.sh
   ```

   Untuk backup offsite terenkripsi (AES-256-GCM / legacy CBC):
   ```sh
   export DATABASE_URL='postgresql://personal_ai_os:password@postgres:5432/personal_ai_os_restore_test'
   export ENCRYPTED_BACKUP_FILE='/var/backups/offsite/personal_ai_os-20261016T120000Z.dump.enc'
   export ENCRYPTION_KEY_FILE='/etc/personal-ai-os/backup-encryption.key'
   ./scripts/restore-offsite.sh
   ```

3. **Verifikasi Acceptance Criteria**:
   - Skrip restore memverifikasi hash SHA-256 dan authentication tag GCM.
   - `pg_restore` selesai dengan exit code 0.
   - Dump mentah terdekripsi dihapus seketika dari direktori sementara setelah restore.
   - Verifikasi ekstensi `pgcrypto` dan `vector`:
     ```sh
     psql "$DATABASE_URL" -Atc "SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto', 'vector') ORDER BY 1;"
     ```
   - Verifikasi integritas tabel utama dan jumlah baris data:
     ```sh
     psql "$DATABASE_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('users', 'devices', 'refresh_tokens', 'projects', 'conversations', 'messages', 'tasks', 'task_events', 'model_providers', 'model_configs', 'audit_logs', 'memories', 'schedules');"
     ```

4. **Pembersihan Database Uji**:

   ```sh
   psql "$ADMIN_DB_URL" -c "DROP DATABASE personal_ai_os_restore_test;"
   ```

5. **Dokumentasi Hasil Drill**:
   Catat tanggal drill, hash sha256 file backup, waktu eksekusi, dan nama personel yang melakukan drill tanpa menyertakan kredensial di log audit.
