# PostgreSQL backup dan restore

Dokumen runbook operasional untuk Personal AI OS control plane database.

## 1. Backup terjadwal

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

### Konfigurasi Cron Terjadwal

Direkomendasikan jadwal harian off-peak (misal 02:15 UTC):

```cron
# /etc/cron.d/personal-ai-os-backup
15 2 * * * root cd /srv/personal-ai-os && DATABASE_URL_FILE=/etc/personal-ai-os/database-url BACKUP_DIR=/var/backups/personal-ai-os ./scripts/backup-cron-wrapper.sh >> /var/log/personal-ai-os-backup.log 2>&1
```

Catatan keamanan:

- `/etc/personal-ai-os/database-url` harus memiliki permission `0400` milik `root`.
- Backup archive lama dibersihkan secara berkala sesuai retensi (misal 14 hari) menggunakan script lifecycle storage atau command `find /var/backups/personal-ai-os -type f -name "*.dump" -mtime +14 -delete`.
- Backup dienkripsi dan disinkronkan ke storage sekunder di luar VPS (misal Object Storage).

---

## 2. Prosedur Uji Restore (Drill)

Uji restore **TIDAK BOLEH** dijalankan di database produksi aktif. Gunakan database terisolasi untuk memverifikasi integritas archive.

### Langkah-langkah Uji Restore

1. **Siapkan database uji terisolasi**:

   ```sh
   psql "$ADMIN_DB_URL" -c "DROP DATABASE IF EXISTS personal_ai_os_restore_test;"
   psql "$ADMIN_DB_URL" -c "CREATE DATABASE personal_ai_os_restore_test;"
   ```

2. **Jalankan script restore**:

   ```sh
   export DATABASE_URL='postgresql://personal_ai_os:password@postgres:5432/personal_ai_os_restore_test'
   export BACKUP_FILE='/var/backups/personal-ai-os/personal_ai_os-20261009T021500Z.dump'
   ./scripts/restore-postgres.sh
   ```

3. **Verifikasi Acceptance Criteria**:
   - `pg_restore` selesai dengan exit code 0.
   - Verifikasi ekstensi `pgcrypto` dan `vector`:
     ```sh
     psql "$DATABASE_URL" -Atc "SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto', 'vector') ORDER BY 1;"
     ```
     _Expected output:_
     ```
     pgcrypto
     vector
     ```
   - Verifikasi integritas tabel utama:
     ```sh
     psql "$DATABASE_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('users', 'devices', 'refresh_tokens', 'projects', 'conversations', 'messages', 'tasks', 'task_events', 'model_providers', 'model_configs', 'audit_logs');"
     ```
     _Expected count: 11_
   - Verifikasi integritas data sampel (contoh row count user):
     ```sh
     psql "$DATABASE_URL" -Atc "SELECT count(*) FROM users;"
     ```

4. **Pembersihan Database Uji**:

   ```sh
   psql "$ADMIN_DB_URL" -c "DROP DATABASE personal_ai_os_restore_test;"
   ```

5. **Dokumentasi Hasil Drill**:
   Catat tanggal drill, hash sha256 file backup, waktu eksekusi, dan nama personel yang melakukan drill tanpa menyertakan kredensial di log audit.
