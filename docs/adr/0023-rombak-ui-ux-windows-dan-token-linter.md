# ADR 0023: Rombak UI/UX Windows dan Penerapan Token Linter Otomatis

## Status
Diterima (Accepted) — 2026-10-17

## Konteks
Setelah pelaksanaan audit komprehensif pada Sesi 21 (`design-plans/` dan `docs/design/design-brief.md`), antarmuka pengguna Windows (`apps/windows`) memiliki fondasi fungsional yang kuat namun memerlukan perombakan menyeluruh pada 8 area layar untuk memenuhi standar estetika profesional, keterbacaan, keterjangkauan interaksi (*affordances*), serta kepatuhan token desain.

Masalah utama yang diidentifikasi:
1. **Penyimpangan Token (Token Drift)**: Masih terdapat nilai warna hardcoded (`#hex` dan `rgba()`) serta nilai spasi statis di beberapa file CSS (`MemoryView.css`, `SkillMcpView.css`, `LoginScreen.css`).
2. **Kelebihan Bobot Visual (Visual Clutter)**: Tombol aksi utama "Obrolan Baru" terlalu dominan di sidebar, penggunaan emoji platform (🪟, ⚠️) yang inkonsisten dengan gaya desktop modern, serta bayangan kartu yang terlalu berat.
3. **Keterbatasan Tata Letak (Layout & Responsiveness)**: Baris chip komposer (Mode, Model, Runtime) rentan meluap pada resolusi desktop sempit; ketiadaan pembungkus horizontal yang rapi.
4. **Kejelasan Risiko & Umpan Balik (Risk & Affordance Clarity)**: Kartu persetujuan (Approval) belum membedakan aksen visual untuk risiko HIGH dan CRITICAL; checkpoint tindakan pada TaskCard hanya menampilkan label generik; path allowlist pada Pengaturan tidak memiliki tombol salin dengan umpan balik visual; ketiadaan banner koneksi lengket saat WebSocket terputus.

## Keputusan

1. **Penerapan Linter Token Otomatis (`scripts/check-design-tokens.ts`)**:
   - Skrip linter khusus TypeScript memeriksa seluruh file CSS di `apps/windows/src/ui/`.
   - Menolak keras nilai `#hex` dan `rgba(...)` apa pun di dalam deklarasi properti komponen (diizinkan hanya di `:root` pada `Theme.css`).
   - Menyediakan perintah npm `pnpm check:tokens` yang terintegrasi dalam alur CI/CD dan pengujian rutin.
   - Hasil audit: 5 file CSS diperiksa dengan **0 pelanggaran**.

2. **Rombak 8 Layar Windows (Subtractive Design & Human Affordances)**:
   - **Shell Header & Sidebar (`Sidebar.tsx`, `AppHeader.tsx`, `Layout.css`)**:
     - Mengubah tombol "Obrolan Baru" dari varian primary ke `secondary` dengan border halus dan badge pintasan keyboard `<kbd>Ctrl+N</kbd>`.
     - Menambahkan breadcrumb konteks navigasi di header yang terpotong rapi (`truncate`) saat judul panjang.
     - Memperbaiki tata letak status sinkronisasi.
   - **Chat & Komposer (`ChatComposer.tsx`, `EmptyChatState.tsx`, `Layout.css`)**:
     - Membatasi kontainer obrolan terpusat hingga `max-width: 720px`.
     - Mengelompokkan chip kontrol (Mode, Model, Runtime) dalam pembungkus horizontal dengan `overflow-x: auto` dan scrollbar tersembunyi (`scrollbar-width: none`).
     - Memperbaiki 4 kartu saran prompt pada empty state dengan layout grid responsif dan micro-hover.
   - **Panel Aktivitas (`ApprovalCard.tsx`, `TaskCard.tsx`, `ArtifactCard.tsx`, `Layout.css`)**:
     - Memberikan aksen semantik khas untuk persetujuan: border dan background khusus untuk risiko HIGH (`--color-risk-high`) dan CRITICAL (`--color-risk-critical`).
     - Menyediakan judul checkpoint tindakan yang informatif dan deskriptif ("Menjalankan Perintah", "Menavigasi Web", "Mengedit File", dsb.).
     - Menghapus bayangan tebal digantikan border token yang presisi.
   - **Pengaturan (`SettingsView.tsx`, `Layout.css`)**:
     - Menambahkan tombol salin cepat pada setiap baris path allowlist direktori lengkap dengan status visual "Tersalin!" selama 2 detik.
     - Menyusun status kesehatan sistem (REST API, WebSocket Event, Worker Process) ke dalam 3 kartu modular berdampingan dengan dot status dinamis.
   - **Memori (`MemoryView.tsx`, `MemoryView.css`)**:
     - Menghapus 100% nilai warna hex/rgba dan spasi statis, menggantikannya dengan variabel CSS `--color-surface-*`, `--color-border-*`, `--color-text-*`, dan `--spacing-*`.
   - **Skill & MCP (`SkillMcpView.tsx`, `SkillMcpView.css`)**:
     - Menstandardisasi seluruh badge status (bawaan, aktif, nonaktif) dan input konfigurasi menggunakan variabel token semantik.
   - **Layar Login (`LoginScreen.tsx`, `LoginScreen.css`)**:
     - Menghapus emoji platform (🪟, ⚠️) dan menggantinya dengan ikon Lucide SVG terverifikasi (`Laptop`, `AlertTriangle`).
     - Menstandarkan tombol login Google dan opsi email/password dengan visual token.
   - **Banner Koneksi Lengket (`App.tsx`, `Layout.css`)**:
     - Menambahkan banner status koneksi lengket (*sticky*) di bagian atas layar saat kondisi `reconnecting` atau `disconnected`, dilengkapi tombol aksi "Hubungkan Kembali".

3. **Integritas Bahasa & Aksesibilitas**:
   - Seluruh teks antarmuka menggunakan bahasa Indonesia baku konsisten (id-ID) tanpa istilah asing yang tidak diterjemahkan pada antarmuka umum.
   - Cincin fokus keyboard yang jelas (`:focus-visible`) dengan outline 2px dan offset 2px.
   - Mempertahankan font Inter lokal WOFF2 tanpa panggilan CDN luar (kepatuhan CSP Tauri `'self'`).
   - Rasio kontras teks memenuhi standar WCAG AA (>4.5:1 untuk teks biasa, >7:1 untuk teks utama).

## Konsekuensi & Batasan
- Seluruh 78 unit test `@personal-ai-os/windows` lulus 100%.
- Tampilan visual langsung pada monitor fisik Windows (1366x768 dan 1920x1080 dengan skala DPI 125% dan 150%) berstatus **BELUM DIVERIFIKASI VISUAL** dan memerlukan verifikasi manual pengguna di lingkungan desktop Windows nyata.
