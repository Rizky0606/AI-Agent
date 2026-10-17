# Rencana Peningkatan Desain: Navigasi Android

Dokumen ini disusun berdasarkan audit read-only menggunakan skill `ibelick/improve-ui` terhadap shell navigasi Android.

---

## Bahasa Desain & Bukti
- **Permukaan yang Diaudit**: `apps/android/index.ts`, `apps/android/src/screens/ActivityScreen.tsx`, `SettingsScreen.tsx`, `apps/android/src/components/Theme.ts`.
- **Sumber Desain**: `DESIGN.md`, `packages/shared/src/design/tokens.ts`, `docs/design-system.md`.
- **Keputusan Terdokumentasi**:
  - React Navigation (`@react-navigation/bottom-tabs`) dengan 3 tab utama: Chat, Aktivitas, Lainnya.
  - Ikon murni `lucide-react-native` (`MessageSquare`, `Activity`, `MoreHorizontal`).
  - Lencana jumlah tugas/approval tertunda pada ikon tab Aktivitas.
  - Dukungan deep linking universal dan custom scheme `personal-ai://`.
- **Pemilik & Konsumen Pengatur**: `App` di `index.ts` mengonfigurasi `NavigationContainer` dan `createBottomTabNavigator`.
- **Pengecualian Eksplisit**: Tidak ada.

---

## Temuan Audit & Masalah Terbukti

| # | Prioritas | Masalah | Bukti (`path:line`) | Usulan Perubahan | Cakupan | Keyakinan |
|---|---|---|---|---|---|---|
| 1 | **P1** | Bilah tab bawah (*bottom tab bar*) tidak memiliki efek tembus pandang halus (*blur backdrop*) saat konten di baliknya bergulir | `apps/android/index.ts:52` | Berikan `backgroundColor: theme.colors.surfaceOverlay` dengan border atas halus `1px solid theme.colors.surfaceBorder` untuk memisahkan konten dari navigasi. | Bottom Tabs | Tinggi |
| 2 | **P1** | Header layar sub-navigasi (Detail Tugas, Detail Approval) memiliki gaya tombol kembali (*back button*) yang tidak konsisten dengan header utama | `apps/android/src/screens/TaskDetailScreen.tsx:430` | Standarisasi komponen header terpadu `ScreenHeader` dengan tombol kembali berukuran minimal 48dp dan judul terpusat atau rata kiri sesuai standar Android Material. | Screen Header | Tinggi |
| 3 | **P2** | Lencana counter approval tertunda pada tab Aktivitas tidak beranimasi saat ada tugas baru | `apps/android/index.ts:74` | Tambahkan animasi skala lembut (*gentle scale pulse*) ketika counter berubah nilai dari 0 ke >0. | Tab Badge | Sedang |

---

## Urutan Eksekusi (Improve First)
**Prioritas Utama (P1)**: Standarisasi `ScreenHeader` untuk seluruh sub-layar Android (`TaskDetailScreen`, `ApprovalInboxScreen`, `MemoryScreen`, `ProjectsScreen`). Menjamin area sentuh tombol kembali $\ge 48\text{dp}$ dan konsistensi warna aksen.

---

## Rencana Implementasi Mandiri (Untuk Agen Pelaksana)
1. **Target**: `apps/android/src/components/ScreenHeader.tsx` (baru) dan penggunaannya di `TaskDetailScreen.tsx`.
2. **Langkah-langkah**:
   - Buat komponen `ScreenHeader` yang menerima `title`, `onBack`, dan aksi opsional di sisi kanan.
   - Sambungkan Safe Area inset atas (`useSafeAreaInsets().top`) secara otomatis.
   - Pastikan warna judul mematuhi `theme.colors.textPrimary`.
3. **Kriteria Verifikasi**:
   - Navigasi deep link tetap mengarah dengan presisi.
   - Unit test `apps/android/test/navigation-and-approvals.test.ts` tetap 100% lulus.
