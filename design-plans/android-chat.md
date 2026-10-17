# Rencana Peningkatan Desain: Chat Android

Dokumen ini disusun berdasarkan audit read-only menggunakan skill `ibelick/improve-ui` terhadap pengalaman chat Android.

---

## Bahasa Desain & Bukti
- **Permukaan yang Diaudit**: `apps/android/src/screens/ChatScreen.tsx`, `apps/android/src/components/MarkdownView.tsx`, `ModelSelectorModal.tsx`.
- **Sumber Desain**: `DESIGN.md`, `packages/shared/src/design/tokens.ts`, `docs/design-system.md`.
- **Keputusan Terdokumentasi**:
  - Chat layout dengan gelembung pengguna di kanan dan pesan asisten lebar penuh di kiri.
  - Custom zero-dependency `MarkdownView` dengan blok kode monospace, label bahasa sintaks, dan aksi salin.
  - Modal bottom sheet pemilih model dengan pengelompokan provider dan badge kapabilitas hasil probe.
  - Floating chip selector untuk Mode dan Model di atas input teks composer.
- **Pemilik & Konsumen Pengatur**: `ChatScreen.tsx` mengatur komunikasi state ke `useChatStore` dan WebSocket streaming.
- **Pengecualian Eksplisit**: Tidak ada.

---

## Temuan Audit & Masalah Terbukti

| # | Prioritas | Masalah | Bukti (`path:line`) | Usulan Perubahan | Cakupan | Keyakinan |
|---|---|---|---|---|---|---|
| 1 | **P1** | Keyboard virtual Android terkadang menutupi baris chip mode/model saat composer aktif pada perangkat layar kecil | `apps/android/src/screens/ChatScreen.tsx:210` | Bungkus area composer dalam `KeyboardAvoidingView` dengan `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` dan `keyboardVerticalOffset` dinamis. | Keyboard View | Tinggi |
| 2 | **P1** | Blok kode pada `MarkdownView` membutuhkan scroll horizontal yang sering kali memicu gesture geser layar (*swipe gesture*) tidak sengaja | `apps/android/src/components/MarkdownView.tsx:85` | Tambahkan pembungkus `ScrollView horizontal` dengan `nestedScrollEnabled={true}` dan tombol "Salin Kode" yang selalu mengambang di kanan atas blok kode. | MarkdownView | Tinggi |
| 3 | **P2** | Menu long-press pada gelembung pesan hanya memiliki opsi Salin dan Ulangi | `apps/android/src/screens/ChatScreen.tsx:315` | Sediakan feedback haptic lembut (*vibration feedback*) saat pengguna melakukan long-press pada gelembung pesan. | Interaksi Chat | Sedang |

---

## Urutan Eksekusi (Improve First)
**Prioritas Utama (P1)**: Pengaturan `KeyboardAvoidingView` pada `ChatScreen.tsx`. Menjamin keyboard sentuh tidak pernah menyembunyikan input teks pengguna atau chip pemilihan model yang sedang dipilih.

---

## Rencana Implementasi Mandiri (Untuk Agen Pelaksana)
1. **Target**: `apps/android/src/screens/ChatScreen.tsx` dan `MarkdownView.tsx`.
2. **Langkah-langkah**:
   - Kalibrasi offset keyboard agar composer berada tepat di atas keyboard saat terbuka.
   - Sediakan indikator pengetikan (*streaming cursor*) yang berkedip lembut saat asisten menghasilkan token.
   - Pertahankan seluruh aturan sanitasi teks tanpa `dangerouslySetInnerHTML`.
3. **Kriteria Verifikasi**:
   - Input teks tetap responsif dan tidak lag saat streaming pesan panjang.
   - Unit test `apps/android/test/chat-stream.test.ts` dan `markdown-view.test.ts` tetap 100% lulus.
