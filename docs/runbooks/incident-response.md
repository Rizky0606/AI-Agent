# Runbook: Respons Insiden Operasional (Incident Response)

Dokumen ini adalah panduan penanganan insiden darurat untuk Personal AI OS control plane dan runtime workers.

---

## 1. Klasifikasi Tingkat Keparahan (Severity Levels)

| Severity           | Definisi                                                                           | Contoh                                                | Target Respon |
| ------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------- |
| **SEV-1 (Kritis)** | Seluruh sistem tidak dapat diakses, database korup, atau gateway model mati total. | API crash loop, Postgres down, 9Router total outage   | < 15 menit    |
| **SEV-2 (Tinggi)** | Kemampuan utama terganggu namun kontrol dasar masih aktif.                         | Worker terhenti, Windows agent terputus berulang kali | < 30 menit    |
| **SEV-3 (Sedang)** | Gangguan parsial tidak kritis.                                                     | Notifikasi push delay, rate limit sementara           | < 2 jam       |

---

## 2. Skenario Insiden & Prosedur Pemulihan

### Skenario A: 9Router Model Gateway Outage (SEV-1)

**Gejala**: Chat dan coding task mengembalikan `CIRCUIT_BREAKER_OPEN` atau `ModelGatewayTimeoutError`.

1. **Verifikasi status gateway**:
   ```sh
   curl -I https://9router.ojixx.my.id/v1/models -H "Authorization: Bearer $NINEROUTER_API_KEY"
   ```
2. **Tindakan pencegahan**:
   - Model gateway otomatis mengaktifkan circuit breaker (mencegah banjir request dan penumpukan error).
   - Task yang sedang berjalan otomatis dialihkan ke status `failed_retryable` dengan backoff eksponensial.
3. **Eskalasi & Mitigasi**:
   - Jika 9Router mengalami downtime berkepanjangan, update konfigurasi model cadangan di backend atau beri tahu pengguna melalui status banner di Android/Windows.

---

### Skenario B: Agent Worker Crash Saat Task Berjalan (SEV-2)

**Gejala**: Task tertahan di status `running` tanpa update event baru dalam 2 menit.

1. **Identifikasi task yang tertahan**:
   ```sql
   SELECT id, project_id, status, updated_at FROM tasks WHERE status = 'running' AND updated_at < NOW() - INTERVAL '5 minutes';
   ```
2. **Restart container worker**:
   ```sh
   docker compose restart worker
   ```
3. **Pemulihan otomatis melalui checkpoint**:
   - Saat worker baru menyala, fungsi `recoverInterruptedTasks()` otomatis berjalan.
   - Task divalidasi integritas checkpoint-nya (`verifyCheckpointIntegrity`).
   - Eksekusi dilanjutkan tepat dari langkah checkpoint terakhir yang tersimpan, **tanpa mengeksekusi ulang langkah yang telah selesai** (mencegah efek samping ganda).

---

### Skenario C: Windows Agent Terputus / Offline (SEV-2)

**Gejala**: Task lokal Windows gagal atau menunggu koneksi.

1. **Cek koneksi agent di backend**:
   ```sh
   curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/v1/devices
   ```
2. **Perilaku sistem**:
   - Sistem **TIDAK menggantung diam-diam**.
   - Task yang membutuhkan kapabilitas Windows langsung ditandai dengan pesan:  
     `"Windows Agent sedang offline: tidak ada perangkat Windows yang terhubung untuk menjalankan task ini."`
3. **Mitigasi**:
   - Buka aplikasi Windows Agent di PC host, periksa koneksi internet dan status outbound WebSocket ke control plane.

---

### Skenario D: Lonjakan Penggunaan Memori (OOM Warning) (SEV-2)

**Gejala**: Penggunaan RAM VPS melebihi 85% atau container dihentikan oleh Linux OOM killer.

1. **Periksa penggunaan memori container**:
   ```sh
   docker stats --no-stream
   ```
2. **Tindakan cepat**:
   - Jika browser context menumpuk, hentikan zombie process browser.
   - Bersihkan cache Redis atau kurangi concurrency worker dari 2 menjadi 1 sementara waktu.
   - Restart container yang mengalami leak:
     ```sh
     docker compose restart worker api
     ```
