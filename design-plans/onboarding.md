# Rencana Peningkatan Desain: Onboarding & Login (Windows & Android)

Dokumen ini disusun berdasarkan audit read-only menggunakan skill `ibelick/improve-ui` terhadap alur masuk dan registrasi perangkat.

---

## Bahasa Desain & Bukti
- **Permukaan yang Diaudit**: `apps/windows/src/ui/LoginScreen.tsx`, `LoginScreen.css`, `apps/android/src/screens/LoginScreen.tsx`.
- **Sumber Desain**: `DESIGN.md`, `packages/shared/src/design/tokens.ts`, `docs/design-system.md`.
- **Keputusan Terdokumentasi**:
  - Tombol masuk Google Sign-in sebagai aksi hero utama (1 klik via PKCE OAuth).
  - Form email & password disembunyikan di bawah accordion "Opsi Masuk Lainnya".
  - Konfigurasi URL server backend disembunyikan di bawah "Pengaturan Lanjutan".
  - Otentikasi bootstrap otomatis zero-click saat token tersimpan masih valid.
- **Pemilik & Konsumen Pengatur**: `LoginScreen` mengelola interaksi awal pengguna dan memicu `bootstrapAuth()` ke `useAuthStore`.
- **Pengecualian Eksplisit**: Tidak ada.

---

## Temuan Audit & Masalah Terbukti

| # | Prioritas | Masalah | Bukti (`path:line`) | Usulan Perubahan | Cakupan | Keyakinan |
|---|---|---|---|---|---|---|
| 1 | **P1** | Pesan error saat koneksi ke server gagal masih menampilkan deskripsi teknis bahasa Inggris | `apps/windows/src/ui/LoginScreen.tsx:88` | Ganti pesan error menjadi bahasa Indonesia yang ramah dan instruktif: "Tidak dapat terhubung ke server Personal AI OS. Periksa koneksi internet Anda atau pastikan URL server benar." | Error Copy | Tinggi |
| 2 | **P2** | Tombol Google Sign-in pada layar desktop tidak menampilkan ikon resmi Google berukuran proporsional | `apps/windows/src/ui/LoginScreen.tsx:120` | Sertakan logo SVG Google terintegrasi (tanpa CDN) dengan kontras yang telah disesuaikan untuk latar tombol putih bersih. | Hero Button | Tinggi |
| 3 | **P2** | Animasi loading saat bootstrap auth berlangsung hanya berupa spinner kecil tanpa teks penjelas | `apps/android/src/screens/LoginScreen.tsx:75` | Tambahkan teks penjelas singkat di bawah spinner: "Menghubungkan ke sesi Anda..." agar pengguna tidak merasa aplikasi membeku (*frozen*). | Loading State | Sedang |

---

## Urutan Eksekusi (Improve First)
**Prioritas Utama (P1)**: Peningkatan salinan pesan kesalahan pada `LoginScreen.tsx`. Saat pengguna pertama kali mencoba menghubungkan aplikasi, pesan kesalahan yang jelas dan memberikan jalan keluar sangat penting agar pengguna tidak buntu.

---

## Rencana Implementasi Mandiri (Untuk Agen Pelaksana)
1. **Target**: `apps/windows/src/ui/LoginScreen.tsx` dan `apps/android/src/screens/LoginScreen.tsx`.
2. **Langkah-langkah**:
   - Terapkan kamus terjemahan error koneksi dari `src/ui/locales/id-ID.ts`.
   - Berikan transisi lembut saat accordion "Pengaturan Lanjutan" dibuka.
   - Pertahankan validasi format URL server tanpa trailing slash.
3. **Kriteria Verifikasi**:
   - Login PKCE dan fallback email/password tetap berfungsi mulus.
   - Unit test auth di kedua platform tetap 100% lulus.
