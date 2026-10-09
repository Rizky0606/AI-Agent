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
| **Agent Worker (BullMQ + Agent Core)**   | 1.536 MB (1.5 GB)     | 0.75 OCPU    | Eksekusi task durable, evaluasi, coding/research loop       |
| **Scheduler Engine**                     | 512 MB                | 0.25 OCPU    | Cron scheduling, event engine, notifikasi FCM               |
| **Caddy 2 Reverse Proxy**                | 256 MB                | 0.25 OCPU    | TLS termination, HTTP/2 & WebSocket reverse proxy           |
| **Playwright Browser Context (Sandbox)** | 2.048 MB (2.0 GB)     | 0.75 OCPU    | Chromium headless context (dibatasi max 2 concurrent pages) |
| **Host OS & Linux Page Cache Headroom**  | ~4.608 MB (4.5 GB)    | -            | Kernel, memory buffer, SSH, I/O burst, and safety margin    |
| **TOTAL TERENCANA**                      | **12.288 MB (12 GB)** | **2.0 OCPU** | **Terjamin tidak memicu Linux OOM Killer**                  |

---

## 2. Penyetelan Concurrency (Concurrency Tuning)

Untuk menjaga kestabilan sistem dan mencegah spike pemakaian CPU/RAM:

1. **Worker Concurrency**:
   - Ditetapkan ke **2 concurrent jobs** per worker container.
   - Konfigurasi: `createAgentWorker({ concurrency: 2 })`.
   - Mencegah kehabisan memori heap Node.js saat parsing AST dan diff file besar.

2. **Browser Automation Concurrency**:
   - Dibatasi ke **1-2 halaman simultan**.
   - Setiap navigasi browser context menggunakan isolasi terpisah dengan timeout maksimal 30 detik.
   - Resource leak dicegah dengan selalu memanggil `context.close()` dalam blok `finally`.

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
