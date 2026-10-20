# ADR 0044: Adaptor Runtime Opsional Pi (`pi.dev` / `@earendil-works/pi-coding-agent`)

- **Status**: Diterima (Accepted) - Implementasi Terisolasi dengan Feature Flag Default OFF
- **Tanggal**: 20 Oktober 2026
- **Pengambil Keputusan**: Principal Software Architect, Senior Full-Stack Engineer, AI Agent Systems Engineer, Security Engineer, QA Engineer
- **Area**: Agent Core (`packages/agent-core/src/runtimes/pi-adapter.ts`), Runtime Manager, Kebijakan Keamanan & Gateway Model
- **Referensi Terkait**:
  - ADR 0001 (Backend-Only Model Gateway)
  - ADR 0002 (Control Plane, Execution Plane & Permissions)
  - ADR 0013 (Sesi OMP Persisten dan Streaming)
  - ADR 0019 (Host Runtime Bridge)
  - ADR 0020 (Pemetaan Fitur Runtime)
  - ADR 0030 (Usulan Runtime pi.dev & Lisensi MIT)
  - ADR 0033 (Penetapan Mode Batch OMP & Desain RPC pi.dev)
  - ADR 0035 (Hasil Probe Kemampuan Runtime Read-Only OMP, Hermes, Pi, Odysseus)
  - ADR 0037 (OMP RPC Adapter Lifecycle dan Streaming)

---

## 1. Konteks & Latar Belakang

Pada evaluasi runtime repositori (ADR 0030, ADR 0033, dan ADR 0035), runtime eksternal dievaluasi untuk mendukung eksekusi tugas koding asisten Personal AI OS:
1. **OMP (Oh-My-Pi)**: Biner Rust/Bun (~240–388 MB RSS) yang berjalan di VPS Oracle Cloud ARM64 dalam mode batch per-run terisolasi (`-p --mode json`).
2. **Hermes Agent**: Agent CLI Python (v0.20.5) untuk otomasi host CLI (`-z --safe-mode`).
3. **Pi (`@earendil-works/pi-coding-agent`, v1.1.0)**: Paket koding agen berbasis Node.js/TypeScript dengan lisensi bersih MIT. Berjalan native di atas Node.js (~150–250 MB RSS) dengan protokol JSON-RPC dua arah melalui stdio (`--mode rpc`).

### Status Keberadaan Host (Audit Sesi 1 & Sesi 3)
- **VPS Oracle Cloud ARM64 (`servernic`)**:
  - Pemeriksaan `which pi` menghasilkan **kosong** (belum terpasang di VPS).
  - Sesuai aturan kerja `AGENTS.md` dan Gate Sesi 12: **Dilarang memasang binary/package Pi di VPS, dilarang menjalankan `npm install` atau mengubah lockfile pnpm monorepo tanpa izin tertulis terpisah dari pemilik proyek**.
- **Host Pengembang Windows**:
  - Terdeteksi `pi.cmd` (v1.1.0) pada direktori npm global pengguna (`C:\Users\Rizky Fauzi\AppData\Roaming\npm\pi.cmd`).
  - Probe empiris read-only terverifikasi pada ADR 0035 dengan rekaman tersanitasi di `docs/fixtures/runtime-probes/pi-rpc-handshake-and-get-state.redacted.jsonl`.

Tantangannya adalah menyediakan abstraksi adaptor runtime Pi yang siap pakai secara opsional, terisolasi, dan aman, tanpa melanggar batasan VPS, tanpa menambah dependensi baru pada monorepo, serta menegakkan gerbang izin (*Permission Engine*) dan rute model backend (*9Router*).

---

## 2. Keputusan Arsitektur

### 2.1 Pola Integrasi: Subclass `BaseAgentRuntime` Murni (Anti-Cross-Cutting If/Else)
1. **Tidak Ada `if/else Pi` di Seluruh Layer**:
   - Adaptor diimplementasikan sebagai kelas mandiri `PiRuntimeAdapter` di [packages/agent-core/src/runtimes/pi-adapter.ts](file:///c:/Coding/Project/AI-Agent/packages/agent-core/src/runtimes/pi-adapter.ts) yang meng-extend `BaseAgentRuntime`.
   - Modul koding atau router mengonsumsi Pi melalui antarmuka standar `AgentRuntime` yang dikelola oleh `RuntimeManager`.
2. **Zero New Monorepo Dependencies**:
   - Komunikasi stdio child process dibangun murni menggunakan modul bawaan Node.js (`node:child_process`, `node:crypto`, `node:stream`, `node:fs`).
   - Tidak ada paket npm baru yang ditambahkan ke `package.json` dan tidak ada modifikasi pada `pnpm-lock.yaml`.

### 2.2 Feature Flag Default OFF (Fail-Closed)
1. **Kebijakan Default Nonaktif**:
   - Adaptor mengadopsi konfigurasi `enabled: false` secara default (`PI_RUNTIME_ENABLED=false`).
2. **Penanganan Fail-Closed**:
   - Jika `enabled: false` atau variabel lingkungan `PI_RUNTIME_ENABLED !== 'true'`:
     - `getStatus()` mengembalikan `'uninitialized'`.
     - `healthCheck()` secara jujur mengembalikan `{ healthy: false, error: 'Pi runtime is disabled by feature flag (PI_RUNTIME_ENABLED=false)' }`.
     - Panggilan `execute()` langsung gagal dengan status `'failed'` dan pesan error eksplisit tanpa melakukan spawn proses atau silent fallback palsu.
3. **Deteksi Binary Eksplisit**:
   - Jika feature flag diaktifkan tetapi biner `pi` tidak ditemukan di `PATH` host, `healthCheck()` mengembalikan status tidak sehat (`healthy: false`), dan `getStatus()` mengembalikan `'stopped'`.

### 2.3 Kepatuhan Protokol RPC Pi v1.1.0 (`@earendil-works/pi-coding-agent`)
Protokol RPC stdio diterapkan sesuai bukti probe empiris ADR 0035:
1. **Framing & Buffer Limit**:
   - Stdio framing berbasis baris tunggal JSON (JSONL).
   - Diurai oleh parser inkremental `PiJsonlParser` dengan pembatasan memori (`maxLineBytes: 131,072` / 128 KB per baris, `maxOutputBytes: 1,048,576` / 1 MB total output). Baris yang melampaui batas dibuang dan ditandai `truncated: true` untuk mencegah ledakan memori.
2. **Handshake Inisialisasi**:
   - Menunggu frame inisialisasi `ready` dari stdout Pi (`protocolVersion: 1`, frame buffer metadata).
   - Timeout inisialisasi dibatasi 15 detik (`DEFAULT_PI_HANDSHAKE_TIMEOUT_MS`).
3. **Perintah & Korelasi Respon**:
   - Mengirim perintah JSONL ber-ID unik (`randomUUID`):
     - `get_state`: Validasi status agen, model aktif, dan konfigurasi gateway.
     - `prompt`: Mengirim instruksi turn pengguna.
     - `steer`: Mengirim pesan interupsi di tengah turn.
     - `follow_up`: Mengantrekan instruksi untuk turn berikutnya.
     - `abort`: Membatalkan generasi aktif.
     - `clear_queue`: Menghapus antrean pesan.
   - Mengorelasikan respon stdout berdasarkan pencocokan field `id`.
4. **Pembersihan Pembatalan & Timeout**:
   - Jika task dibatalkan via `cancel(taskId)` atau waktu batas terlampaui (`DEFAULT_PI_TIMEOUT_MS: 300_000` / 5 menit):
     - Mengirim frame `{"id": "...", "type": "abort"}` melalui stdin.
     - Membunuh seluruh pohon proses secara deterministik (`taskkill /pid <pid> /T /F` di Windows, `process.kill(-pid, 'SIGKILL')` di Unix).
     - Menolak seluruh promise perintah RPC yang tertunda dengan error `Task cancelled`.

### 2.4 Penegakan Gateway Model Tunggal 9Router
Sesuai ADR 0001 dan aturan mutlak repositori:
1. **Injeksi Endpoint Gateway**:
   - Proses subproses Pi dijalankan dengan environment yang dikunci ke gateway backend:
     `OPENAI_BASE_URL: 'https://9router.ojixx.my.id/v1'`
     `NINE_ROUTER_URL: 'https://9router.ojixx.my.id/v1'`
2. **Validasi Respon `get_state`**:
   - Segera setelah handshake, adaptor memanggil `get_state` dan memvalidasi `data.model.baseUrl`.
   - Jika Pi melaporkan endpoint gateway yang tidak sah atau mencoba mem-bypass 9Router (misal: mengarah langsung ke server model luar), adaptor langsung membatalkan eksekusi dengan `Security Policy Violation` dan menghentikan proses.

### 2.5 Kebijakan Ekstensi (Anti-Dynamic 3rd-Party Extensions)
1. **Hak Akses Ekstensi**:
   - Ekstensi Pi berjalan dengan hak akses penuh proses OS pengguna/host.
   - Pemuatan ekstensi pihak ketiga secara dinamis dilarang keras.
2. **Penegakan Flag CLI**:
   - Biner Pi dipanggil secara baku dengan flag `--no-extensions`.
3. **Penanganan `extension_ui_request`**:
   - Jika Pi memancarkan frame `extension_ui_request` (seperti yang terlihat pada fixture ADR 0035), adaptor mengabaikan permintaan tersebut secara aman dan **tidak pernah** mengeksekusi kode sembarang di host.

### 2.6 Penegakan Permission Engine & Output Tidak Terpercaya (Untrusted Output)
1. **Semua Output Pi adalah UNTRUSTED**:
   - Seluruh hasil eksekusi ditandai dengan flag `untrustedOutputWarning: true`.
2. **Pemetaan Tool Call ke `RuntimeProposedAction`**:
   - `bash` / `powershell` / `terminal` -> aksi `shell:exec`, risk: `HIGH`.
   - `write` -> aksi `file:write`, risk: `MEDIUM`.
   - `edit` -> aksi `file:edit`, risk: `MEDIUM`.
   - `read` -> aksi `file:read`, risk: `LOW`.
3. **Penyaringan Melalui `PermissionEngine`**:
   - Setiap aksi yang diusulkan dievaluasi melalui `this.filterUntrustedActions()`.
   - Aksi dengan tingkat risiko `HIGH` atau `CRITICAL` (misal perintah shell `rm -rf` atau eksekusi perintah terminal) diblokir tanpa izin eksplisit pengguna, dan tugas ditandai dengan status `failed` / menunggu persetujuan.

---

## 3. Matriks Perbandingan Runtime Monorepo

| Aspek | OMP (`apps/runtime-bridge`) | Hermes (`apps/runtime-bridge`) | Pi (`PiRuntimeAdapter`) | Native TS (`CodingAgent`) |
| :--- | :--- | :--- | :--- | :--- |
| **Lokasi Modul** | `apps/runtime-bridge` | `apps/runtime-bridge` | `packages/agent-core/src/runtimes` | `packages/agent-core/src/coding` |
| **Status Default** | Aktif di bridge | Aktif di bridge | **Default OFF (`PI_RUNTIME_ENABLED=false`)** | Aktif bawaan |
| **Tipe Eksekusi** | Batch terisolasi (`-p --mode json`) | Batch terisolasi (`-z --safe-mode`) | Stdio JSON-RPC dua arah (`--mode rpc`) | In-process TypeScript Loop |
| **Jejak Memori (RSS)**| ~388 MiB | ~180 MiB | ~150–220 MiB | ~80 MiB |
| **Dukungan Interupsi (Steer)**| Terbatas (batch one-shot) | Tidak didukung | Didukung via stdin RPC `steer` | Didukung via AbortSignal |
| **Gateway Model** | 9Router backend | 9Router backend | 9Router backend (validasi `get_state`) | 9Router backend |
| **Status di VPS ARM64**| Terpasang (`/usr/local/bin/omp`)| Terpasang (`hermes`)| **Belum Terpasang (Menunggu Izin Pemilik)**| Terpasang |

---

## 4. Konsekuensi

### Positif:
1. **Kepatuhan Mutlak Gate Sesi 12**: Tidak ada binary/package Pi yang dipasang di VPS, tidak ada lockfile yang berubah, dan feature flag default OFF menjaga stabilitas monorepo.
2. **Arsitektur Bersih & Ekstensibel**: Menggunakan kontrak standar `AgentRuntime` dan `BaseAgentRuntime`. Tidak ada percabangan `if/else Pi` di modul lain.
3. **Keamanan Berlapis**:
   - Gateway model 9Router dipaksakan secara ketat.
   - Ekstensi pihak ketiga dicegah (`--no-extensions`).
   - Aksi tool berisiko tinggi (`shell:exec`) diblokir oleh `PermissionEngine`.
4. **Verifikasi Deterministik**: Didukung 10 unit dan integrasi test komprehensif di `packages/agent-core/test/pi-adapter.test.ts` menggunakan fixture dan mock stdio streaming.

### Keterbatasan:
1. Eksekusi Pi di VPS produksi berstatus **BLOCKED / Menunggu Izin Pemilik**, karena biner Pi belum terpasang di VPS dan aturan kerja melarang instalasi runtime global tanpa izin eksplisit.
2. Di host Windows pengembang, Pi dapat diaktifkan secara opsional dengan menyetel variabel lingkungan `PI_RUNTIME_ENABLED=true`.

---

## 5. Rencana Verifikasi & Bukti QA

1. **Unit Test Suite**:
   ```bash
   pnpm --filter @personal-ai-os/agent-core test
   ```
   - 60/60 test lulus (10 test spesifik `PiRuntimeAdapter` dan `PiJsonlParser`).
2. **Typecheck & Linter**:
   ```bash
   pnpm -r typecheck
   pnpm -r lint
   ```
3. **Audit Token & Keamanan**:
   ```bash
   pnpm check:tokens
   pnpm verify:audit
   ```
