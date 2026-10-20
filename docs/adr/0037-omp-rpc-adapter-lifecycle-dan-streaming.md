# ADR 0037: Adapter OMP RPC, Siklus Hidup Proses Sesi, dan Streaming Dua Arah Terverifikasi

## Status
Diterima & Diimplementasikan (Accepted & Verified) - 19 Oktober 2026

## Konteks
Pada Sesi 3 (ADR 0035), pengujian *read-only probe* empiris membuktikan bahwa binary OMP v18.8.4 yang terpasang di host Windows mendukung protokol RPC stdio dua arah melalui argumen CLI `--mode rpc`. Berbeda dengan mode one-shot batch (`-p --mode json`), mode RPC memungkinkan proses agen tetap hidup (*long-lived process*), menerima perintah interaktif (`prompt`, `steer`, `follow_up`, `abort`, `get_state`, `clear_queue`), memancarkan *streaming events* secara inkremental, dan menerima bimbingan di tengah *turn* (*mid-turn steering*) tanpa harus memulai ulang proses dari awal.

ADR ini menetapkan arsitektur adapter OMP RPC di `apps/runtime-bridge`, pemisahan lapisan parsing protokol dari logika bisnis, mesin status siklus hidup sesi, batas sumber daya (*bounded buffering*), serta pembuktian pengujian unit, integrasi fake CLI, dan *live probe* pada binary nyata.

---

## 1. Protokol OMP RPC v18.8.4 yang Terverifikasi

Berdasarkan probe empiris dan fixture protokol yang telah disanitasi (`docs/fixtures/runtime-probes/omp-rpc-handshake-and-get-state.redacted.jsonl`), kontrak komunikasi OMP RPC stdio adalah sebagai berikut:

### 1.1 Inisialisasi & Handshake Frame
Saat dipanggil dengan `omp --mode rpc [--session <id> | --no-session]`, OMP segera memancarkan frame `ready` ke stdout:
```json
{
  "type": "ready",
  "protocolVersion": 1,
  "supportedProtocolVersions": [1, 2],
  "maxFrameBytes": 1048576,
  "maxReassembledFrameBytes": 67108864
}
```
Disusul frame metadata konfigurasi (yang dapat diabaikan dengan aman oleh consumer):
- `available_commands_update`: daftar perintah bawaan yang didukung (`prompt`, `steer`, `follow_up`, `abort`, `get_state`, `clear_queue`, `model`, `switch`, dll.).
- `extension_ui_request`: permintaan update widget UI ekstensi.

### 1.2 Format Perintah Masuk (Stdin)
Perintah dikirimkan dalam format NDJSON (JSON satu baris diakhiri karakter newline `\n`) dengan korelasi ID unik:
- **`prompt`**: `{"id": "<uuid>", "type": "prompt", "prompt": "<teks>"}`
- **`steer`**: `{"id": "<uuid>", "type": "steer", "message": "<teks>"}`
- **`follow_up`**: `{"id": "<uuid>", "type": "follow_up", "message": "<teks>"}`
- **`abort`**: `{"id": "<uuid>", "type": "abort"}`
- **`get_state`**: `{"id": "<uuid>", "type": "get_state"}`
- **`clear_queue`**: `{"id": "<uuid>", "type": "clear_queue"}`

### 1.3 Format Respon Terkorelasi (Stdout)
Setiap perintah dijawab dengan frame `response` yang membawa `id` yang bersesuaian:
```json
{
  "id": "<uuid>",
  "type": "response",
  "command": "prompt",
  "success": true,
  "data": { "sessionId": "..." },
  "error": "..."
}
```

### 1.4 Format Event Streaming (Stdout)
Selama eksekusi *turn*, OMP memancarkan event progres yang dinormalisasi oleh bridge ke `NormalizedRuntimeEvent`:
- `message_update` -> tipe `text` (token bimbingan / respons agen).
- `tool_start` -> tipe `tool_start` (pemanggilan alat lokal/workspace).
- `tool_end` -> tipe `tool_end` (hasil keluaran alat).
- `turn_end` -> penanda penyelesaian turn aktif.

---

## 2. Arsitektur Komponen

Implementasi dipisahkan menjadi dua abstraksi utama di `apps/runtime-bridge/src/omp-rpc-adapter.ts`:

```
+-------------------------------------------------------------+
|                     apps/runtime-bridge                     |
|                                                             |
|  +--------------------+         +------------------------+  |
|  |  POST /v1/runs     |         | POST /v1/runs/:id/steer|  |
|  +---------+----------+         +-----------+------------+  |
|            |                                |               |
|            v                                v               |
|     executeOmpRpc()                  session.steer()        |
|            |                                |               |
|            +---------------+----------------+               |
|                            |                                |
|                            v                                |
|                   +------------------+                      |
|                   |  OmpRpcSession   |                      |
|                   | (Lifecycle/State)|                      |
|                   +--------+---------+                      |
|                            |                                |
|        +-------------------+-------------------+            |
|        | Stdin (NDJSON)                        | Stdout     |
|        v                                       v            |
|  +-----------+                       +-------------------+  |
|  | child.in  |                       |  OmpJsonlParser   |  |
|  +-----------+                       | (Bounded Buffers) |  |
|                                      +---------+---------+  |
|                                                |            |
|                                                v            |
|                                         handleMessage()     |
+------------------------------------------------+------------+
                                                 |
                                                 v
                                   NormalizedRuntimeEvent Stream
```

### 2.1 Bounded Incremental NDJSON Parser (`OmpJsonlParser`)
1. **Pencegahan OOM**: Menggunakan buffer baris dengan ambang batas `MAX_LINE_BUFFER_BYTES = 131_072` (128 KB). Jika chunk diterima tanpa `\n` dan panjang buffer melebihi 128 KB, buffer di-flush seketika dan ditandai `truncated = true`.
2. **Chunk Splitting**: Menangani pemisahan payload JSON di tengah baris atau token secara mulus antar pemanggilan `feed()`.
3. **Multi-event Chunks**: Mendukung chunk yang berisi beberapa baris JSON sekaligus.
4. **Toleransi Baris Malformed**: Baris non-JSON atau teks mentah dicatat tanpa memicu exception dan baris berikutnya tetap diproses normal.
5. **Vendor Extensions / Unknown Events**: Objek JSON dengan event tipe baru/tidak dikenal tetap dipertahankan strukturnya tanpa menyebabkan kegagalan sistem.

### 2.2 Manajer Sesi & Siklus Hidup Proses (`OmpRpcSession`)
1. **Mesin Status Sesi**:
   - `uninitialized` -> `starting` -> `handshaking` -> `ready` <-> `busy` -> `idle` -> `closing` -> `closed` / `crashed`.
2. **Korelasi Perintah**:
   - Setiap pemanggilan `sendCommand()` menyimpan promise penantian pada `Map<string, PendingCommand>` berdasarkan `id`.
   - Timeout perintah dikendalikan oleh timer individual (`commandTimeoutMs`, default 60.000 ms) yang di-unref agar tidak mengunci event loop Node.js.
3. **Pembersihan Idle & Shutdown Anggun**:
   - Jika sesi menganggur melebihi `idleTimeoutMs` (default 300.000 ms), sesi secara otomatis melakukan graceful shutdown (`close()`).
   - Sesi yang sedang sibuk (`busy`) akan mengirimkan perintah `abort()` terlebih dahulu sebelum memutus stdin atau mematikan proses.
4. **Pembersihan Proses Lintas Platform**:
   - Pada Windows, proses dimatikan tuntas beserta seluruh pohon proses anaknya menggunakan `taskkill /pid <PID> /T /F` secara sinkron melalui `spawnSync`.
   - Pada POSIX, proses grup ditutup menggunakan `process.kill(-pid, 'SIGKILL')`.
   - Seluruh stream stdin/stdout/stderr dimusnahkan (`destroy()`) untuk mencegah kebocoran file descriptor.

### 2.3 Integrasi Runtime Bridge
1. **Parameter `RunRequest.mode`**:
   - Nilai opsional `'rpc' | 'oneshot'`. Nilai default adalah `'oneshot'` untuk menjaga kompatibilitas mundur 100%.
2. **Endpoint Baru**:
   - `POST /v1/runs/:id/steer`: Mengirimkan pesan bimbingan mid-turn ke sesi OMP yang sedang berjalan. Jika run tidak dalam mode RPC atau sudah selesai, bridge mengembalikan `400 / 404`.
3. **Penanganan Batal**:
   - `POST /v1/runs/:id/cancel`: Jika run terdaftar memiliki objek `session`, bridge memanggil `session.abort()` untuk menghentikan inferensi model saat itu juga sebelum terminasi proses.

---

## 3. Bukti Empiris & Hasil Verifikasi

Semua acceptance criteria diuji menggunakan unit test, fixture rekaman nyata v18.8.4, fake CLI integration test, dan *live probe* pada binary OMP asli di host Windows:

| Pengujian | Skenario | Hasil Aktual |
|---|---|---|
| **Protocol Fixture** | Parsing rekaman nyata handshake v18.8.4 (`docs/fixtures/.../omp-rpc-handshake-and-get-state.redacted.jsonl`) | **PASS** (10.77 ms) |
| **Parser Robustness** | Chunk terpotong di tengah token, multiple event per chunk, baris malformed, payload asing | **PASS** (0.66 ms) |
| **Fake CLI Lifecycle** | Handshake `ready`, kirim `prompt`, stream event, mid-turn `steer`, `abort`, `get_state`, graceful `close` | **PASS** (518.14 ms) |
| **Crash Handling** | Proses CLI mati mendadak (`exit(1)`) menolak perintah yang menggantung tanpa freeze | **PASS** (509.21 ms) |
| **Timeout Handling** | CLI tidak merespons (unresponsive loop) memicu rejection timeout sesuai batas | **PASS** (2934.65 ms) |
| **Live Binary Probe** | Terhubung ke binary `omp.exe` v18.8.4 nyata di Windows, eksekusi handshake dan `get_state` | **PASS** (2999.01 ms) |
| **Total Test Suite** | Seluruh 23 pengujian di `apps/runtime-bridge` (lama + baru) | **PASS 23/23** (0 gagal) |
| **Typecheck** | Monorepo strict typecheck (`pnpm -r typecheck`) pada 14 proyek | **PASS** (0 error) |
| **Lint** | Monorepo strict lint (`pnpm -r lint`) pada 14 proyek | **PASS** (0 error) |
| **Audit Verification**| Pemeriksaan konsistensi dokumen & path (`pnpm verify:audit`) | **PASS** (100% valid) |

---

## 4. Keamanan & Batas Sumber Daya

1. **Untrusted Runtime Output**: Semua event yang dihasilkan OMP diproses sebagai data tidak tepercaya (*untrusted payload*). Output tidak pernah dapat mengubah izin otorisasi (*SecuredCapabilityGuard*), memperbarui role pengguna, atau melewati *Permission Engine*.
2. **Tidak Ada Kebocoran Rahasia**: Token autentikasi, API keys, dan kredensial server tidak pernah diteruskan ke variabel lingkungan runtime bridge.
3. **Bounded Buffers**: Parser NDJSON dan antrean event dibatasi secara ketat untuk mencegah kehabisan memori (*memory exhaustion*).
4. **Idempotensi & Deduplikasi**: Setiap event dinormalisasi dengan ID unik untuk mencegah duplikasi event pada consumer SSE/WebSocket.
