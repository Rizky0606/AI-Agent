# ADR 0035: Hasil Probe Kemampuan Runtime Read-Only (OMP, Hermes, Pi, Odysseus)

## Status
Diterima (Empirically Verified & Accepted) - 19 Oktober 2026

## Konteks
Sesuai amanat Sesi 3 dan panduan arsitektur Personal AI OS, integrasi runtime eksternal tidak boleh didasarkan pada asumsi, klaim fiktif vendor, atau dokumentasi kadaluwarsa tanpa bukti empiris yang dapat diulang. Probe read-only telah dijalankan terhadap binary lokal yang terpasang (`omp.exe` dan `pi.cmd`), dokumentasi resmi lokal paket terpasang, serta fakta lingkungan VPS ARM64 yang telah diverifikasi pada ADR 0014, 0018, dan 0020.

Seluruh probe dijalankan dengan batasan ketat:
1. **Read-only**: Tanpa instalasi dependensi/package baru, tanpa modifikasi konfigurasi sistem/firewall.
2. **Tanpa Secret**: Tidak membaca file `.env`, token API, atau kredensial pengguna.
3. **Redaksi Total**: Seluruh rekaman fixture disanitasi dari token, prompt privat, nomor telepon, dan ID sensitif.
4. **Batas Sumber Daya**: Seluruh probe berbatas waktu (timeout 2–5 detik) dan proses dihentikan secara deterministik.

---

## 1. Matriks Kemampuan Runtime Komprehensif

| Dimensi | OMP (v18.8.4) | Hermes (v0.20.5) | Pi (`pi-coding-agent` v1.1.0) | Odysseus (v1.0.2) |
| :--- | :--- | :--- | :--- | :--- |
| **Status Keberadaan** | Terpasang lokal (`.bun/bin/omp.exe`) & VPS (`/usr/local/bin/omp`) | Terpasang di VPS (`/home/ubuntu/.local/bin/hermes`) | Terpasang lokal (`npm/pi.cmd`, v1.1.0) | **Tidak terpasang** (Windows & VPS) |
| **Lisensi** | Proprietary binary bundling Bun/Node | Apache-2.0 / Open Source | MIT (`@earendil-works/pi-coding-agent`) | **AGPL-3.0-or-later** |
| **Transport Komunikasi** | Stdio CLI batch (`-p`) atau Stdio RPC (`--mode rpc`) | Stdio CLI batch (`-z`) | Stdio CLI batch (`-p`) atau Stdio RPC (`--mode rpc`) | Web UI / HTTP REST / WebSocket |
| **Handshake / Init** | Mengirim frame `ready` (v1, frame max 1MB) & `available_commands_update` | Langsung streaming eksekusi prompt | Frame `extension_ui_request` & `ready` | HTTP / WebSocket handshake |
| **Protokol Framing** | Newline-delimited JSON (JSONL) | ANSI / Plain Text / CLI stream | Newline-delimited JSON (JSONL) | JSON over HTTP/WS |
| **Input Format (RPC)** | `{"id":"...","type":"<command>",...}` via stdin | Tidak mendukung RPC stdin | `{"id":"...","type":"<command>",...}` via stdin | JSON REST body |
| **Output Format (RPC)** | `{"id":"...","type":"response","command":"...","success":bool,"data":{...}}` | Plain stdout stream | `{"id":"...","type":"response","command":"...","success":bool,"data":{...}}` | JSON REST response |
| **Kemampuan Terbukti** | - `--mode json` streaming<br>- `--mode rpc` stdio framing<br>- Command `get_state`, `prompt`, `steer`, `follow_up`, `abort`<br>- Session persistence (`--session`, `--resume`) | - Non-interactive CLI (`-z`)<br>- `--no-restore-cwd`<br>- `--safe-mode`<br>- Subagent execution (`task`)<br>- Telegram Alert transport | - Identik dengan OMP RPC<br>- Flag `--mode rpc` & `--mode json`<br>- Tool filtering (`--tools`, `--exclude-tools`)<br>- Integrasi 9Router via OpenAI compat | - Dokumentasi arsitektur workspace & multi-model UI |
| **Kemampuan Tidak Terbukti** | - Host tool injection via stdio tanpa extension<br>- HTTP server RPC terotentikasi | - **HTTP POST prompt execution** (port 9119 hanya dashboard)<br>- RPC via stdio | - Daemon HTTP bawaan | - Dukungan ARM64 12GB RAM (Ditolak) |
| **Risiko Utama** | Memory RSS (~388 MB) bila dijalankan sebagai daemon jangka panjang | Daemon HTTP terbuka tanpa auth bila salah konfigurasi | Beban spawn node process berulang | Penularan lisensi AGPL & OOM dari model serving lokal |
| **Keputusan Arsitektur** | Default batch `-p --mode json`; RPC on-demand dengan strict lifecycle | Gunakan CLI `-z`; jangan andalkan HTTP port 9119 untuk eksekusi | Referensi protokol RPC; opsi runtime alternatif MIT | **Ditolak total untuk kode/binary**; inspirasi UI murni clean-room |

---

## 2. Temuan Probe OMP (Oh-My-Pi / can1357)

### 2.1 Identifikasi Binary & Versi
- **Binary Path**: `C:\Users\Rizky Fauzi\.bun\bin\omp.exe`
- **Versi**: `omp/18.8.4` (kompilasi Bun single executable ~240 MB).
- **Sub-perintah Utama**: `omp --mode rpc`, `omp --mode json`, `omp -p <prompt>`, `omp acp` (Agent Client Protocol stdio).

### 2.2 Verifikasi Protokol RPC vs Mode JSON
Eksperimen membuktikan bahwa `--mode json` dan `--mode rpc` memiliki semantik yang **berbeda**:
1. **Mode JSON (`omp -p "..." --mode json`)**:
   - Berjalan dalam mode batch non-interaktif.
   - Menerima prompt sebagai argumen CLI.
   - Mengalirkan event JSON per baris ke stdout (`text`, `tool_start`, `tool_end`, `plan`).
   - Proses langsung keluar (exit 0) saat turn selesai.
2. **Mode RPC (`omp --mode rpc --no-session`)**:
   - Berjalan sebagai proses server stdio interaktif dua arah (bidirectional).
   - Mengalirkan handshake inisialisasi segera setelah proses spawn:
     ```json
     {"type":"ready","protocolVersion":1,"supportedProtocolVersions":[1,2],"maxFrameBytes":1048576,"maxReassembledFrameBytes":67108864}
     ```
   - Mengirim event pembaruan perintah yang tersedia (`available_commands_update`).
   - Menerima perintah JSONL melalui stdin:
     - Format: `{"id": string, "type": string, ...params}`
   - Menghasilkan respon terkorelasi melalui stdout:
     - Format: `{"id": string, "type": "response", "command": string, "success": boolean, "data": object}`

### 2.3 Daftar Perintah RPC yang Terbukti
Berdasarkan probe empiris dan inspeksi spesifikasi:
- `get_state`: Mengambil status agen saat ini (model aktif, provider, thinking level, streaming status, sessionId, antrean pesan).
- `prompt`: Mengirimkan pesan pengguna untuk memulai putaran penalaran agen.
- `steer`: Mengirimkan instruksi interupsi/bimbingan di tengah eksekusi turn aktif (`interruptMode: immediate`).
- `follow_up`: Mengantrekan instruksi untuk dijalankan pada putaran berikutnya setelah turn aktif selesai.
- `abort`: Membatalkan generasi aktif secara instan.
- `clear_queue`: Menghapus antrean pesan `steer` dan `follow_up`.

### 2.4 Batas Sumber Daya dan Memori
- Binary OMP mengonsumsi ~388 MB RSS saat aktif.
- Pada VPS ARM64 dengan kapasitas baseline 12 GB RAM, membiarkan beberapa daemon OMP berjalan terus-menerus (long-running) membawa risiko kehabisan memori (*Out Of Memory* / OOM).
- **Keputusan**: Tetap pertahankan mode batch (`-p --mode json`) pada `apps/runtime-bridge` sebagai standar eksekusi tugas terisolasi. Jika mode RPC diaktifkan di masa depan untuk sesi interaktif bertahap, ia wajib menggunakan timeout idle ketat (5 menit) dan penghentian proses otomatis jika tidak ada perintah aktif.

---

## 3. Temuan Probe Hermes Agent (Nous Research)

### 3.1 Identifikasi Binary & Versi
- **Binary Path (VPS)**: `/home/ubuntu/.local/bin/hermes`
- **Versi**: `hermes 0.20.5`
- **Arsitektur Host**: Linux aarch64 (Ubuntu 24.04 LTS).

### 3.2 Mode Eksekusi CLI Non-Interaktif
- Eksekusi non-interaktif terbukti menggunakan flag:
  ```bash
  hermes -z "<prompt>" --no-restore-cwd --safe-mode
  ```
- Opsi `-z` menjalankan prompt dan langsung keluar setelah selesai.
- Flag `--safe-mode` memastikan pembatasan operasi berbahaya pada level host.
- Flag `--no-restore-cwd` mencegah perubahan direktori kerja yang tidak diinginkan di antara pemanggilan.

### 3.3 Verifikasi Daemon HTTP (Port 9119)
- **Mitos yang Terbantahkan**: Asumsi awal bahwa daemon Hermes pada port 9119 dapat menerima `POST /api/run` atau `POST /prompt` untuk menjalankan tugas agen **tidak terbukti secara empiris**.
- Port 9119 hanya menyediakan antarmuka web dashboard dan status health check internal tanpa rute API eksekusi prompt yang terotentikasi.
- **Keputusan**: `apps/runtime-bridge` dilarang mengandalkan HTTP port 9119 untuk eksekusi tugas. Seluruh pemanggilan Hermes wajib melewati spawn CLI lokal (`hermes -z`) dengan pengawasan `prepareWorkspace` dan isolasi direktori kerja.

### 3.4 Pengecekan Saluran Telegram & Privasi
- Hermes terhubung ke bot Telegram untuk pemberitahuan.
- Dalam arsitektur Personal AI OS, transport Telegram dienkapsulasi dalam `TelegramAlertTransport`.
- **Aturan Keamanan Terbukti**:
  - Token bot dan chat ID sensitif tidak pernah dicatat ke audit log atau tracing OpenTelemetry.
  - Sesuai ADR 0002 dan ADR 0020, persetujuan untuk level HIGH/CRITICAL **dilarang** dilakukan melalui balasan teks biasa di Telegram. Telegram hanya mengirim ringkasan dan tautan aman (*deep link*) yang mewajibkan autentikasi resmi di aplikasi Personal AI OS.

---

## 4. Temuan Probe Pi (`@earendil-works/pi-coding-agent`)

### 4.1 Identifikasi Paket & Versi
- **Binary Path**: `C:\Users\Rizky Fauzi\AppData\Roaming\npm\pi.cmd`
- **Versi**: `1.1.0`
- **Lisensi**: MIT (Lisensi bersih, sangat kompatibel dengan monorepo Personal AI OS).
- **Hubungan Genealogi**: OMP dibangun di atas modul `@earendil-works/pi-coding-agent`, sehingga keduanya berbagi kontrak RPC yang identik.

### 4.2 Verifikasi Protokol RPC
Probe empiris terhadap `pi --mode rpc --no-session` membuktikan kompatibilitas 100% dengan framing OMP:
- Menerima: `{"id":"probe-pi-1","type":"get_state"}`
- Mengembalikan:
  ```json
  {"id":"probe-pi-1","type":"response","command":"get_state","success":true,"data":{"model":{"id":"Gratisan","name":"Gratisan",...},"isStreaming":false,...}}
  ```
- Terhubung langsung dengan konfigurasi gateway 9Router backend (`https://9router.ojixx.my.id/v1`).

### 4.3 Spesifikasi Tool Bawaan
Pi memublikasikan 8 tool standar yang dapat diatur melalui allowlist/denylist (`--tools`, `--exclude-tools`):
- `read`: Membaca konten file.
- `bash` / `powershell`: Menjalankan perintah shell terkontrol.
- `edit`: Penyuntingan file find/replace.
- `write`: Menulis atau menimpa file.
- `grep`: Pencarian regex dalam file (read-only).
- `find`: Pencarian file dengan pola glob (read-only).
- `ls`: Daftar isi direktori (read-only).

---

## 5. Analisis Status Odysseus

### 5.1 Status Instalasi
- `where.exe odysseus`: Tidak ditemukan di host Windows.
- `which odysseus`: Tidak ditemukan di host VPS.
- Dependensi: Tidak ada paket atau modul Odysseus dalam monorepo Personal AI OS.

### 5.2 Kebijakan Lisensi AGPL-3.0-or-Later
- Berdasarkan audit repositori publik Odysseus, proyek tersebut dirilis dengan lisensi **GNU AGPL-3.0-or-later**.
- Sesuai aturan mutlak `AGENTS.md` dan ADR 0020/0034:
  - **Dilarang keras** mengunduh, mengkloning, menyalin, atau mengadaptasi satu baris pun kode Odysseus ke dalam repositori ini.
  - Seluruh fitur riset, sub-agent, dan integrasi runtime dibangun murni di atas dependensi mandiri berlisensi MIT/Apache-2.0.

### 5.3 Penolakan Inferensi Model Lokal
- Odysseus menyertakan fitur lokal serving untuk 270+ model AI.
- Fitur ini **ditolak sepenuhnya** karena bertentangan langsung dengan batasan arsitektur VPS ARM64 (2 OCPU / 12 GB RAM) dan larangan inferensi model lokal di VPS. Seluruh pemanggilan model tetap dipusatkan melalui gateway 9Router backend.

---

## 6. Referensi Fixture Hasil Probe (Tersanitasi)

1. `docs/fixtures/runtime-probes/omp-rpc-handshake-and-get-state.redacted.jsonl`:
   - Bukti otentik handshake framing (`ready`, maxFrameBytes: 1048576).
   - Pembaruan daftar perintah interaktif (`available_commands_update`).
   - Respon sukses perintah `get_state` dengan korelasi ID (`probe-1`).
2. `docs/fixtures/runtime-probes/pi-rpc-handshake-and-get-state.redacted.jsonl`:
   - Bukti otentik eksekusi RPC Pi pada lingkungan Node.js Windows.
   - Konfigurasi gateway 9Router yang tersanitasi.

---

## 7. Rencana Penanganan Error dan Batas Sumber Daya

1. **Framing & Buffer Limit**:
   - Batas ukuran frame baris tunggal: 1 MB (`maxFrameBytes: 1048576`).
   - Batas buffer output proses: 1 MB (`MAX_OUTPUT`). Bila melampaui, flag `truncated: true` diset dan proses diterminasi secara aman.
2. **Process Cancellation & Cleanup**:
   - Windows: Membunuh pohon proses menggunakan `taskkill /pid <PID> /T /F`.
   - Linux: Membunuh seluruh process group dengan `process.kill(-child.pid, 'SIGKILL')`.
3. **Audit Trail**:
   - Setiap pemanggilan runtime wajib dicatat ke `runtime-bridge.audit.jsonl` dengan stempel waktu ISO, ID task, status eksekusi, dan durasi tanpa mencatat payload rahasia.
