# ADR 0009: Redesain Antarmuka Android, Navigasi React Navigation, dan Markdown Renderer Asli

- **Status**: Disetujui (Approved)
- **Tanggal**: 2026-10-15
- **Konteks**: Sesi 7 — Redesain Android (Prasyarat: Sesi 2 & Sesi 6)

---

## 1. Konteks & Permasalahan

Klien Android sebelumnya (`apps/android/src/navigation/Navigator.tsx` dan layar terkait) memiliki sejumlah keterbatasan struktural dan pengalaman pengguna:
1. **Navigasi Manual Berbasis Emoji**: `Navigator.tsx` mengimplementasikan tab bawah manual dengan `View` dan `TouchableOpacity` serta ikon emoji (`💬`, `📋`, `🛡️`, `📁`, `⚙️`), padahal dependensi `@react-navigation/bottom-tabs` dan `@react-navigation/native-stack` sudah tersedia di `package.json`. Hal ini menyebabkan hilangnya hierarki back stack standar Android dan integrasi deep link yang rapuh.
2. **Ketiadaan Formatting Markdown pada Chat**: Percakapan asisten hanya dirender sebagai teks biasa dalam kontainer bubble tebal, tanpa penyorotan blok kode yang bisa disalin (*copyable code block*), tanpa aksi per pesan (tekan lama untuk salin atau coba lagi), dan tanpa prompt inspirasi pada kondisi awal (*empty state*).
3. **Ekspos Detail Internal pada Pengguna Awam**: Layar Pengaturan langsung menampilkan *User ID*, *Device ID*, serta status teknis internal *PostgreSQL* dan *Redis* kepada pengguna biasa tanpa pemisahan seksi yang manusiawi.
4. **Alur Persetujuan Terpisah**: Persetujuan (*approval*) hanya hidup di layar terpisah tanpa representasi inline di dalam alur chat atau rangkuman aktivitas terpadu, serta belum memiliki modal detail risiko dengan konfirmasi kedua untuk aksi berisiko `HIGH`/`CRITICAL`.
5. **Alur Onboarding Kurang Ramah**: Layar masuk mengekspos input URL server di bagian atas dan formulir email/password secara langsung, bukannya mengedepankan Google Sign-in sebagai aksi utama.

---

## 2. Keputusan Arsitektur

### 2.1 Struktur Navigasi Terpadu (3 Tab Utama)
Mengadopsi React Navigation resmi (`@react-navigation/native`, `@react-navigation/bottom-tabs`, `@react-navigation/native-stack`) yang diorganisasikan ke dalam 3 tab bawah utama:
1. **Chat**: Tab komunikasi utama asisten AI. Menyajikan riwayat percakapan dan alur percakapan aktif dengan back stack yang mulus. Ikon: `MessageSquare` dari `lucide-react-native`.
2. **Aktivitas**: Tab terpadu yang menggabungkan pelacakan tugas (*Tasks*) dan kotak masuk persetujuan (*Approvals*). Dilengkapi dengan badge jumlah persetujuan pending secara *real-time*. Ikon: `Activity` dari `lucide-react-native`.
3. **Lainnya**: Tab ringkas untuk pengaturan pengguna (Akun, Model Default, Notifikasi, Tampilan [Sistem/Terang/Gelap], kerangka Memori untuk Sesi 10, kerangka Skill & MCP untuk Sesi 14, serta menu Lanjutan untuk diagnostik teknis). Ikon: `MoreHorizontal` dari `lucide-react-native`.

### 2.2 Evaluasi & Pilihan Renderer Markdown
Terkait kebutuhan pemformatan Markdown pada chat Android, dilakukan evaluasi antara pustaka jadi vs implementasi mandiri (*custom lightweight renderer*):
- **Opsi A: Pustaka Pihak Ketiga (misal `react-native-markdown-display` atau webview-based)**:
  - *Kelebihan*: Fitur parser markdown lengkap bawaan.
  - *Kekurangan*: Menambah beban dependensi eksternal, berisiko dependensi transitif yang tidak teruji pada React Native 0.76 New Architecture, serta memerlukan kustomisasi rumit agar selaras dengan token desain `@personal-ai-os/shared`.
- **Opsi B: Komponen Markdown Mandiri (`MarkdownView.tsx`)**:
  - *Kelebihan*: **Nol dependensi baru**. Menggunakan komponen native inti (`Text`, `View`, `TouchableOpacity`) yang sepenuhnya aman, ringan, cepat, dan 100% patuh pada token tema `@personal-ai-os/shared` (warna kontras AA, border, font Inter). Mendukung blok kode berpagar (*fenced code blocks*) dengan label bahasa dan tombol salin ke clipboard (*copyable*), kode inline, teks tebal, miring, daftar poin (*bulleted/numbered list*), dan kutipan (*quote*).
  - *Keputusan*: **Memilih Opsi B**. Mengembangkan `src/components/MarkdownView.tsx` mandiri tanpa menambah dependensi npm baru, menjaga kestabilan build Android.

### 2.3 Pengalaman Chat Asisten Penuh
- **Pesan Asisten Lebar Penuh**: Pesan asisten tidak lagi dibungkus bubble tebal, melainkan tampil elegan selebar layar dengan tipografi bersih. Pesan pengguna mempertahankan bubble halus beraksen lembut di sisi kanan.
- **Interaksi Sentuh**: Mendukung aksi tekan lama (*long-press*) pada balon pesan untuk membuka modal aksi: **Salin Pesan** atau **Kirim Ulang (Ulangi)**.
- **Kondisi Kosong (*Empty State*)**: Menyajikan ucapan selamat datang dan 4 kartu contoh prompt dalam Bahasa Indonesia yang bisa langsung ditekan untuk mengisi input percakapan.
- **Composer Cerdas**: Terintegrasi penuh dengan chip Mode percakapan dan chip Model (dari Sesi 6). Menangani area keyboard (`KeyboardAvoidingView`) dan area aman (*safe area insets*) dengan rapi.

### 2.4 Sistem Persetujuan (*Approvals*) & Manajemen Risiko
- Kartu persetujuan dihadirkan secara terpadu baik di tab Aktivitas maupun inline.
- Menekan kartu membuka lembar detail (*bottom sheet*) yang merinci aksi, sumber daya sasaran (*resource*), estimasi konsekuensi, dan tingkat risiko (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).
- Khusus level risiko `HIGH` dan `CRITICAL`, sistem mewajibkan langkah konfirmasi kedua berupa modal dialog verifikasi yang menyebutkan konsekuensi bahaya sebelum keputusan diteruskan ke API backend.
- Seluruh tombol aksi interaktif (Setujui, Tolak, Batal) memiliki target sentuh minimal **48 dp** sesuai standar aksesibilitas WCAG dan Android Material Guidelines.

### 2.5 Tab "Lainnya" yang Ramah Pengguna
Struktur tab Pengaturan/Lainnya diubah menjadi navigasi hierarkis bersih:
1. **Profil & Akun**: Menampilkan email dan nama pengguna dengan tombol Keluar yang jelas.
2. **Model Default**: Menampilkan preferensi model akun yang aktif dan tautan cepat untuk mengubahnya.
3. **Notifikasi**: Tombol alih (*toggle switch*) notifikasi push dan preferensi kategori.
4. **Tampilan**: Pilihan tema dinamis antara **Sistem**, **Terang**, dan **Gelap**.
5. **Memori (Kerangka Sesi 10)**: Panel persiapan manajemen memori dan preferensi konteks jangka panjang.
6. **Skill & MCP (Kerangka Sesi 14)**: Panel persiapan perkakas klien dan server konteks model.
7. **Menu Lanjutan (Collapsible)**: Mengemas URL server, Device ID, User ID, dan diagnostik teknis PostgreSQL/Redis/API agar tidak mengaburkan antarmuka pengguna biasa.

### 2.6 Onboarding & Login Modern
- **Aksi Utama**: Tombol "Masuk dengan Google" ditampilkan secara mencolok dan elegan sebagai jalur masuk utama.
- **Formulir Sekunder**: Input Email dan Kata Sandi dilipat secara rapi di dalam accordion "Opsi Masuk Lainnya".
- **URL Server**: Disembunyikan di bawah tombol lipat "Pengaturan Lanjutan" di bagian bawah layar sehingga pengguna umum tidak terbebani oleh konfigurasi jaringan.

### 2.7 Lokalisasi id-ID dan Aksesibilitas
- Seluruh teks UI dipusatkan pada `src/locales/id-ID.ts` dengan Bahasa Indonesia yang konsisten dan baku.
- Menjamin kelengkapan properti aksesibilitas (`accessibilityRole`, `accessibilityLabel`, `accessibilityHint`).
- Menghormati pengaturan skala font sistem Android dan memastikan rasio kontras warna memenuhi standar WCAG AA.
