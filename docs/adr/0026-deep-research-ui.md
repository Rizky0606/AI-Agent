# 0026. Arsitektur Antarmuka Deep Research (Windows & Android)

- **Status**: Diterima
- **Tanggal**: 2026-10-17
- **Pengambil Keputusan**: Principal Software Architect, Senior Full-Stack Engineer, UI/UX Designer
- **Area**: Frontend (`apps/windows`, `apps/android`, `packages/shared`, `apps/api`)

---

## 1. Konteks dan Latar Belakang

Sesi 24 telah mengimplementasikan backend Deep Research yang meliputi pipeline 8-tahap, hard budgets, plan generator via ModelGateway JSON schema, evaluator terintegrasi, dan REST API `/v1/research` dengan penyiaran realtime event WebSocket.

Sesi 25 berfokus pada integrasi antarmuka pengguna (UI/UX) lintas platform (Windows desktop dan Android mobile) dengan mematuhi prinsip desain yang telah dirumuskan pada Sesi 22 (Windows UI overhaul) dan Sesi 23 (Android UI overhaul), serta 4 UI Skills acuan:
1. `pbakaus/layout`: Tata letak responsif, keterbacaan laporan panjang, pemisahan area utama dan panel/sheet sekunder.
2. `kemiljk/real-content-design`: Pengujian ketahanan terhadap laporan nyata yang panjang, sitasi teknis, dan URL sumber riil.
3. `jakubkrehel/better-writing`: Teks antarmuka bahasa Indonesia yang konsisten, berorientasi aksi, dan instruktif.
4. `kemiljk/interface-affordances`: Isyarat interaksi jelas, target sentuh proporsional, dan peniadaan interaksi yang hanya bergantung pada hover.

---

## 2. Keputusan Arsitektur

### A. Penempatan Logika State & Event Reducer di `@personal-ai-os/shared/research`

Untuk mencegah duplikasi logika antara Windows (React) dan Android (React Native), logika murni ditempatkan di `packages/shared/src/research/`:
1. `types.ts`: Tipe data riset untuk kebutuhan presentasi UI (run, depth, plan, timeline sub-pertanyaan, sumber, bukti, laporan, dan error state).
2. `progress-reducer.ts`: Reducer fungsional murni `reduceResearchEvent(state, event)` yang menangani:
   - Deduplikasi event berdasarkan ID event atau timestamp.
   - Ketahanan terhadap urutan terbalik (*out-of-order*) dan pemutaran ulang (*event replay*) setelah koneksi putus via `last_event_id`.
   - Agregasi status sub-pertanyaan (`waiting` -> `searching` -> `reading` -> `extracting` -> `completed`).
   - Akumulasi anggaran terpakai (pencarian, halaman dibaca, durasi).
3. `citations.ts`: Parser sitasi `[src-X]` berbasis ekspresi reguler yang memetakan sitasi ke daftar sumber rujukan secara aman:
   - Jika sitasi menunjuk ID sumber yang tidak ada (misal `[src-999]`), sistem tidak boleh crash melainkan menandainya sebagai `[src-999: Sumber tidak ditemukan]`.

### B. Endpoint Tambahan pada Backend API (`/v1/research/config` & `DELETE /v1/research/:id`)

1. `GET /v1/research/config`:
   - Mengembalikan batas anggaran resmi dari server (`DEFAULT_BUDGET_BY_DEPTH`). Klien tidak boleh mengarang angka perkiraan anggaran, melainkan menampilkan angka resmi dari server.
2. `DELETE /v1/research/:id`:
   - Memungkinkan pengguna menghapus entri riset lama dari riwayat. Drizzle repository mengalirkan penghapusan secara kaskade ke `research_sources`, `research_evidence`, dan `research_reports`.

### C. Pola Desain Antarmuka Windows Desktop (`apps/windows`)

1. **Pemilihan Mode & Kedalaman di Composer**:
   - Chip Mode memiliki opsi `Riset`. Saat dipilih, muncul pemilih kedalaman (Cepat, Standar, Mendalam) beserta kartu info estimasi anggaran dari server.
2. **Review Rencana Sub-Pertanyaan (`waiting_plan_approval`)**:
   - Khusus kedalaman `Mendalam` (atau jika persetujuan diminta), muncul panel/modal review rencana di mana pengguna dapat mengedit pertanyaan, menghapus sub-pertanyaan yang tidak relevan, atau menambahkan sub-pertanyaan baru sebelum menekan "Mulai riset".
3. **Live Progress Timeline & Indikator Anggaran**:
   - Menampilkan status progres per sub-pertanyaan, counter penggunaan anggaran live, daftar sumber terkumpul dengan inisial domain bergaya badge (tanpa memuat favicon dari internet demi CSP), dan tombol "Hentikan" (Cancel).
4. **Tampilan Laporan & Sumber (Center + Sidebar Panel)**:
   - Laporan Markdown ditampilkan di area tengah lebar dengan sitasi `[src-X]` yang interaktif (menampilkan popover kutipan dan judul saat diklik/diarahkan kursor).
   - Panel samping kanan menampilkan ringkasan seluruh sumber rujukan.
   - Tombol "Salin laporan" dan "Simpan sebagai .md" (via dialog file Tauri atau download blob).
   - Membuka tautan eksternal ke peramban sistem dilindungi dialog konfirmasi pengguna.
5. **Riwayat Riset**:
   - Tab navigasi atau panel riwayat menampilkan riset sebelumnya, tanggal, status, tombol buka ulang, dan tombol hapus.
6. **Notifikasi**:
   - Menggunakan toast notification Windows yang sudah ada dengan tombol pintas ke laporan.

### D. Pola Desain Antarmuka Android Mobile (`apps/android`)

1. **Pemilihan Mode & Kedalaman**:
   - Chip Mode pada `ChatScreen` mendukung opsi `research`. Memilih mode riset memunculkan baris chip kedalaman dengan label estimasi anggaran.
2. **Bottom Sheet Sumber & Review Rencana**:
   - Review rencana disajikan dalam bottom sheet modal yang ramah sentuhan satu tangan.
   - Saat laporan dibuka, mengetuk sitasi `[src-X]` membuka bottom sheet kartu sumber rujukan dan kutipan singkatnya.
3. **Konfirmasi Tautan Eksternal**:
   - Membuka URL eksternal memicu modal konfirmasi sebelum menjalankan `Linking.openURL`.
4. **Notifikasi FCM & Deep Link**:
   - Integrasi `DeepLinkService` untuk skema `personal-ai://research/:id` dan pemetaan payload notifikasi push.

---

## 3. Konsekuensi

- **Keuntungan**:
  - Arsitektur terpadu: logika reducer dan sitasi dapat diuji secara independen dengan unit test di `@personal-ai-os/shared`.
  - Tidak ada angka fiktif: estimasi anggaran bersumber langsung dari konfigurasi server.
  - Keamanan terjaga: tidak ada pemuatan aset eksternal (CSP compliant), dan tautan keluar memerlukan konfirmasi.
  - Aksesibilitas: TalkBack, aria-label, dan kontras WCAG AA terpenuhi.
- **Batasan**:
  - Tampilan visual aktual pada layar fisik Android dan Windows sistem nyata dicatat sebagai "belum diverifikasi visual" sesuai aturan anti-halusinasi.
