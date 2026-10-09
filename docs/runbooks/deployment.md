# Runbook: Prosedur Deployment dan Rollback

Dokumen ini mendefinisikan alur deployment produksi, migrasi skema database, verifikasi kesehatan, dan prosedur rollback darurat untuk Personal AI OS.

---

## 1. Persiapan Pra-Deployment

1. **Jalankan Verifikasi Kualitas Lokal**:
   ```sh
   pnpm run format:check
   npx turbo run lint
   npx turbo run typecheck
   npx turbo run test
   pnpm run build
   ```
2. **Buat Snapshot / Backup Database Sebelum Deploy**:
   ```sh
   ./scripts/backup-postgres.sh
   ```

---

## 2. Alur Deployment ke Production VPS

1. **Pull Code Terbaru**:

   ```sh
   git fetch origin master
   git checkout master
   git pull origin master
   ```

2. **Jalankan Migrasi Database Drizzle (Jika Ada)**:

   ```sh
   ./scripts/migrate-db.sh
   ```

3. **Build dan Restart Container Secara Bertahap**:

   ```sh
   docker compose build api worker scheduler
   docker compose up -d --no-deps api
   # Tunggu healthcheck API ready
   curl -f http://localhost:3000/ready || exit 1
   docker compose up -d --no-deps worker scheduler
   ```

4. **Verifikasi Pasca-Deployment**:
   - Periksa endpoint ready: `curl http://localhost:3000/ready`
   - Periksa log aplikasi: `docker compose logs --tail=50 api worker`
   - Periksa metrik OpenTelemetry: `curl http://localhost:3000/metrics`

---

## 3. Prosedur Rollback Darurat

Jika deployment menyebabkan error fatal (SEV-1 atau regresi kritis):

1. **Rollback Kode Git ke Commit Sebelumnya**:

   ```sh
   git checkout <PREVIOUS_STABLE_COMMIT_HASH>
   ```

2. **Rebuild dan Restart Layanan**:

   ```sh
   docker compose build api worker scheduler
   docker compose up -d --force-recreate api worker scheduler
   ```

3. **Rollback Database (Jika Skema Mengalami Perubahan Breaking)**:

   ```sh
   export DATABASE_URL="postgresql://personal_ai_os:password@postgres:5432/personal_ai_os"
   export BACKUP_FILE="/var/backups/personal-ai-os/<PRE_DEPLOYMENT_BACKUP>.dump"
   ./scripts/restore-postgres.sh
   ```

4. **Verifikasi Pemulihan**:
   ```sh
   curl -f http://localhost:3000/ready
   ```
