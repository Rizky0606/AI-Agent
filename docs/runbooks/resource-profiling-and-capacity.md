# Resource Profiling dan Panduan Kapasitas VPS ARM64 (12 GB)

Dokumen ini mendefinisikan alokasi resource, tuning concurrency, batas container, dan prosedur graceful shutdown untuk control plane Personal AI OS pada baseline Oracle Cloud ARM64 (2 OCPU / 12 GB RAM, Ubuntu 24.04).

---

## 1. Alokasi Kapasitas dan Profil Beban

Total RAM fisik: **12.288 MB (12 GB)**  
Total CPU cores: **2 OCPU (Ampere Altra ARM64)**

### Anggaran Memori (Memory Budget)

| Komponen / Service                       | Max Memory Limit      | CPU Limit    | Peran & Justifikasi                                         |
| ---------------------------------------- | --------------------- | ------------ | ----------------------------------------------------------- |
| **PostgreSQL 17 + pgvector**             | 2.048 MB (2.0 GB)     | 0.75 OCPU    | Shared buffers, vector index (HNSW/IVFFlat), storage engine |
| **Redis 7 (BullMQ)**                     | 512 MB                | 0.25 OCPU    | Queue broker, event pub/sub, rate limit counter             |
| **Control Plane API (Fastify)**          | 768 MB                | 0.75 OCPU    | REST API, WebSocket streaming, auth, permission evaluation  |
| **Agent Worker (BullMQ + Agent Core)**   | 2.048 MB (2.0 GB)     | 0.75 OCPU    | Eksekusi task durable, evaluasi, coding/research loop, Chromium headless (maks 1 sesi) |
| **Scheduler Engine**                     | 512 MB                | 0.25 OCPU    | Cron scheduling, event engine, notifikasi FCM               |
| **Caddy 2 Reverse Proxy**                | 256 MB                | 0.25 OCPU    | TLS termination, HTTP/2 & WebSocket reverse proxy           |
| **Playwright Chromium (dalam container worker)** | termasuk pada baris worker | 0.75 OCPU    | Chromium headless dijalankan sebagai proses anak container worker, bukan container terpisah; dibatasi `BROWSER_MAX_CONCURRENCY=1` |
| **Host OS & Linux Page Cache Headroom**  | ~6.656 MB (6.5 GB)    | -            | Kernel, memory buffer, SSH, I/O burst, dan margin keamanan  |
| **TOTAL TERENCANA**                      | **12.288 MB (12 GB)** | **2.0 OCPU** | **Terjamin tidak memicu Linux OOM Killer**                  |

---

## 2. Penyetelan Concurrency (Concurrency Tuning)

Untuk menjaga kestabilan sistem dan mencegah spike pemakaian CPU/RAM:

1. **Worker Concurrency**:
   - Ditetapkan ke **2 concurrent jobs** per worker container.
   - Konfigurasi: `createAgentWorker({ concurrency: 2 })`.
   - Mencegah kehabisan memori heap Node.js saat parsing AST dan diff file besar.

2. **Browser Automation Concurrency**:
   - Dibatasi ke **1 sesi browser simultan** (`BROWSER_MAX_CONCURRENCY=1`).
   - Timeout navigasi dan aksi 15 detik; satu instance Chromium dipakai ulang lintas sesi (`PlaywrightRunner` meluncurkan browser secara lazy).
   - Resource leak dicegah dengan selalu memanggil `context.close()` dan `browser.close()`.

3. **Model Gateway Request Concurrency**:
   - Maksimal 4 concurrent requests ke 9Router melalui backend model gateway.
   - Circuit breaker aktif otomatis saat terjadi error beruntun atau rate limit 429.

---

## 3. Keputusan Observability: OpenTelemetry vs Prometheus/Grafana

Sesuai arahan arsitektur:

- Menjalankan instance Prometheus + Grafana mandiri di VPS yang sama membutuhkan tambahan ~1.5 GB RAM dan disk I/O konstan untuk time-series database.
- **Keputusan**: Gunakan instrumentasi OpenTelemetry internal (`TelemetryTracer`) dengan endpoint `/metrics` format standar Prometheus. Monitoring eksternal dapat melakukan scrape ke `/metrics` tanpa membebani VPS lokal dengan container Grafana berat.

---

## 4. Prosedur Graceful Shutdown

Semua container layanan (API, Worker, Scheduler) dikonfigurasi dengan `stop_grace_period: 30s` pada `docker-compose.yml`.

### Urutan Shutdown:

1. Docker mengirimkan sinyal `SIGTERM` ke proses.
2. **Fastify API**: Berhenti menerima request baru, menunggu request yang sedang berjalan selesai, lalu menutup koneksi WebSocket dan database pool.
3. **Agent Worker**: Menghentikan pengambilan job baru dari BullMQ, menunggu langkah checkpoint task aktif selesai disimpan ke database, lalu menutup koneksi Redis.
4. **Scheduler**: Menghentikan timer dan interval, memastikan tidak ada event dispatch ganda.
5. Jika proses tidak selesai dalam 30 detik, Docker mengirimkan sinyal `SIGKILL`.

---

## 5. Hasil Pengukuran Kapasitas Empiris & Rekomendasi Ambang Batas (Sesi 16)

Pengukuran profil beban puncak dilakukan dengan skenario uji konkurensi: **10 chat paralel + 1 tugas browser Chromium + 1 eksekusi OMP bridge** menggunakan skrip benchmark [scripts/capacity-benchmark.ts](file:///c:/Coding/Project/AI-Agent/scripts/capacity-benchmark.ts).

### Tabel Hasil Pengukuran Kapasitas

| Parameter Beban / Metrik              | Nilai Hasil Uji | Keterangan & Catatan Analisis                                      |
| ------------------------------------- | --------------- | ------------------------------------------------------------------ |
| **Beban: 10 Chat Paralel (p50)**      | **116 ms**      | Latensi median respons request chat paralel                        |
| **Beban: 10 Chat Paralel (p95)**      | **162 ms**      | Batas atas ekor latensi chat beban puncak                          |
| **Beban: 10 Chat Paralel (Rata-rata)**| **118 ms**      | Stabilitas latensi pemrosesan konteks obrolan                      |
| **Beban: 1 Browser Task (Chromium)**  | **226 ms**      | Siklus inisialisasi sesi headless, navigasi, dan ekstraksi DOM     |
| **Beban: 1 Run OMP Bridge**           | **192 ms**      | Indexing workspace code, parsing git diff, dan token evaluation    |
| **Total Waktu Eksekusi Serentak**     | **227 ms**      | Waktu total penyelesaian seluruh beban simultan                    |
| **Memori Awal (RSS Baseline)**        | **65 MB**       | Konsumsi memori sebelum burst workload                             |
| **Puncak Pemakaian Memori (Peak RSS)**| **83 MB**       | Kenaikan memori terkendali (+18 MB) selama burst simultan          |
| **Heap Node.js Aktif**                | **9 MB**        | Heap memory internal runtime Node.js                               |
| **Penggunaan CPU (User)**             | **15 ms**       | Waktu eksekusi komputasi CPU di user space                         |
| **Penggunaan CPU (System)**           | **0 ms**        | Waktu eksekusi system call kernel                                  |
| **Estimasi Overhead Swap**            | **128 MB**      | Swap buffer headroom sistem operasi                                |

### Ambang Batas Operasional yang Direkomendasikan

Berdasarkan profil baseline VPS 2 OCPU / 12 GB RAM:
1. **Batas Konkurensi Chat Maksimal**: `10 sesi simultan`. Di atas 10 sesi simultan, antrean Fastify rate limit (100 req/min) dan model router akan mulai mengalami peningkatan latensi p95.
2. **Batas Konkurensi Browser Headless**: `1 sesi aktif` (`BROWSER_MAX_CONCURRENCY=1`). Alokasi 1 sesi browser menjaga pemakaian RAM worker tetap di bawah 2.048 MB.
3. **Batas Konkurensi Runtime Eksternal (OMP / Hermes)**: `2 sesi aktif` (`RUNTIME_MAX_IN_FLIGHT=2`). Mencegah perebutan CPU core ARM64 dengan proses PostgreSQL.
4. **Ambang Peringatan Memori (Memory Alerting Thresholds)**:
   - **Warning (Peringatan)**: Penggunaan RAM total host mencapai **80% (~9.8 GB)**.
   - **Critical (Kritis)**: Penggunaan RAM total host mencapai **90% (~11.0 GB)** atau swap aktif terus meningkat di atas 500 MB.
5. **Ambang Peringatan Disk (Disk Space Alerting)**:
   - **Warning**: Kapasitas disk terpakai **>= 85%**.
   - **Critical**: Kapasitas disk terpakai **>= 95%**.

