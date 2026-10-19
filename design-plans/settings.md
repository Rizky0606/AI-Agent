# Rencana Peningkatan Desain: Pengaturan Windows

Dokumen ini disusun berdasarkan audit read-only menggunakan skill `ibelick/improve-ui` terhadap antarmuka pengaturan Windows.

---

## Bahasa Desain & Bukti
- **Permukaan yang Diaudit**: `apps/windows/src/ui/settings/SettingsView.tsx`.
- **Sumber Desain**: `DESIGN.md`, `packages/shared/src/design/tokens.ts`, `docs/design-system.md`.
- **Keputusan Terdokumentasi**:
  - 6 Seksi Pengaturan: Akun, Perangkat & Izin, Model, Tampilan, Integrasi Sistem, Lanjutan.
  - Tab Model menampilkan katalog model dengan filter pencarian, pengelompokan provider, badge kapabilitas hasil probe nyata, tombol bintang favorit, dan tombol "Jadikan Default Akun".
  - Tampilan mendukung seleksi Sistem, Gelap, dan Terang via `ThemeSwitcher`.
- **Pemilik & Konsumen Pengatur**: `SettingsView.tsx` terintegrasi dengan `useSettingsStore` dan `useAuthStore`.
- **Pengecualian Eksplisit**: Tidak ada.

---

## Temuan Audit & Masalah Terbukti

| # | Prioritas | Masalah | Bukti (`path:line`) | Usulan Perubahan | Cakupan | Keyakinan |
|---|---|---|---|---|---|---|
| 1 | **P1** | Halaman Pengaturan terlalu panjang saat semua seksi ditampilkan vertikal tanpa navigasi samping | `apps/windows/src/ui/settings/SettingsView.tsx:50` | Terapkan tata letak 2 kolom internal: daftar tab vertikal di kiri dan panel konten di kanan agar pengguna tidak perlu menggulir sangat jauh. | Layout Settings | Tinggi |
| 2 | **P2** | Daftar folder allowlist pada bagian Perangkat & Izin tidak menampilkan tombol salin path | `apps/windows/src/ui/settings/SettingsView.tsx:142` | Tambahkan tombol ikon salin kecil dan tooltip path lengkap saat direktori terpotong. | Allowlist Section | Tinggi |
| 3 | **P2** | Seksi Lanjutan menampilkan status kesehatan mentah JSON tanpa visualisasi status lampu indikator | `apps/windows/src/ui/settings/SettingsView.tsx:285` | Ganti preformatted text JSON dengan kartu status ringkas berindikator hijau/merah untuk API, PostgreSQL, dan Redis. | System Health | Sedang |

---

## Urutan Eksekusi (Improve First)
**Prioritas Utama (P1)**: Pengorganisasian navigasi tab pada `SettingsView.tsx`. Mengelompokkan seksi ke dalam tab vertikal membersihkan kepadatan informasi dan mempercepat penyesuaian model serta tema.

---

## Rencana Implementasi Mandiri (Untuk Agen Pelaksana)
1. **Target**: `apps/windows/src/ui/settings/SettingsView.tsx` dan `Layout.css`.
2. **Langkah-langkah**:
   - Susun sub-navigasi tab: Akun, Model & AI, Tampilan & Suara, Izin & Keamanan, Sistem & Jaringan.
   - Sediakan indikator ringkas pada setiap tab (misal: nama model default aktif di samping label tab Model).
   - Pastikan interaksi keyboard (Tab, Panah Atas/Bawah) berfungsi mulus.
3. **Kriteria Verifikasi**:
   - Pengaturan tersimpan persisten ke backend atau localStorage.
   - Test suite unit tetap 100% lulus.
