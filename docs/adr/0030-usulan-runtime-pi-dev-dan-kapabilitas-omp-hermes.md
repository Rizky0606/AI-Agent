# ADR 0030: Evaluasi Kemampuan OMP/Hermes Berdasarkan Probe Empiris dan Usulan Runtime Ketiga pi.dev

## Status
Diusulkan (Proposed)

## Konteks
Pada Sesi 29, dilakukan probe read-only atas izin pemilik terhadap dua runtime eksternal yang terpasang di VPS Oracle Cloud ARM64 (*servernic*):
1. **omp (v18.6.1)**: Fork dari Pi oleh Stencil Labs (`can1357/oh-my-pi`), lisensi MIT.
2. **Hermes Agent (v0.20.5)**: Agent otonom oleh Nous Research, lisensi MIT.

Tujuan probe ini adalah memverifikasi kemampuan nyata (flag CLI, format event JSON/RPC, subagent, plan mode, LSP, memori, status daemon) tanpa halusinasi, menentukan fitur yang aman dikemas ke UI, serta mengevaluasi opsi penambahan runtime ketiga berbasis **pi.dev**.

## Temuan Empiris Probe VPS (18 Oktober 2026)

1. **OMP Event Stream & Mode**:
   - Terbukti mendukung `--mode json -p <prompt> --no-session` yang menghasilkan aliran event JSONL:
     `session` -> `agent_start` -> `turn_start` -> `message_start` -> `message_update` (`text_delta`) -> `message_end` -> `turn_end` -> `agent_end`.
   - Tool bawaan terverifikasi: `read`, `bash`, `edit`, `write`, `grep`, `glob`, `lsp`, `python`, `notebook`, `browser`, `computer`, `task`, `todo`, `web_search`, `ask`.
   - Tool `task` bertugas meluncurkan sub-agent paralel (*"Launch sub-agents for parallel tasks"*).
   - Tool `todo` dan flag `--plan`, `--prewalk`, `--plan-yolo` mengelola daftar rencana langkah eksekusi.
2. **Hermes Execution & Port 9119**:
   - Command `hermes run` tidak ada. Mode non-interaktif terverifikasi via `hermes -z <prompt> --no-restore-cwd --safe-mode` yang mencetak plain text ke stdout.
   - Port 9119 daemon terverifikasi aktif (`/api/health` mengembalikan `{"ok":true,"version":"0.20.5"}`).
   - Rute OpenAPI port 9119 adalah dashboard dan manajemen sistem (`/api/files/*`, `/api/cron/*`, `/api/skills/*`, `/api/sessions/*`, dsb.). Tidak ada endpoint prompt execution via HTTP POST. Oleh karena itu, daemon port 9119 tidak boleh diasumsikan sebagai gateway eksekusi prompt.
3. **Fitur Arahkan (Steer) Sesi 27**:
   - `apps/runtime-bridge` saat ini mengeksekusi OMP dan Hermes dalam mode one-shot batch dengan `stdio: ['ignore', 'pipe', 'pipe']`.
   - Karena stdin ditutup dan eksekusi bersifat one-shot, interupsi atau pengarahan (steering) mid-turn secara langsung ke proses yang sedang berjalan tidak didukung oleh wrapper bridge saat ini. Fitur steer di UI harus diberi keterangan jujur dan dinonaktifkan pada runtime one-shot.
4. **Diagnostik LSP**:
   - OMP memiliki tool `lsp` terpasang, namun integrasi diagnostik LSP dari container Docker worker ke workspace host membutuhkan language server terpasang per bahasa dan mount filesystem dua arah. Ini dicatat sebagai backlog teknis.

## Keputusan

### 1. Pengemasan Fitur ke UI (Sesi 29)
- **Tampilan Rencana (Plan Mode)**:
  - Menambahkan tipe event `'plan'` pada `RuntimeStepType` di `@personal-ai-os/shared`.
  - Normalisasi event OMP JSONL: mendeteksi tool `todo` / `plan` atau payload rencana dan memetakannya ke `type: 'plan'`.
  - Pada UI Windows (`ToolStepCard.tsx` / `TaskCard.tsx`), render kartu Rencana khusus dengan status persetujuan dan daftar butir langkah rencana yang rapi.
- **Progres Sub-Agent di Timeline**:
  - Menambahkan tipe event `'subagent'` pada `RuntimeStepType` di `@personal-ai-os/shared` serta metadata `isSubagent: true`.
  - Normalisasi event OMP JSONL: mendeteksi `tool_start` dengan toolName `task` dan memetakannya ke langkah sub-agent dengan badge visual "Sub-agent".
- **Penanganan Jujur Fitur Arahkan (Steer)**:
  - Pada kartu task yang berjalan dengan runtime one-shot (omp / hermes via bridge saat ini), antarmuka menampilkan keterangan bahwa runtime berjalan dalam mode proses batch tertutup (non-interaktif), sehingga pengarahan interaktif hanya tersedia pada agen bawaan (native) atau sesi dua arah.

### 2. Usulan Runtime Ketiga: pi.dev
- **Identitas Paket**: `@earendil-works/pi-coding-agent` (atau varian upstream Pi berbasis Node.js/TypeScript).
- **Lisensi**: MIT (kompatibel penuh dengan lisensi proyek).
- **Mode Operasi**: Mode RPC berbasis JSONL over stdio (`--mode rpc`).
- **Alasan Pengusulan**:
  1. Bersih dan ringan: Berjalan di Node.js (~150–250 MB RSS) tanpa kompilasi Rust host yang berat.
  2. Protokol RPC 2-arah native: Membuka stdin/stdout terstruktur untuk streaming token seketika dan steering interaktif yang sesungguhnya.
  3. Lisensi aman MIT (bukan AGPL seperti Odysseus).
- **Status Saat Ini**:
  - `which pi` pada VPS menghasilkan kosong (belum terpasang di VPS).
  - **ATURAN KERAS**: Paket ini **TIDAK DIPASANG** pada Sesi 29. Pemasangan dan integrasi menunggu persetujuan eksplisit dari pemilik proyek.

## Konsekuensi
- Memperluas skema `RuntimeStepType` di `@personal-ai-os/shared` dengan tipe `'plan'` dan `'subagent'`.
- Memperbarui `apps/runtime-bridge` untuk mem-parse event `todo` (plan) dan `task` (subagent).
- Memperbarui komponen Windows UI (`ToolStepCard.tsx`) untuk merender kartu rencana dan badge subagent.
- Menjaga kepatuhan aturan tanpa halusinasi dan zero new npm dependency pada sesi ini.
