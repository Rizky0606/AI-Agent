# Verifikasi Aktual VPS Oracle dan Runtime Agent

**Tanggal Verifikasi**: 2026-10-10 (Asia/Jakarta)  
**Host Target**: Oracle Cloud VPS (`servernic`)  
**Metodologi**: Eksekusi probe aktual langsung di host VPS (`uname`, `lsb_release`, `nproc`, `free`, `df`, `docker`, `ss`, `which`, `manifest inspect`). Data berikut adalah data empiris nyata, bukan estimasi atau target rancangan.

---

## 1. Spesifikasi Aktual VPS Oracle Cloud

| Parameter                     | Data Aktual Empiris                                                                                                     | Catatan Operasional                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Hostname**                  | `servernic`                                                                                                             | Oracle Cloud Infrastructure instance                                                                        |
| **Arsitektur CPU**            | `aarch64` (ARM64)                                                                                                       | 2 OCPU (`nproc = 2`)                                                                                        |
| **Kernel Linux**              | `6.17.0-1018-oracle #18~24.04.1-Ubuntu SMP`                                                                             | Kernel Oracle optimized untuk ARM64                                                                         |
| **Distro OS**                 | Ubuntu 24.04.5 LTS (`noble`)                                                                                            | Dukungan jangka panjang (LTS)                                                                               |
| **Memori Fisik (RAM)**        | Total: `11 GiB` (~12 GB nominal)<br>Used: `2.0 GiB`<br>Free: `1.6 GiB`<br>Buff/Cache: `8.5 GiB`<br>Available: `9.7 GiB` | Headroom memori riil sangat sehat (~9.7 GiB tersedia untuk container stack)                                 |
| **Swap Space**                | `0B` (Tidak ada swap aktif)                                                                                             | **PENTING**: Wajib menetapkan resource limits container ketat di Compose untuk mencegah OOM-killer mendadak |
| **Kapasitas Disk (Root `/`)** | Total: `174 GiB`<br>Used: `19 GiB` (11%)<br>Available: `155 GiB`                                                        | Ruang penyimpanan sangat lega untuk database, model cache, dan backup                                       |
| **Docker Engine**             | `29.8.2` (build `7fc2dff`)                                                                                              | Terpasang native ARM64                                                                                      |
| **Docker Compose**            | `v5.6.0`                                                                                                                | Terpasang native                                                                                            |

---

## 2. Port Listener dan Proses Host Aktif (`ss -tulpn`)

Pemeriksaan `ss -tulpn` mengungkap kondisi port dan proses yang sedang mendengarkan di host VPS:

```text
Netid  State   Recv-Q  Send-Q  Local Address:Port   Peer Address:Port   Process
udp    UNCONN  0       0       127.0.0.54:53        0.0.0.0:*           systemd-resolved
udp    UNCONN  0       0       127.0.0.53%lo:53     0.0.0.0:*           systemd-resolved
udp    UNCONN  0       0       10.0.0.11%enp0s6:68  0.0.0.0:*           dhclient/network
udp    UNCONN  0       0       0.0.0.0:111          0.0.0.0:*           rpcbind
udp    UNCONN  0       0       [::]:111             [::]:*              rpcbind
tcp    LISTEN  0       4096    0.0.0.0:22           0.0.0.0:*           sshd
tcp    LISTEN  0       4096    0.0.0.0:111          0.0.0.0:*           rpcbind
tcp    LISTEN  0       511     0.0.0.0:80           0.0.0.0:*           web/reverse-proxy
tcp    LISTEN  0       511     0.0.0.0:443          0.0.0.0:*           web/reverse-proxy
tcp    LISTEN  0       4096    0.0.0.0:631          0.0.0.0:*           cupsd/ipp
tcp    LISTEN  0       2048    0.0.0.0:9119         0.0.0.0:*           users:(("hermes",pid=613535,fd=10))
tcp    LISTEN  0       4096    127.0.0.54:53        0.0.0.0:*           systemd-resolved
tcp    LISTEN  0       4096    127.0.0.53%lo:53     0.0.0.0:*           systemd-resolved
tcp    LISTEN  0       200     127.0.0.1:5432       0.0.0.0:*           local postgres
tcp    LISTEN  0       2048    0.0.0.0:8000         0.0.0.0:*           users:(("python",pid=940310),("uvicorn",pid=940273))
tcp    LISTEN  0       4096    [::]:22              [::]:*              sshd
tcp    LISTEN  0       4096    [::]:111             [::]:*              rpcbind
tcp    LISTEN  0       4096    [::]:631             [::]:*              cupsd/ipp
```

### Temuan Keamanan & Jaringan Port Host:

1. **Hermes Service Aktif (Port TCP 9119)**: Proses `hermes` (PID 613535) aktif mendengarkan koneksi di `0.0.0.0:9119`.
2. **PostgreSQL Lokal di Host (TCP 127.0.0.1:5432)**: Telah ada instance PostgreSQL yang berjalan langsung di host pada port 5432 loopback.
   - _Implikasi_: Container Docker PostgreSQL `Personal AI OS` **tidak boleh** mempublikasikan port 5432 ke host network (`5432:5432`) untuk menghindari tabrakan port (_port collision_). Keputusan arsitektur kita mengikat Docker postgres hanya ke internal Docker network (`internal: true`) terbukti sangat tepat.
3. **Web Server Host (Port TCP 80 & 443)**: Port 80 dan 443 sudah berstatus LISTEN di host. Pastikan konfigurasi reverse proxy (Caddy / Caddy container) disesuaikan agar tidak konflik dengan server web yang ada (atau Caddy difungsikan sebagai entrypoint utama).
4. **Python/Uvicorn Process (Port TCP 8000)**: Terdapat proses Uvicorn Python (PID 940273) mendengarkan di `0.0.0.0:8000`.

---

## 3. Status Verifikasi Image Container ARM64

Inspeksi manifest multi-arch registry (`docker manifest inspect`) yang dieksekusi langsung di mesin VPS mengonfirmasi ketersediaan arsitektur `arm64`:

| Peran Service           | Image & Tag              | Arsitektur Terverifikasi |  Status Manifest  |
| ----------------------- | ------------------------ | :----------------------: | :---------------: |
| **Database + Vector**   | `pgvector/pgvector:pg17` |         `arm64`          | **TERVERIFIKASI** |
| **Cache & Task Queue**  | `redis:7-alpine`         |         `arm64`          | **TERVERIFIKASI** |
| **Reverse Proxy / TLS** | `caddy:2-alpine`         |         `arm64`          | **TERVERIFIKASI** |
| **Node.js Runtime**     | `node:22-bookworm-slim`  |         `arm64`          | **TERVERIFIKASI** |

---

## 4. Status Aktual Runtime Agent di VPS

Pemeriksaan `which hermes omp pi openhands`, `--version`, dan status proses host menghasilkan temuan empiris berikut:

| Runtime       |         Status VPS         | Path Binary & Versi                                                                                                                                                                                                        | Interface yang Terbukti Nyata                                                                    | Cara Menjalankan Non-Interaktif                                                                                                |
| ------------- | :------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **Hermes**    |   **TERPASANG & AKTIF**    | Path: `/home/ubuntu/.local/bin/hermes`<br>Versi: `Hermes Agent v0.20.5 (2026.8.19)`<br>Commit: `upstream 781334ee`, `local f93b3507`<br>Runtime: Python 3.11.15, OpenAI SDK 2.24.0<br>Daemon PID: `613535` pada TCP `9119` | 1. **CLI**: `/home/ubuntu/.local/bin/hermes`<br>2. **API/Daemon**: Listening pada `0.0.0.0:9119` | **Via API**: HTTP request / RPC ke endpoint lokal `http://127.0.0.1:9119`.<br>**Via CLI**: `hermes run` / `hermes -p "prompt"` |
| **OMP**       |       **TERPASANG**        | Path: `/home/ubuntu/.local/bin/omp`<br>Versi: `omp/18.6.1`                                                                                                                                                                 | **CLI**: `/home/ubuntu/.local/bin/omp`<br>Mendukung flag `--mode text \| json \| rpc \| rpc-ui`  | `omp -p "prompt" --mode json` atau `--mode rpc`                                                                                |
| **Pi**        | **TIDAK TERPASANG DI VPS** | Tidak ditemukan di PATH (`which pi` kosong). Terpasang di workstation assessment lokal (v1.1.0), bukan di VPS.                                                                                                             | Tidak tersedia di VPS                                                                            | N/A (belum diinstall di VPS)                                                                                                   |
| **OpenHands** |    **TIDAK TERPASANG**     | Tidak ditemukan di PATH (`which openhands` kosong).                                                                                                                                                                        | Tidak tersedia                                                                                   | N/A                                                                                                                            |

---

## 5. Yang Masih Belum Teruji (Unverified)

Meskipun status biner dan port telah terbukti secara empiris, hal-hal berikut **wajib ditandai BELUM TERUJI**:

1. **Skema Endpoint & Autentikasi Hermes Daemon (Port 9119)**:
   - Apakah endpoint di port 9119 memakai REST API OpenAPI, WebSocket, atau gRPC?
   - Apakah dibutuhkan API key/Bearer token lokal untuk mengirim prompt ke daemon Hermes?
   - _Tindakan_: Jalankan probe `curl -v http://127.0.0.1:9119/docs` atau `curl -v http://127.0.0.1:9119/health` dari dalam VPS untuk membaca spesifikasi API sebelum adapter backend dihubungkan.
2. **Keterkaitan Proses Port 8000 (Python/Uvicorn)**:
   - Apakah Uvicorn pada port 8000 adalah bagian dari Hermes (misal web dashboard) atau aplikasi independen?
   - _Tindakan_: Inspeksi command line proses `cat /proc/940273/cmdline | tr '\0' ' '`.
3. **Konflik Port 80 & 443 Host dengan Caddy Compose**:
   - Jika port 80 & 443 di host sudah dipakai oleh web server yang ada, port binding pada `docker-compose.yml` harus dialihkan atau web server host difungsikan sebagai reverse proxy ke port Caddy/API.
4. **Playwright Chromium ARM64 Live Execution**:
   - Manifest browser Playwright di Ubuntu ARM64 belum diuji menjalankan browser headless di VPS ini.
5. **Mitigasi Swap 0B**:
   - Host memiliki 0B swap. Jika penggunaan memori mendekati 11 GiB akibat browser automation, proses dapat langsung di-kill oleh Linux OOM killer. Dianjurkan membuat swapfile minimal 4–8 GB di VPS (`fallocate -l 4G /swapfile`).
