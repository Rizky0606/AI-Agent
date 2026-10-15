# Runbook: Task Recovery and Crash Resilience

Dokumen ini menjelaskan mekanisme pemulihan task (startup recovery) pada Personal AI OS ketika worker mengalami restart atau crash di tengah eksekusi, serta prosedur verifikasi otomatisnya.

---

## 1. Arsitektur Pemulihan (Recovery)

Ketika worker menyala kembali (`apps/agent-worker/src/index.ts` -> `startWorkerProcess`), sistem menjalankan `recoverInterruptedTasks` dengan proteksi menyeluruh:

1. **Pendeteksian Task Yatim (Orphan Tasks)**:
   Mengambil task dengan status `running`, `planning`, atau `queued` yang belum selesai dari database PostgreSQL (`SqlTaskRepository.getDanglingRunningTasks`).
2. **Klaim Kunci Pemulihan Atomik (Lease / Advisory Locking)**:
   Menggunakan `claimTaskForRecovery(taskId)` dengan pembaruan atomik `leaseExpiresAt = now + 5 minutes` di baris task. Mencegah perebutan ganda (race condition) antar worker concurrent.
3. **Batas Percobaan Ulang (Retry Bounding)**:
   Jika `task.attempt >= task.maxAttempts`, task tidak di-requeue tanpa batas; status dialihkan ke `failed` dengan alasan yang jelas dan memancarkan event `task.failed` (`recoveryExhausted: true`).
4. **Verifikasi Integritas Checkpoint**:
   Jika checkpoint memiliki checksum, `verifyCheckpointIntegrity` memvalidasi bahwa checkpoint tidak dimanipulasi/korup sebelum dilanjutkan.
5. **Penerusan Checkpoint (Idempotent Resumption)**:
   Task yang sudah mencapai checkpoint tertentu melanjutkan langkah berikutnya (`startStep = lastCheckpoint.stepIndex + 1`), tanpa mengulang efek samping yang sudah selesai.
6. **Emisi Event Tepat Sekali**:
   Event `task.resumed` dipancarkan sekali saat pemulihan, dan `task.completed` dipancarkan setelah seluruh kriteria evaluasi lulus.

---

## 2. Perintah Eksekusi Test Integrasi Nyata

Test integrasi recovery dijalankan terhadap PostgreSQL dan Redis aktif via satu perintah tunggal:

```bash
pnpm --filter @personal-ai-os/agent-worker test:recovery
```

### Variabel Lingkungan Opsional
- `DATABASE_URL`: default `postgresql://personal_ai_os:personal_ai_secret@127.0.0.1:5432/personal_ai_os`
- `REDIS_URL`: default `redis://127.0.0.1:6379`

### Cakupan Skenario Pengujian:
1. **Crash & Resume**: Task running di Worker 1 -> Worker 1 dimatikan mendadak -> Worker 2 menyala -> Task dipulihkan dari checkpoint dan dieksekusi tepat satu kali (`toolExecutionCount === 1`).
2. **Bounded Retries**: Task dengan percobaan maksimal tercapai (`attempt === maxAttempts`) ditandai `failed` secara aman tanpa loop tanpa henti.
3. **Tampered Checkpoint**: Checkpoint dengan checksum tidak valid ditolak dan task dihentikan (`failed`).
4. **Advisory Lease Concurrency**: Dua worker concurrent berebut klaim pemulihan; tepat satu worker yang berhasil mengklaim task.
