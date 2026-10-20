# ADR 0033: Penetapan Mode Batch Terisolasi OMP dan Desain Integrasi RPC Masa Depan via pi.dev

- **Status**: Diterima (Accepted)
- **Tanggal**: 19 Oktober 2026
- **Pengambil Keputusan**: Principal Software Architect, Senior Full-Stack Engineer, AI Agent Systems Engineer, Security Engineer
- **Area**: Runtime Bridge (`apps/runtime-bridge`), Agent Core (`packages/agent-core`), Dokumentasi Arsitektur (`docs/adr/`)
- **Pembaruan dari**: ADR 0013 (Sesi OMP Persisten), ADR 0019 (Host Runtime Bridge), ADR 0020 (Pemetaan Fitur Runtime), ADR 0030 (Usulan Runtime pi.dev)

---

## 1. Konteks & Masalah

Pada audit baseline repositori (Sesi 1), ditemukan rekonsiliasi arsitektural yang perlu diresmikan:
1. **Divergensi ADR 0020 vs ADR 0013**:
   - Draf [ADR 0020](file:///c:/Coding/Project/AI-Agent/docs/adr/0020-pemetaan-fitur-runtime.md) mengusulkan peningkatan `apps/runtime-bridge` ke mode long-lived daemon menggunakan protokol NDJSON dua arah `omp --mode rpc` dengan injeksi tool host (`set_host_tools`).
   - [ADR 0013](file:///c:/Coding/Project/AI-Agent/docs/adr/0013-sesi-omp-persisten-dan-streaming.md) yang diterima pada Sesi 12 menetapkan bahwa OMP dieksekusi per-run melalui subproses CLI dengan flag persistensi `--session <sessionId>` dan streaming normalisasi JSONL stdout.
   - Kode riil pada [apps/runtime-bridge/src/index.ts](file:///c:/Coding/Project/AI-Agent/apps/runtime-bridge/src/index.ts) mengeksekusi OMP dalam mode subproses batch terisolasi per task dengan `stdio: ['ignore', 'pipe', 'pipe']`.
2. **Kapasitas Keras VPS Oracle Cloud ARM64**:
   - VPS produksi memiliki batasan sumber daya ketat: 2 OCPU dan 12 GB RAM tanpa swap space aktif.
   - Pengujian live probe VPS ([docs/verification/runtimes-live.md](file:///c:/Coding/Project/AI-Agent/docs/verification/runtimes-live.md)) membuktikan biner Rust OMP (v18.6.1) mengonsumsi memori ~388 MiB hingga 403 MiB RSS per proses.
   - Menjalankan OMP sebagai persistent background daemon pool yang selalu aktif di memori membawa risiko tinggi kebocoran memori (memory leak), akumulasi proses zombi, serta persaingan CPU dengan PostgreSQL + pgvector, Redis, dan BullMQ worker.
3. **Kebutuhan Kontrol & Kedaulatan Pengguna**:
   - Menutup stdin (`'ignore'`) memberikan keuntungan keamanan isolasi penuh: subproses tidak dapat dieksploitasi untuk injeksi interaktif tak terduga, process-group timeout dan cancellation (`SIGKILL` / `taskkill`) bekerja deterministik, dan clean environment (`cleanEnv`) dijamin terpasang segar pada setiap giliran tugas.
   - Namun, pengguna membutuhkan kejelasan mengenai fitur interaktif seperti interupsi instan (steering) dan streaming token tanpa ilusi antarmuka.

---

## 2. Keputusan Arsitektur

### 2.1 Penetapan Resmi OMP pada Mode Batch Terisolasi Per-Run
1. **Model Eksekusi Deterministik**:
   - Biner `omp` secara resmi ditetapkan beroperasi dalam **mode batch terisolasi sekali jalan (one-shot per task)**:
     ```bash
     omp -p <prompt> --mode json [--session <sessionId>] [--resume]
     ```
   - Kanal stdin tetap ditutup (`stdio: ['ignore', 'pipe', 'pipe']`).
2. **Persistensi Sesi & Resume**:
   - Persistensi konteks antar-langkah percakapan dikelola melalui flag `--session <sessionId>`.
   - Jika task merupakan lanjutan dari sesi yang sudah ada (`request.resume === true`), bridge menyuntikkan flag `--resume` untuk memuat riwayat sesi sebelumnya dari direktori workspace proyek (`<workspaceRoot>/<projectId>/<taskDir>/.omp-session`).
3. **Pembatalan dan Batas Sumber Daya**:
   - Konkurensi bridge dibatasi maksimal 2 proses aktif bersamaan (`MAX_CONCURRENCY = 2`).
   - Batas waktu eksekusi ditegakkan secara eksternal oleh bridge (`timeoutMs`, default 5 menit, maksimal 15 menit). Jika batas waktu terlampaui, bridge membunuh process-group secara paksa (`process.kill(-child.pid, 'SIGKILL')` pada Unix atau `taskkill /pid <pid> /T /F` pada Windows).
4. **Penutupan Usulan NDJSON RPC OMP**:
   - Usulan mode long-lived persistent daemon OMP NDJSON pada ADR 0020 secara resmi **ditarik / digantikan (superseded)** oleh ADR ini demi menjaga stabilitas dan efisiensi memori VPS 12 GB.

### 2.2 Alokasi Kemampuan RPC Interaktif ke Usulan Runtime Ketiga (`pi.dev`)
1. **Pemisahan Peran Runtime**:
   - Kemampuan interaktif dua arah yang sesungguhnya (streaming token per karakter, interupsi/steering mid-turn melalui stdin, dan penanganan sinyal pause/resume dinamis) tidak dipaksakan ke biner OMP yang berat.
   - Fitur-fitur interaktif tersebut secara resmi dialokasikan ke usulan runtime ketiga berbasis **pi.dev** ([ADR 0030](file:///c:/Coding/Project/AI-Agent/docs/adr/0030-usulan-runtime-pi-dev-dan-kapabilitas-omp-hermes.md)).
2. **Keunggulan pi.dev**:
   - Berjalan native di atas Node.js/TypeScript dengan jejak memori jauh lebih ringan (~150–250 MiB RSS).
   - Memiliki protokol JSON-RPC berbasis baris (JSONL) native yang dirancang khusus untuk sub-agent headless dan interupsi dua arah.
   - Lisensi aman MIT (kompatibel penuh dengan lisensi monorepo; dilarang menggunakan alternatif berlisensi AGPL seperti Odysseus).
3. **Aturan Pemasangan**:
   - Sesuai aturan kerja AGENTS.md, paket `@earendil-works/pi-coding-agent` **TIDAK DIPASANG** pada repositori atau host VPS pada sesi ini. Pemasangan dan pembuatan adapter bridge menunggu keputusan jadwal rilis dan izin tertulis dari pemilik proyek.

### 2.3 Standarisasi Eksekusi Platform Windows (Anti-DEP0190)
1. **Penanganan Pemanggilan Shell Aman**:
   - Pada host Windows, pemanggilan `spawn` dengan opsi `shell: true` dihindari untuk menutup risiko keamanan konkatenasi argumen dan mengeliminasi peringatan Node.js `[DEP0190]`.
   - Sebagai gantinya, eksekusi biner/skrip di Windows diarahkan langsung melalui command interpreter resmi:
     ```typescript
     const isWin = process.platform === 'win32';
     const spawnFile = isWin ? (process.env.COMSPEC || 'cmd.exe') : spec.file;
     const spawnArgs = isWin ? ['/d', '/s', '/c', spec.file, ...spec.args] : spec.args;
     spawn(spawnFile, spawnArgs, { shell: false, ... });
     ```
   - Ini memastikan kompatibilitas penuh dengan skrip batch Windows (`.cmd`, `.bat`) tanpa memicu celah konkatenasi argumen shell.

### 2.4 Kebijakan UI Klien (Kejujuran Semantik)
1. **Transparansi Mode Batch di Antarmuka**:
   - Komponen UI Windows (`TaskCard.tsx`, `ToolStepCard.tsx`) dan Android (`TaskDetailScreen.tsx`) yang menampilkan tugas berjalan pada runtime batch (OMP atau Hermes) secara jujur menampilkan status proses batch tertutup.
   - Tombol pengarahan (*Steer / Arahkan*) secara otomatis dinonaktifkan pada runtime one-shot dengan keterangan informatif bahwa pengarahan interaktif hanya tersedia pada agen bawaan (*native*) atau sesi interaktif dua arah mendatang.

---

## 3. Konsekuensi

### Positif:
1. **Stabilitas & Headroom VPS**: Headroom memori VPS sebesar 12 GB tetap terjaga aman. Tidak ada proses OMP idle yang mengendap di RAM menghabiskan ratusan megabyte saat tidak ada tugas koding.
2. **Determinisme & Keamanan Isolasi**: Setiap eksekusi tugas koding dimulai dalam lingkungan bersih (`cleanEnv`) dengan repositori git lokal yang di-sandbox (`prepareWorkspace`).
3. **Bebas Deprecation Warning**: Lingkungan build dan test monorepo bersih dari peringatan kerentanan shell Node.js di Windows.
4. **Arah Arsitektur Jelas**: Terdapat garis batas yang tegas antara tugas koding berat berbasis batch (OMP), tugas otomasi CLI (Hermes), dan rencana tugas interaktif masa depan (pi.dev).

### Keterbatasan:
1. Interupsi langsung di tengah generasi kalimat pada OMP tidak dapat dilakukan; pembatalan hanya dapat dilakukan dengan menghentikan (*Stop/Cancel*) seluruh proses task melalui sinyal `SIGKILL` / `taskkill`.
2. Persistensi konteks OMP antar-task bergantung pada integritas berkas `.omp-session` di dalam direktori workspace proyek lokal.

---

## 4. Evaluasi & Verifikasi
- Pengujian unit `apps/runtime-bridge/test/index.test.ts` membuktikan pemanggilan OMP dengan `--session` dan `--resume` lulus 100% tanpa error syntax atau peringatan linter.
- Pemeriksaan gerbang kualitas monorepo (`pnpm -r typecheck`, `pnpm -r lint`, `pnpm verify:audit`) terverifikasi lulus tanpa pelanggaran.
