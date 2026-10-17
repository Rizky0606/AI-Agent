# Rencana Peningkatan Desain: Chat Windows

Dokumen ini disusun berdasarkan audit read-only menggunakan skill `ibelick/improve-ui` terhadap alur obrolan desktop.

---

## Bahasa Desain & Bukti
- **Permukaan yang Diaudit**: `apps/windows/src/ui/chat/ChatView.tsx`, `ChatMessages.tsx`, `ChatComposer.tsx`, `EmptyChatState.tsx`, `ToolStepCard.tsx`, `MarkdownMessage.tsx`.
- **Sumber Desain**: `DESIGN.md`, `packages/shared/src/design/tokens.ts`, `docs/design-system.md`.
- **Keputusan Terdokumentasi**:
  - Kolom chat dibatasi lebar maksimal $\approx 720\text{px}$ di tengah layar.
  - Floating pill composer dengan textarea auto-grow dan barisan chip mode/model/runtime.
  - Penanda pemikiran streaming (*thinking indicator*) dan rendering markdown tanpa dangerouslySetInnerHTML.
  - Autoscroll hanya bergulir jika `isAtBottom` terpenuhi (`ChatMessages.tsx:45`).
- **Pemilik & Konsumen Pengatur**: `ChatView.tsx` mengatur komunikasi state ke `chatStore` dan merender riwayat serta composer.
- **Pengecualian Eksplisit**: Tidak ada.

---

## Temuan Audit & Masalah Terbukti

| # | Prioritas | Masalah | Bukti (`path:line`) | Usulan Perubahan | Cakupan | Keyakinan |
|---|---|---|---|---|---|---|
| 1 | **P0** | Baris chip pemilih (Mode, Model, Runtime) di atas composer meluap (*overflow*) pada viewport horizontal sempit | `apps/windows/src/ui/chat/ChatComposer.tsx:112` | Ubah container chip menjadi baris horizontal dengan scroll halus atau gabungkan chip mode & model ke dalam trigger pill ringkas. | Composer | Sangat Tinggi |
| 2 | **P1** | Jarak pemisah antara strip eksekusi `ToolStepCard` dan pesan chat asisten berikutnya terasa terlalu rapat | `apps/windows/src/ui/layout/Layout.css:140` | Tambahkan margin bawah `16px` (`var(--space-4)`) dan garis pembatas halus bergradasi untuk mempertegas batas fase berpikir agent dan jawaban akhir. | Timeline Chat | Tinggi |
| 3 | **P2** | 4 Kartu rekomendasi prompt kosong (`EmptyChatState`) berukuran seragam namun tidak memiliki indikator visual kategori | `apps/windows/src/ui/chat/EmptyChatState.tsx:34` | Berikan aksen ikon kecil (`Code`, `Search`, `FileText`, `Sparkles`) di sudut kiri atas setiap kartu prompt rekomendasi. | Empty State | Sedang |

---

## Urutan Eksekusi (Improve First)
**Prioritas Utama (P0)**: Penanganan responsif pada chip selector di `ChatComposer.tsx`. Saat jendela Windows berukuran 800-900px, chip Mode + Model + Runtime picker dapat bertumpuk dan menutupi sebagian textarea. Merapikan pembungkus chip menjamin input teks selalu terlihat nyaman.

---

## Rencana Implementasi Mandiri (Untuk Agen Pelaksana)
1. **Target**: `apps/windows/src/ui/chat/ChatComposer.tsx` dan `Layout.css`.
2. **Langkah-langkah**:
   - Berikan gaya `flex-wrap: nowrap`, `overflow-x: auto`, dan padding touch pada kontainer `.chat-composer-chips`.
   - Perjelas status tombol Stop streaming dengan warna merah lembut (`var(--color-danger-subtle)`) dan teks "Hentikan Generasi".
   - Pertahankan pencegahan enter bawaan untuk Shift+Enter (baris baru) dan Enter (kirim).
3. **Kriteria Verifikasi**:
   - Komposer tidak pernah bergeser keluar layar saat input teks panjang.
   - Unit test `apps/windows/test/layout-and-components.test.ts` tetap 100% lulus.
