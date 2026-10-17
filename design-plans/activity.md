# Rencana Peningkatan Desain: Panel Aktivitas (Tugas, Persetujuan, Artefak)

Dokumen ini disusun berdasarkan audit read-only menggunakan skill `ibelick/improve-ui` terhadap panel drawer aktivitas Windows.

---

## Bahasa Desain & Bukti
- **Permukaan yang Diaudit**: `apps/windows/src/ui/activity/ActivityPanel.tsx`, `ApprovalCard.tsx`, `TaskCard.tsx`, `ArtifactCard.tsx`.
- **Sumber Desain**: `DESIGN.md`, `packages/shared/src/design/tokens.ts`, `docs/design-system.md`.
- **Keputusan Terdokumentasi**:
  - Drawer samping kanan lebar 360px dengan tab filter (Semua, Tugas, Persetujuan, Artefak).
  - Kartu persetujuan menampilkan badge risiko (LOW, MEDIUM, HIGH, CRITICAL) dan penjelasan konsekuensi.
  - Kartu tugas menampilkan progress bar checkpoint dan agregasi `ToolStepCard` timeline.
- **Pemilik & Konsumen Pengatur**: `ActivityPanel.tsx` merender daftar aktivitas yang bersumber dari API `/v1/tasks`, `/v1/approvals`, dan WebSocket stream.
- **Pengecualian Eksplisit**: Tidak ada.

---

## Temuan Audit & Masalah Terbukti

| # | Prioritas | Masalah | Bukti (`path:line`) | Usulan Perubahan | Cakupan | Keyakinan |
|---|---|---|---|---|---|---|
| 1 | **P1** | Kartu approval HIGH/CRITICAL memiliki warna tombol aksi yang sama persis dengan kartu risiko LOW | `apps/windows/src/ui/activity/ApprovalCard.tsx:68` | Berikan highlight visual pada border kartu dan teks tombol konfirmasi (misal: aksen oranye terang untuk HIGH, merah menyala untuk CRITICAL) agar tingkat bahaya segera disadari sebelum dialog sekunder muncul. | ApprovalCard | Tinggi |
| 2 | **P1** | Indikator checkpoint tugas (misal "Langkah 2 dari 4") tidak menampilkan judul langkah yang sedang dieksekusi | `apps/windows/src/ui/activity/TaskCard.tsx:85` | Tampilkan nama aksi checkpoint aktif (`task.checkpoint.lastExecutedAction`) tepat di atas progress bar. | TaskCard | Tinggi |
| 3 | **P2** | Kartu artefak tidak menampilkan cuplikan ukuran file atau ekstensi ikon yang spesifik | `apps/windows/src/ui/activity/ArtifactCard.tsx:42` | Tambahkan tag ukuran file terformat (`KB`/`MB`) dan ikon file khusus (Markdown, PDF, Image, Code) berdasarkan tipe MIME. | ArtifactCard | Sedang |

---

## Urutan Eksekusi (Improve First)
**Prioritas Utama (P1)**: Diferensiasi visual tingkat risiko pada `ApprovalCard.tsx`. Karena tindakan HIGH/CRITICAL berdampak sistem permanen (misal: eksekusi powershell lokal atau modifikasi berkas), pembedaan visual yang mencolok sangat esensial bagi keselamatan operasi sebelum pengguna menekan tombol.

---

## Rencana Implementasi Mandiri (Untuk Agen Pelaksana)
1. **Target**: `apps/windows/src/ui/activity/ApprovalCard.tsx` dan `TaskCard.tsx`.
2. **Langkah-langkah**:
   - Terapkan kelas CSS semantik `approval-card--critical`, `approval-card--high` dengan latar `var(--color-risk-*-subtle)`.
   - Sertakan badge durasi waktu tunggu persetujuan (*waiting since N minutes*).
   - Pastikan klik tombol aksi pada risiko HIGH/CRITICAL tetap memicu `useConfirm()` modal dialog dengan pesan konsekuensi eksplisit.
3. **Kriteria Verifikasi**:
   - Semua status persetujuan teruji pada unit test `apps/windows/test/layout-and-components.test.ts`.
