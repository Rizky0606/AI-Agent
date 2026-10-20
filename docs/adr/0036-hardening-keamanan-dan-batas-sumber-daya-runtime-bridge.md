# ADR 0036: Hardening Keamanan, Workspace Containment, dan Batas Sumber Daya Runtime Bridge

## Status
Diterima & Diimplementasikan (Accepted & Verified) - 19 Oktober 2026

## Konteks
`apps/runtime-bridge` adalah jembatan eksekusi antara control plane dan runtime eksternal (`omp` dan `hermes`) yang berjalan pada VPS host. Mengingat runtime mengeksekusi sub-proses lokal yang berpotensi memproses input tidak tepercaya, audit menyeluruh dan perbaikan kelemahan (hardening) dilakukan pada 8 area kritis tanpa menambah dependensi baru atau memutus kompatibilitas yang ada.

---

## 1. Analisis Gap & Perbaikan yang Diimplementasikan

### 1.1 Token / Autentikasi
- **Gap yang Ditemukan**: Token hanya diperiksa dengan `Buffer.from(value.slice(7))` dan hashing SHA-256 tanpa validasi format sintaks token. Permintaan tanpa autentikasi tidak memicu pencatatan pembatasan frekuensi (rate limit), sehingga membuka celah serangan *brute force*.
- **Perbaikan**:
  - Diterapkan validasi format `TOKEN_REGEX = /^[A-Za-z0-9._~+/-]{32,512}$/` pada pembacaan token file maupun header `Authorization: Bearer <token>`.
  - Token yang tidak sesuai format langsung ditolak sebelum operasi alokasi memory besar.
  - Constant-time comparison tetap dijaga menggunakan `crypto.timingSafeEqual` pada digest SHA-256.
  - Setiap kegagalan otentikasi (401) dicatat dalam penghitung frekuensi `rateLimited()` untuk membatasi laju percobaan peretasan.
  - Header otorisasi dan nilai token dilarang keras dicatat ke log, output error, atau audit trace.

### 1.2 Workspace Containment & Pencegahan Traversal
- **Gap yang Ditemukan**:
  1. Pada Windows, implementasi fungsi `contained()` sebelumnya menggunakan `resolve('/')` yang menghasilkan drive root `C:\`, sehingga pola `value.startsWith('..C:\\')` tidak cocok dengan path relatif traversal seperti `..\outside`.
  2. Fungsi `safePart` sebelumnya hanya membagi path dengan karakter `/` (`value.split('/')`), sehingga path dengan pemisah backslash Windows `\` (misal `project\..\outside`) dapat lolos dari pemeriksaan traversal.
  3. Validasi segmen tidak membatasi karakter khusus Windows seperti titik dua (`:`) pada *NTFS Alternate Data Streams* (`file:stream`) atau drive letters (`C:`).
- **Perbaikan**:
  - `contained(root, candidate)` diperbarui dengan resolusi kanonikal, penanganan pemisah platform (`\` di Windows dan `/` di POSIX), dan perbandingan *case-insensitive* khusus lingkungan Windows.
  - `validateWorkspaceId` dan `validateTaskId` membatasi setiap segmen menggunakan ekspresi ketat `SAFE_SEGMENT_REGEX = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/`.
  - Simbol titik dua (`:`), backslash (`\`), null byte (`\0`), traversal (`..`), dan path absolut langsung ditolak dengan `400 invalid workspaceId` / `invalid taskId`.
  - Pemeriksaan `lstat` dilakukan sebelum dan sesudah `mkdir` untuk mendeteksi *symlink injection*. Jika terdeteksi symlink, eksekusi digagalkan dengan `workspace symlink rejected`.

### 1.3 Environment Child Process (Strict Allowlist)
- **Gap yang Ditemukan**: Fungsi `cleanEnv` sebelumnya menggunakan pendekatan denylist pola regex (`/secret/i`, dll.), yang berisiko meloloskan variabel lingkungan injeksi kode berbahaya seperti `NODE_OPTIONS`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD_INSERT_LIBRARIES`, `GIT_SSH_COMMAND`, `GIT_CONFIG`, atau `PYTHONPATH`.
- **Perbaikan**:
  - Mengubah paradigma dari denylist permisif menjadi **strict allowlist**:
    - **Variabel Dasar**: `PATH` (dibatasi ke direktori bin terdaftar), `HOME`, `LANG: C.UTF-8`, `OMP_NO_UPDATE_CHECK: 1`, dan variabel platform Windows (`SYSTEMROOT`, `COMSPEC`, `PATHEXT`).
    - **Variabel Tambahan (`extra`)**: Hanya mengizinkan kunci terdaftar (`NODE_ENV`, `CI`, `TERM`, `DEBUG`, `LANG`, `SAFE_PROJECT_NAME`) atau kunci dengan awalan eksplisit aman (`SAFE_*`, `PROJECT_*`, `TASK_*`, `APP_*`).
    - **Pemblokiran Keras**: Menolak keras kunci yang cocok dengan `FORBIDDEN_ENV_REGEX` (`NODE_OPTIONS`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, `GIT_*`, dll.) dan `SECRET_ENV_REGEX` (`secret`, `token`, `key`, `password`, `database`, `ninerouter`, `auth`, `fcm`, `cred`).
    - Nilai yang mengandung null byte atau karakter newline (`\0`, `\r`, `\n`) dibuang.

### 1.4 Batas Output, Line Buffer, & Event
- **Gap yang Ditemukan**:
  - Buffer baris `lineBuffer += chunk.toString('utf8')` dapat bertambah tanpa batas jika proses anak memuntahkan output besar secara terus-menerus tanpa karakter newline (`\n`), berpotensi memicu lonjakan memori OOM pada VPS 12 GB RAM.
  - Jumlah event dalam `record.events` tidak memiliki batas atas, membuka celah DoS jika runtime menghasilkan ribuan event per detik.
  - Ukuran payload per event (`text`, `diff`, `planItems`) belum dibatasi.
- **Perbaikan**:
  - Diterapkan `MAX_LINE_BUFFER_BYTES = 131_072` (128 KB). Jika output tanpa newline melebihi batas ini, buffer di-flush, flag `truncated: true` diset, dan alokasi memori tak terbatas dicegah.
  - Baris individual yang melebihi 128 KB diabaikan/dibuang.
  - Diterapkan `MAX_EVENTS_PER_RUN = 1_000`. Event melebihi batas ini tidak dialokasikan ke array memori dan flag `truncated` diset.
  - Payload event dinormalisasi dan dibatasi: `text` $\le 65.536$ karakter, `diff` $\le 65.536$ karakter, `planItems` $\le 100$ item dengan panjang per item $\le 512$ karakter.
  - Total akumulasi output pada `state.output` tetap dibatasi ketat oleh `MAX_OUTPUT = 1_048_576` (1 MB) untuk stdout dan stderr.

### 1.5 Batas Sumber Daya & Siklus Hidup Proses
- **Gap yang Ditemukan**: Pemanggilan `spawn()` tidak memasang listener pada event `'error'`, sehingga jika binary hilang atau gagal dieksekusi (`ENOENT`), Node.js akan memicu `uncaughtException` yang merobohkan seluruh server bridge.
- **Perbaikan**:
  - Ditambahkan listener `child.once('error', (err) => ...)` yang mencatat `record.error = spawn failed: ...` dan mengakhiri penantian status secara elegan tanpa crash.
  - Timeout eksekusi per tugas dibatasi antara 1 ms hingga `MAX_TIMEOUT = 900_000` ms (default 300_000 ms).
  - Terminasi proses (`killProcess`) dilakukan secara platform-aware: pohon proses dibunuh tuntas menggunakan `taskkill /pid <PID> /T /F` di Windows dan pembunuhan process group `-child.pid` dengan `SIGKILL` di Linux (`detached: true`).
  - Antrean (`MAX_QUEUE = 32`) dan konkurensi (`MAX_CONCURRENCY = 2`) ditegakkan dengan respon `429` saat kapasitas penuh.

### 1.6 SSRF & Keamanan Jaringan
- Header `Host` tidak dipercaya untuk routing internal. URL parsing menggunakan basis lokal aman `http://127.0.0.1`.
- Binding default server bridge tetap terkunci pada antarmuka privat/VPN `172.20.0.1` (atau `127.0.0.1`).

### 1.7 Audit Logging yang Diredaksi
- Format log audit `runtime-bridge.audit.jsonl` dipastikan hanya mencatat metadata minimum yang diperlukan untuk ketelusuran operasional:
  - Diizinkan: `timestamp`, `event`, `runId`, `taskId`, `runtimeId`, `status`, `durationMs`, `exitCode`, `truncated`, `eventCount`.
  - Dilarang Keras & Dihapus Otomatis: `prompt`, `output`, `token`, `environment`, `secret`, `authorization`, `password`, `key`.

### 1.8 Eksekusi Sub-proses Platform-Aware
- Parameter `shell: false` dipertahankan untuk mencegah eksekusi shell implisit yang rentan injeksi.
- Di Windows, pemanggilan command wrapper (`cmd.exe /d /s /c`) menggunakan parameter terkuotasi aman dan diverifikasi terhadap vektor injeksi karakter batch.

---

## 2. Kompatibilitas Mundur (Backward Compatibility)
- **API Kontrak**: Seluruh endpoint REST (`/health`, `/v1/runtimes`, `/v1/runs`, `/v1/runs/:id`, `/v1/runs/:id/events`, `/v1/runs/:id/cancel`) tetap mempertahankan skema request/response yang sama.
- **Format Event**: Event normalisasi `text`, `tool_start`, `tool_end`, `file_edit`, `plan`, `subagent`, `error` tetap kompatibel 100% dengan `apps/agent-worker` dan `packages/agent-core`.
- **Tidak Memerlukan Migrasi**: Tidak ada perubahan skema database PostgreSQL atau protokol pesan Redis.

---

## 3. Bukti Verifikasi Pengujian

| Pengujian | File Uji | Status | Bukti |
| :--- | :--- | :--- | :--- |
| **Token Format & Rejection** | `apps/runtime-bridge/test/hardening.test.ts` | **PASS** | Token non-RFC/terlalu pendek/panjang/karakter liar ditolak. |
| **Workspace Containment** | `apps/runtime-bridge/test/hardening.test.ts` | **PASS** | Traversal `..`, `\`, drive letters, colon, case-insensitivity Windows lulus. |
| **Environment Allowlist** | `apps/runtime-bridge/test/hardening.test.ts` | **PASS** | `NODE_OPTIONS`, `LD_PRELOAD`, `DATABASE_URL` terbukti dibuang; `SAFE_*` diizinkan. |
| **Output & Line Bounds** | `apps/runtime-bridge/test/hardening.test.ts` | **PASS** | `parseOmpLine` membatasi text $\le 64$KB, diff $\le 64$KB, plan $\le 100$ item. |
| **Massive Stream No-Newline**| `apps/runtime-bridge/test/index.test.ts` | **PASS** | Chunk 200 KB tanpa `\n` memicu `truncated: true` dan membersihkan line buffer. |
| **Audit Log Redaction** | `apps/runtime-bridge/test/index.test.ts` | **PASS** | File `audit.jsonl` terbukti 0 baris membocorkan prompt, output, token, atau secret. |
| **Process Cancellation** | `apps/runtime-bridge/test/index.test.ts` | **PASS** | Pembunuhan pohon proses mentransisikan status ke `cancelled` secara nyata. |
| **Monorepo Typecheck** | `pnpm -r typecheck` | **PASS** | 14 workspace package lulus tsc strict tanpa error. |
| **Monorepo Lint** | `pnpm -r lint` | **PASS** | 14 workspace package lulus eslint `--max-warnings=0`. |
