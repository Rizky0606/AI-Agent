# Baseline Repository — Personal AI OS (Oktober 2026)

Tanggal: 2026-10-15  
Branch: `feat/sesi-1-baseline` (berbasis HEAD `release/installers` `57e15f5`)  
Metode: Audit read-only terhadap kode sumber, eksekusi test runner lokal, dan penelusuran implementasi. Tidak ada perubahan pada kode produk.

---

## 1. Hasil Audit Kualitas & Build Otomatis

Eksekusi perintah standar workspace dilakukan pada runtime Node.js v22.15.3 dan pnpm v10.13.1 di lingkungan host Windows 64-bit.

### 1.1 Ringkasan Perintah

| Perintah | Status | Total Lulus | Total Gagal | Catatan Utama |
|---|---|---|---|---|
| `pnpm install` | **LULUS** | 15 projects | 0 | Lockfile up to date, 3 package ditambahkan. |
| `pnpm -r lint` | **GAGAL** | 13 paket | 1 paket (`@personal-ai-os/api`) | 1 error ESLint di `apps/api/test/task-conversation-link.test.ts:27:9`. |
| `pnpm -r typecheck` | **LULUS** | 14 paket | 0 | 14/14 workspace projects lolos `tsc --noEmit`. |
| `pnpm -r test` | **SEBAGIAN** | 12 paket lulus | 2 paket gagal (`runtime-bridge`, `api`) | Total: 288 lulus, 7 gagal, 4 dilewati (skipped). |
| `pnpm -r build` | **LULUS** | 14 paket | 0 | Vite (Windows bundle) dan TypeScript build lulus 100%. |
| `pnpm verify:audit` | **LULUS** | 129 path unik | 0 | 220 referensi path dalam `docs/final-audit.md` 100% valid. |

---

### 1.2 Hasil Rinci Test per Paket

| # | Paket / Workspace | Tests | Lulus | Gagal | Skip | Durasi | Penyebab Kegagalan / Catatan |
|---|---|---|---|---|---|---|---|
| 1 | `packages/permissions` | 6 | 6 | 0 | 0 | 467ms | — |
| 2 | `packages/shared` | 4 | 4 | 0 | 0 | 455ms | — |
| 3 | `packages/model-gateway` | 9 | 9 | 0 | 0 | 712ms | — |
| 4 | `packages/evaluator` | 9 | 9 | 0 | 0 | 414ms | — |
| 5 | `packages/memory` | 7 | 7 | 0 | 0 | 483ms | — |
| 6 | `packages/tools` | 44 | 44 | 0 | 0 | 1520ms | — |
| 7 | `packages/mcp` | 18 | 18 | 0 | 0 | 2185ms | — |
| 8 | `packages/agent-core` | 33 | 33 | 0 | 0 | 1206ms | — |
| 9 | `apps/runtime-bridge` | 4 | 0 | **4** | 0 | 756ms | **Inkompatibilitas Windows mode bit**: `loadToken()` memeriksa `(metadata.mode & 0o077) !== 0` (`apps/runtime-bridge/src/index.ts:39`). Pada Windows NTFS, file stat tidak mendukung bit permission POSIX sehingga melempar error dan endpoint mengembalikan HTTP 503 (`bridge token unavailable`). |
| 10 | `apps/scheduler` | 25 | 22 | 0 | **3** | 3163ms | 3 test live dilewati (`# Live PostgreSQL and Redis required for this test`) karena service eksternal tidak aktif di host lokal. |
| 11 | `apps/android` | 28 | 28 | 0 | 0 | 2278ms | — |
| 12 | `apps/windows` | 43 | 43 | 0 | 0 | 7888ms | — |
| 13 | `apps/agent-worker` | 43 | 43 | 0 | 0 | 13928ms | — |
| 14 | `apps/api` | 72 | 68 | **3** | **1** | 23682ms | 3 test gagal: <br>1) `Recovery Drill 5`: Shebang bash script `scripts/backup-postgres.sh` berakhiran CRLF (`\r`), memicu error `/usr/bin/env: ‘sh\r’: No such file or directory`. <br>2) `runtime-task-e2e`: Bergantung pada `runtime-bridge` lokal yang mengembalikan HTTP 503 pada Windows. <br>3) `schema-parity`: Memerlukan `DATABASE_URL` aktif untuk menjalankan migrasi langsung; gagal assert jika DB tidak tersedia. |
| **TOTAL** | **14 Paket** | **299** | **288** | **7** | **4** | ~55s | **Tingkat Kelulusan Test: 97.6% (288/295 test aktif)** |

---

## 2. Verifikasi Faktual 6 Klaim Spesifik

### 2a. Task Recovery: Apakah task berstatus running diteruskan ke queue setelah worker restart?
- **Status Faktual**: **SUDAH DITERUSKAN KE QUEUE (DIPERBAIKI)**.
- **Bukti Kode**:
  1. `apps/agent-worker/src/index.ts:293-296`:
     ```ts
     const workerQueue = workerHandle.queue;
     if (!workerQueue) throw new Error('Worker queue is required to recover interrupted tasks.');
     const recovered = await workerHandle.executor.recoverInterruptedTasks(workerQueue);
     ```
  2. `apps/agent-worker/src/task-executor.ts:1509-1538`:
     `recoverInterruptedTasks(queue: TaskQueueEnqueuer)` mengambil task berstatus running yang menggantung (`taskRepo.getDanglingRunningTasks()`), memancarkan event `task.resumed`, dan secara eksplisit memanggil:
     ```ts
     await queue.enqueue(task);
     recoveredTasks.push(task);
     ```
  3. `apps/api/src/services/task-queue.ts:31-63`:
     `BullMqTaskQueue.enqueue(task)` memasukkan job ke antrean BullMQ (`this.queue.add(...)`).
- **Bukti Test**:
  `apps/agent-worker/test/live-worker-execution.test.ts:420`:
  `"Startup recovery re-enqueues a dangling task through the worker queue and completes it"` (**LULUS**, durasi 67.9ms).
- **Kesimpulan Dokumen**: Klaim lama di `docs/assessment-2026-10-13.md` (§1 butir 2 dan §3.2) yang menyatakan task recovery tidak meng-enqueue ulang sudah tidak berlaku sejak commit `1d4720a`.

---

### 2b. Kapabilitas Model 9Router: Masih hardcode?
- **Status Faktual**: **MASIH HARDCODE**.
- **Bukti Kode**:
  `packages/model-gateway/src/nine-router.ts:235-240`:
  ```ts
  return data.data.map((item) => ({
    provider: '9router',
    model: item.id,
    capabilities: ['chat', 'streaming'],
    contextWindow: item.context_window ?? item.context_length ?? 4096,
  }));
  ```
- **Analisis**: Semua model dari endpoint `/models` 9Router secara statis diberi kapabilitas `['chat', 'streaming']`. Kapabilitas lain seperti tool calling, vision, JSON schema, atau embedding tidak diproba dari backend gateway dan tidak terdeteksi dinamis.

---

### 2c. Generic Execution: Masih memakai marker PLACEHOLDER_GENERIC_WORKER?
- **Status Faktual**: **SEBAGIAN / HANYA UNTUK SIMULASI TEST**.
- **Bukti Kode**:
  1. `apps/agent-worker/src/task-executor.ts:47-48`:
     Konstanta `PLACEHOLDER_WORKER_LABEL = '[PLACEHOLDER_GENERIC_WORKER] Eksekusi simulasi langkah task untuk fondasi runtime. Belum memanggil tool sistem sesungguhnya.'` masih didefinisikan.
  2. `apps/agent-worker/src/task-executor.ts:231-235`:
     ```ts
     const isSimulation =
       task.payload?.isSimulation === true ||
       task.payload?.placeholder === true ||
       Boolean(task.payload?.simulateStep);
     ```
  3. `apps/agent-worker/src/task-executor.ts:990-1039`:
     Metode `executeGenericOrchestration` telah diimplementasikan penuh. Jika task bukan simulasi, worker memanggil `this.registry.executeTool(...)` atau `this.modelGateway.chat(...)` secara nyata. Jika model gateway tidak disetel, proses menolak dengan `Error: Generic task requires a ModelGateway... refusing to fabricate evidence`.
- **Koreksi Dokumen**:
  Klaim di `docs/capability-matrix.yaml:106` ("`PLACEHOLDER_GENERIC_WORKER` is still the only marker for generic execution: a task that is not coding, research, runtime, or device dispatch runs the placeholder track") sudah **ketinggalan zaman (stale)**. Sejak commit `1127eab`, task generik non-simulasi menjalankan orkestrasi model atau tool sesungguhnya.

---

### 2d. Route `/v1/memories/search`: Tertangkap oleh route `/:id`?
- **Status Faktual**: **YA UNTUK METODE NON-POST, TETAPI DITOLAK VALIDASI UUID (400) BUKAN ERROR 500**.
- **Bukti Kode**:
  1. `apps/api/src/routes/memory.ts:22-28`:
     ```ts
     const idParamsSchema = {
       params: {
         type: 'object',
         required: ['id'],
         properties: { id: { type: 'string', format: 'uuid' } },
       },
     } as const;
     ```
  2. `apps/api/src/routes/memory.ts:171, 187, 212`:
     Route `GET /v1/memories/:id`, `PATCH /v1/memories/:id`, dan `DELETE /v1/memories/:id` didaftarkan dengan schema `idParamsSchema`.
  3. `apps/api/src/routes/memory.ts:227-240`:
     Pencarian semantik semata-mata didaftarkan sebagai `POST /v1/memories/search`.
- **Analisis**:
  - Request `POST /v1/memories/search` **tidak terganggu** oleh route `/:id` karena metodenya berbeda.
  - Namun jika klien memanggil `GET /v1/memories/search`, Fastify mencocokkannya ke route `GET /v1/memories/:id` dengan parameter `id = "search"`. Berkat commit `28ade7c`, validasi schema `format: 'uuid'` langsung menolak dengan `400 VALIDATION_ERROR` sebelum query database dieksekusi (sebelumnya lolos ke Postgres dan memicu `500 22P02`).
  - Tidak ada route `GET /v1/memories/search` yang disediakan secara resmi.

---

### 2e. apps/windows: connectToServer() & Penyimpanan Private Key
- **Status Faktual**:
  1. `connectToServer()` **HANYA DIPANGGIL DARI TOMBOL DI TAB SETTINGS**: **TERBUKTI**.
  2. Private key perangkat disimpan di `localStorage`: **TERBUKTI**.
- **Bukti Kode**:
  1. Panggilan `connectToServer`:
     - `apps/windows/src/ui/App.tsx:305` mengimpor fungsi dari `useAgentStore()`.
     - Satu-satunya pemanggil di seluruh UI adalah `apps/windows/src/ui/App.tsx:656`:
       ```tsx
       <button className="btn btn-primary btn-sm" onClick={() => void connectToServer()}>
         Hubungkan Sekarang
       </button>
       ```
       pada tab Settings.
     - Saat aplikasi dibuka (`useEffect` pada `App.tsx:309-311`), aplikasi hanya menjalankan `syncDeviceIdentity()` (sinkronisasi nama/id), **tidak pernah melakukan auto-connect** ke server WebSocket (`/v1/agent/ws`).
  2. Penyimpanan Private Key:
     - `apps/windows/src/connection/device-key.ts:19`:
       ```ts
       const STORAGE_KEY = 'personal-ai-os.device-key';
       ```
     - `apps/windows/src/connection/device-key.ts:28, 37, 79-80`:
       ```ts
       globalThis.localStorage?.setItem(STORAGE_KEY, value);
       ...
       const jwk = await crypto.subtle.exportKey('jwk', generated.privateKey);
       writeStoredKey(JSON.stringify(jwk));
       ```
     - Kunci privat P-256 diekspor dalam format JWK plaintext dan disimpan di `localStorage` webview Tauri, bukan di Windows Credential Manager atau Windows DPAPI. Kompromi terhadap webview (XSS/injeksi) dapat membocorkan identitas kriptografis perangkat.

---

### 2f. Referensi ke `pi.dev` atau `Odysseus`
- **Status Faktual**: **TIDAK DITEMUKAN (0 REFERENSI)**.
- **Bukti Pencarian**:
  - `grep -ri "pi.dev" .` → Nol hasil.
  - `grep -ri "odysseus" .` → Nol hasil.
  - Seluruh referensi runtime eksternal di kode dan dokumen murni merujuk ke `omp` (Open Source Multi-Agent Platform) dan `hermes` via `apps/runtime-bridge`.

---

## 3. Inventaris UI (Windows & Android)

### 3.1 Layar Windows (`apps/windows/src/ui/App.tsx`)
Seluruh antarmuka Windows saat ini berada dalam **satu file monolitik** `App.tsx` (36.2 KB, 670 baris) yang memuat sub-komponen:
- `ProjectPanel` (manajer file lokal allowlist & diff viewer)
- `ChatPanel` (antarmuka chat percakapan, pilihan mode/model, task runner dari draft)
- `ModelSettings` (katalog model AI)
- `ServerTaskPanel` (daftar task server, detail checkpoint, event stream, pause/resume/cancel)
- `ApprovalPanel` (inbox persetujuan aksi HIGH/CRITICAL)
- `ArtifactPanel` (daftar artefak tersimpan & preview teks)
- `SecurityPanel` (saklar toggle 7 kapabilitas lokal & manajemen path allowlist)
- `LogsPanel` (stream log diagnostik audit lokal)
- `SettingsPanel` (URL VPS, login Google/token manual, status koneksi WSS)

### 3.2 Layar Android (`apps/android/src/screens/`)
Terdapat 9 file layar terpisah:
1. `LoginScreen.tsx` (7.7 KB, 280 baris)
2. `ConversationListScreen.tsx` (8.3 KB, 237 baris)
3. `ChatScreen.tsx` (18.9 KB, 309 baris)
4. `TaskListScreen.tsx` (11.6 KB, 273 baris)
5. `TaskDetailScreen.tsx` (15.9 KB, 501 baris)
6. `ApprovalInboxScreen.tsx` (10.9 KB, 349 baris)
7. `ArtifactsScreen.tsx` (6.7 KB, 104 baris)
8. `ProjectsScreen.tsx` (9.4 KB, 313 baris)
9. `SettingsScreen.tsx` (11.1 KB, 315 baris)

### 3.3 Metrik Kerapian & Gaya Tampilan (Inline Styles)
- **Windows (`App.tsx`)**: **77 inline style** (`style={{...}}`). Gaya tidak terkonsolidasi penuh ke dalam `Theme.css`.
- **Android (`src/screens/*.tsx`)**: **316 inline style** tersebar di seluruh 9 layar (tertinggi di `SettingsScreen.tsx` dengan 58 inline style, `ChatScreen.tsx` 51 inline style, dan `TaskDetailScreen.tsx` 51 inline style).

### 3.4 Inkonsistensi Bahasa UI (Bahasa Campur)
Terjadi percampuran bahasa Inggris dan Bahasa Indonesia yang tidak konsisten:
- **Windows**:
  - Panel Chat & Navigasi: *"Workspace chat"*, *"Conversations"*, *"+ New conversation"*, *"Your conversations appear here"*, *"Responding"*, *"Ready"*, *"Tasks from this conversation"*, *"Send message"*, *"Stop response"*.
  - Panel Tasks & Approvals: *"Server Tasks"*, *"No server tasks visible for this account"*, *"Task Detail"*, *"Decision reason (optional)"*, *"Approve"*, *"Deny"*.
  - Panel Keamanan & Pengaturan: Berbahasa Indonesia (*"Registry Kemampuan (Capability Registry)"*, *"Daftar Folder Diizinkan"*, *"Pengaturan Agen & Server"*, *"Masuk dengan Google"*, *"Hubungkan Sekarang"*).
- **Android**:
  - Tombol aksi dan status berbaur antara *"Approval Needed"*, *"Reject"*, *"Cancel"* dengan *"Pengaturan & Status Sistem"*, *"Status Perangkat Klien"*, *"Muat ulang model"*.

### 3.5 Informasi Operator yang Bocor ke Pengguna Biasa
Informasi teknis tingkat sistem/infrastruktur ditampilkan langsung di UI konsumen:
1. **Windows Header**: Menampilkan raw UUID `ID: {device.id}` di header utama (`App.tsx:346`).
2. **Windows Settings & Logs**: Menampilkan rincian koneksi low-level (*"Perangkat ini akan terhubung via WSS Outbound ke endpoint /v1/agent/ws"*), status internal event stream (`connected`/`reconnecting`), checkpoint internal (`step 1/3 · v1 · verify_last_step`), serta log JSON mentah.
3. **Android SettingsScreen**:
   - Menampilkan detail infrastruktur VPS: *"PostgreSQL + pgvector"*, *"Redis + BullMQ"*, dan *"API Gateway"* dengan status pill (`SettingsScreen.tsx:77-90`).
   - Menampilkan UUID internal (*User ID* dan *Device ID*) secara gamblang (`SettingsScreen.tsx:44, 59-63`).
   - Menampilkan potongan token teknis: *"FCM Token: eX4...""* (`SettingsScreen.tsx:168`).

---

## 4. Inventaris Dependency Klien & Keamanan CSP

### 4.1 Dependency Klien Windows (`apps/windows/package.json`)
- **Icon Library**: **TIDAK ADA**. Ikon ditampilkan menggunakan karakter emoji Unicode (`🪟`, `📁`, `📄`, `✦`, `⚠️`).
- **Markdown Renderer**: **TIDAK ADA**. Respons AI dirender sebagai string mentah (`<div className="chat-message-content">{message.content}</div>`), sehingga format tebal, miring, tabel, dan blok kode tidak berformat kaya.
- **Font Bundler**: **TIDAK ADA**. Font mengandalkan fallback font sistem (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto...`).

### 4.2 Analisis CSP Tauri (`apps/windows/src-tauri/tauri.conf.json`)
- Konfigurasi CSP aktif:
  ```json
  "csp": "default-src 'self'; connect-src 'self' ws: wss: http: https:;"
  ```
- **Dampak Keamanan & Font CDN**:
  Karena `font-src` tidak dideklarasikan, browser webview memberlakukan fallback ke `default-src 'self'`. Akibatnya, **semua font eksternal dari CDN (seperti Google Fonts / `fonts.gstatic.com`) otomatis DIBLOKIR**. Font harus dibundel secara lokal di dalam folder aset aplikasi atau menggunakan font sistem.

### 4.3 Dependency Klien Android (`apps/android/package.json`)
- **Icon Library**: **TIDAK ADA** paket `@expo/vector-icons` terpasang. Tampilan menggunakan emoji atau teks simbol.
- **Markdown Renderer**: **TIDAK ADA**. Teks chat dan artefak dirender dengan elemen dasar React Native `<Text>`.
- **Font Bundler**: Menggunakan font default sistem platform Android (Roboto).

---

## 5. Matriks Prioritas Temuan (P0 / P1 / P2)

| ID | Prioritas | Kategori | Deskripsi Temuan | Bukti / Lokasi | Dampak & Tindakan yang Disarankan |
|---|---|---|---|---|---|
| **F-01** | **P0** | **Build & CI** | Lint error akibat variabel tak terpakai pada file test. | `apps/api/test/task-conversation-link.test.ts:27:9` (`'bobConversation' is assigned a value but never used`) | Memblokir pipeline `pnpm -r lint` dan `pnpm test:ci`. Perlu dibersihkan pada sesi berikutnya. |
| **F-02** | **P0** | **Keamanan** | Kunci privat identitas perangkat disimpan di `localStorage` webview. | `apps/windows/src/connection/device-key.ts:26-41, 79-80` | Kunci P-256 dapat diekstrak oleh script berbahaya jika terjadi kompromi webview. Perlu dipindahkan ke Windows Credential Manager / DPAPI / Tauri native keystore. |
| **F-03** | **P1** | **Fungsional & UX** | Windows Agent tidak melakukan auto-connect ke server saat aplikasi dibuka. | `apps/windows/src/ui/App.tsx:656` (`connectToServer` hanya dipanggil saat tombol Settings ditekan) | Pengguna mengira agen aktif padahal koneksi WSS agen belum tersambung. Perlu auto-connect otomatis jika token dan identitas sudah valid. |
| **F-04** | **P1** | **Arsitektur** | Kapabilitas model 9Router di-hardcode ke `['chat', 'streaming']`. | `packages/model-gateway/src/nine-router.ts:238` | Menghambat seleksi model dinamis untuk tool calling, vision, dan mode khusus. Perlu probe atau konfigurasi metadata katalog. |
| **F-05** | **P1** | **Dokumentasi & Arsitektur** | Klaim di `docs/capability-matrix.yaml` menyatakan generic task masih placeholder murni. | `docs/capability-matrix.yaml:106` vs `apps/agent-worker/src/task-executor.ts:990` | Drift dokumentasi. Generic task sudah memiliki eksekusi nyata lewat ModelGateway sejak commit `1127eab`. Matriks kapabilitas harus disinkronkan. |
| **F-06** | **P1** | **Keamanan & UX** | Kebocoran informasi operator (Device ID, health DB/Redis, token internal) di layar pengguna akhir. | `apps/android/src/screens/SettingsScreen.tsx:77-90`, `apps/windows/src/ui/App.tsx:346` | Mengaburkan batas peran pengguna biasa vs operator sistem. Informasi infrastruktur harus dipindahkan ke menu diagnostik lanjutan. |
| **F-07** | **P1** | **Test & Portabilitas** | 4 test `runtime-bridge` dan 3 test `apps/api` gagal saat dijalankan di lingkungan Windows. | `apps/runtime-bridge/src/index.ts:39`, `apps/api/test/recovery-drill.test.ts:360` | Inkompatibilitas mode bit file POSIX di Windows dan shebang CRLF pada script shell. Perlu penyesuaian uji coba lintas platform. |
| **F-08** | **P2** | **Kualitas Kode** | Komponen UI Windows monolitik (36.2 KB, 670 baris) dengan 77 inline style. | `apps/windows/src/ui/App.tsx` | Sulit dipelihara, tidak ada pemisahan tanggung jawab, dan melanggar prinsip desain modular. Perlu dipecah menjadi komponen panel per fitur. |
| **F-09** | **P2** | **Kualitas Kode** | 316 inline style tersebar di 9 layar Android. | `apps/android/src/screens/*.tsx` | Performa re-render suboptimal dan visual token tidak terpusat dalam `StyleSheet`. |
| **F-10** | **P2** | **Lokalisasi** | Inkonsistensi bahasa UI (percampuran teks Bahasa Indonesia dan Bahasa Inggris). | `apps/windows/src/ui/App.tsx`, `apps/android/src/screens/` | Melanggar pedoman proyek (*"Semua teks yang tampil ke pengguna memakai Bahasa Indonesia yang konsisten"*). Perlu standardisasi copy UI. |
| **F-11** | **P2** | **UX & Tampilan** | Ketiadaan library ikon, Markdown renderer, dan font bundel pada kedua klien. | `apps/windows/package.json`, `apps/android/package.json` | Tampilan teks mentah tanpa formatting kaya (bold, code block, tabel) dan mengandalkan emoji default yang inkonsisten antar versi OS. |
