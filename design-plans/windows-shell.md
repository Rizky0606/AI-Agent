# Rencana Peningkatan Desain: Shell Windows

Dokumen ini disusun berdasarkan audit read-only menggunakan skill `ibelick/improve-ui` terhadap shell utama aplikasi Windows.

---

## Bahasa Desain & Bukti
- **Permukaan yang Diaudit**: `apps/windows/src/ui/layout/Sidebar.tsx`, `AppHeader.tsx`, `App.tsx`, `Layout.css`.
- **Sumber Desain**: `DESIGN.md`, `packages/shared/src/design/tokens.ts`, `docs/design-system.md`.
- **Keputusan Terdokumentasi**:
  - Sidebar lebar 260px dengan auto-collapse di viewport < 900px (`Sidebar.tsx:32`).
  - Pengelompokan percakapan kronologis (Hari ini, Kemarin, Lebih lama).
  - Status dot denyut terhubung ke status koneksi WebSocket agen (`StatusDot.tsx`).
- **Pemilik & Konsumen Pengatur**: `App.tsx` merender `Sidebar` dan `AppHeader` mengapit area konten utama.
- **Pengecualian Eksplisit**: Tidak ada.

---

## Temuan Audit & Masalah Terbukti

| # | Prioritas | Masalah | Bukti (`path:line`) | Usulan Perubahan | Cakupan | Keyakinan |
|---|---|---|---|---|---|---|
| 1 | **P1** | Ruang kosong berlebih pada header saat drawer aktivitas tertutup | `apps/windows/src/ui/layout/AppHeader.tsx:45` | Tambahkan breadcrumb percakapan dan status runtime ringkas pada baris tengah header untuk memanfaatkan ruang horizontal yang luas. | Header Shell | Tinggi |
| 2 | **P2** | Tombol "Obrolan Baru" di sidebar terlalu dominan dibanding daftar percakapan aktif | `apps/windows/src/ui/layout/Sidebar.tsx:55` | Turunkan bobot visual dari tombol aksen penuh menjadi tombol `secondary` beraksen border subtle dengan shortcut `Ctrl+N` badge yang lebih rapi. | Sidebar | Tinggi |
| 3 | **P2** | Indikator visual ketika sidebar dalam keadaan menciut (*collapsed*) tidak menampilkan ikon cepat | `apps/windows/src/ui/layout/Sidebar.tsx:78` | Sediakan strip ikon mini (rail mode) saat sidebar menciut pada layar sempit (<900px) agar navigasi percakapan cepat tetap bisa diakses tanpa harus membuka penuh. | Responsif Shell | Sedang |

---

## Urutan Eksekusi (Improve First)
**Prioritas Utama (P1)**: Optimalisasi hierarki `AppHeader.tsx`. Menampilkan konteks percakapan aktif dan status koneksi secara terpadu menghemat vertikal space dan mengurangi kebingungan pengguna mengenai mode kerja yang sedang aktif.

---

## Rencana Implementasi Mandiri (Untuk Agen Pelaksana)
1. **Target**: `apps/windows/src/ui/layout/AppHeader.tsx` dan `Layout.css`.
2. **Langkah-langkah**:
   - Refactor `AppHeader` agar menampilkan judul percakapan dengan tooltip saat teks terpotong.
   - Sambungkan shortcut `Ctrl+B` untuk toggle sidebar dan `Ctrl+J` untuk toggle drawer aktivitas.
   - Pastikan warna dan padding tetap mengonsumsi `var(--space-*)` dan `var(--color-surface)`.
3. **Kriteria Verifikasi**:
   - Layout tetap stabil pada ukuran jendela minimum 800x600 px.
   - Unit test `apps/windows/test/layout-and-components.test.ts` tetap 100% lulus.
