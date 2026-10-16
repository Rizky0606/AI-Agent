# ADR 0013: Sesi OMP Persisten, Streaming Normalisasi Event, dan Kontrol Sumber Daya

**Status**: Diterima (Accepted)  
**Tanggal**: 15 Oktober 2026 (Sesi 12)  
**Pengambil Keputusan**: Principal Software Architect & AI Agent Systems Engineer  
**Konteks**: SESI 12 — Sesi OMP Persisten dan Streaming  

---

## 1. Konteks & Masalah

Pada arsitektur *runtime bridge* (`apps/runtime-bridge`), eksekutor host binary `omp` (v18.6.1) sebelumnya dijalankan dengan flag `--no-session`, sehingga:
1. Tidak ada persistensi konteks antar langkah per percakapan/proyek. Setiap pemanggilan memulai konteks dari nol.
2. Output dikumpulkan sebagai teks mentah (`output`) dan dikirim hanya berupa snapshot status berkala lewat SSE tanpa mem-parsing event JSONL (`session`, `agent_start`, `turn_start`, `message_update`, `tool_start`, `tool_end`, `file_edit`, `turn_end`, `agent_end`).
3. UI klien (Windows & Android) tidak dapat menampilkan timeline langkah interaktif secara terperinci (seperti pemanggilan tool dan diff file edit).
4. Tombol Pause/Resume pada UI klien ditampilkan secara generik padahal runtime CLI tidak mendukung penjedaan proses OS secara semantik (hanya pembatalan/SIGKILL).
5. Konkurensi bridge sebelumnya dibatasi 1 proses aktif global, belum mendukung konkurensi terkonfigurasi (maksimal 2 sesuai kapasitas 2 OCPU / 12 GB RAM VPS) dengan antrean terurut.

---

## 2. Keputusan Arsitektur

### 2.1 Sesi Persisten & Resume Berbasis Workspace Realpath
- `RunRequest` diperluas dengan atribut opsional `sessionId` dan `resume`.
- Untuk `omp`:
  - Jika `sessionId` diberikan, `omp` dijalankan dengan `--session <sessionId>` (tanpa flag `--no-session`).
  - Direktori sesi disimpan di dalam direktori workspace proyek yang tervalidasi `realpath` (`<workspaceRoot>/<projectId>/<taskDir>/.omp-session`).
  - Percakapan/task dapat di-resume dengan menyertakan `sessionId` yang sama dan flag `resume: true`.
  - Jika `sessionId` tidak disertakan (one-shot task), bridge tetap menggunakan `--no-session`.

### 2.2 Normalisasi Event & Streaming SSE Realtime
- Output JSONL dari stdout `omp --mode json` di-parse per baris secara streaming menggunakan line buffer.
- Event dinormalisasi ke struktur internal `NormalizedRuntimeEvent`:
  ```typescript
  export type RuntimeEventType = 'text' | 'tool_start' | 'tool_end' | 'file_edit' | 'error' | 'completed';

  export interface NormalizedRuntimeEvent {
    id: string;
    type: RuntimeEventType;
    timestamp: string;
    data: {
      text?: string;
      toolName?: string;
      input?: unknown;
      output?: unknown;
      path?: string;
      diff?: string;
      error?: string;
    };
    raw?: unknown;
  }
  ```
- Endpoint `GET /v1/runs/:id/events` menyiarkan event SSE bertipe `runtime_event` seketika saat event terjadi, selain snapshot status reguler.
- Di sisi worker (`apps/agent-worker`), event dinormalisasi menjadi `task.tool_call` dan `task.progress` (dengan metadata `diff` dan `path`), disimpan ke `task_events`, dan disiarkan melalui WebSocket `/v1/events/ws` ke seluruh klien aktif.
- Seluruh output runtime tetap diperlakukan sebagai **tidak tepercaya** (`untrusted: true`).

### 2.3 Evaluasi Permission Engine untuk Aksi Runtime
- Setiap aksi yang diusulkan atau dihasilkan runtime (`command`, `file_write`, `file_delete`) dievaluasi oleh `PermissionEngine` dan `SecuredCapabilityGuard`.
- Aksi berisiko `HIGH` atau `CRITICAL` (misal modifikasi file sistem di luar workspace, perintah destruktif) wajib menahan task pada status `waiting_approval` hingga persetujuan pengguna diberikan.
- Aksi `git push`, `git merge`, atau deploy produksi secara ketat **ditolak** (deny-by-default).

### 2.4 Kebijakan UI Klien (Kejujuran Semantik)
- **Tombol Stop / Batalkan**: Ditampilkan sebagai kontrol utama untuk menghentikan proses runtime yang sedang berjalan (mengirim sinyal pembatalan ke bridge yang membunuh process group).
- **Tombol Pause / Resume**: Hanya ditampilkan jika task atau runtime secara eksplisit mendukung jeda (`task.payload?.supportsPause === true`). Untuk runtime host CLI `omp`/`hermes`, jeda tidak didukung secara semantik sehingga tombol Jeda/Lanjutkan disembunyikan agar tidak membohongi pengguna.
- **Visualisasi Timeline**: Menampilkan pemanggilan tool, teks streaming, dan pratinjau diff baris (hijau `+` / merah `-`) pada perubahan file.

### 2.5 Kontrol Sumber Daya VPS & Isolasi Lingkungan
- Konkurensi maksimum dibatasi terkonfigurasi `RUNTIME_MAX_CONCURRENCY` (default **2** proses bersamaan).
- Antrean FIFO berkapasitas maksimal `RUNTIME_MAX_QUEUE` (default **32**).
- Pembatalan atau timeout membunuh seluruh process group (`process.kill(-child.pid, 'SIGKILL')` pada Unix atau pembunuhan proses terisolasi pada Windows).
- Isolasi Environment: fungsi `cleanEnv()` menyaring secara ketat variabel lingkungan proyek dan rahasia (`DATABASE_URL`, `NINEROUTER_API_KEY`, `JWT_SECRET`, token otentikasi), hanya menyuntikkan variabel OS standar (`PATH`, `HOME`, `LANG`, `SYSTEMROOT`).

---

## 3. Konsekuensi

### Positif
- Pengguna dapat melanjutkan konteks pengerjaan coding antar task tanpa mengulang prompt awal.
- Feedback eksekusi runtime muncul seketika per-langkah (streaming) di Windows dan Android, bukan menunggu seluruh task selesai.
- Keamanan terjamin: aksi destruktif runtime tetap tunduk pada persetujuan pengguna, dan tidak ada kebocoran rahasia proyek ke subproses host.
- UI jujur: tidak ada ilusi tombol pause jika proses tidak dapat dijeda.

### Batasan
- Sesi persistent membutuhkan ruang penyimpanan file sesi di direktori workspace.
- Jika pengguna membatalkan task di tengah eksekusi file edit, perubahan yang belum di-commit pada branch git lokal perlu dibersihkan secara manual atau otomatis oleh workspace manager.
