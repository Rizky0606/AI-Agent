# ADR 0008: Pemilih Model di Klien (Windows & Android), Manajemen Preferensi, dan Atribusi Fallback

Status: accepted  
Tanggal: 2026-10-15  
Penulis: Principal Software Architect / Senior Full-Stack Engineer

## Konteks

Setelah penyelesaian Sesi 5 (Backend Model AI), infrastruktur backend telah mendukung:
1. Verifikasi empiris kapabilitas model (`streaming`, `tool_calling`, `vision`, `context_window`) dengan status provenance (`probed`, `declared`, `unknown`).
2. Endpoint katalog model yang diperkaya (`GET /v1/models`).
3. Endpoint preferensi default pengguna (`GET` dan `PATCH /v1/users/me/preferences`).
4. Konfigurasi model dan mode per percakapan (`PATCH /v1/conversations/:id`).
5. Metadata transparansi respons chat (`resolvedModel`, `fallbackUsed`).

Namun, antarmuka pengguna pada kedua klien masih memiliki keterbatasan serius:
- **Windows**: Pemilihan model di composer chat hanya berupa kotak input teks bebas (`<input type="text" placeholder="Auto" />`). Pengguna harus mengetikkan string model secara manual tanpa petunjuk ketersediaan atau kapabilitas. Katalog di Settings hanya daftar pasif.
- **Android**: ChatScreen hanya menyediakan tombol teks "Change" yang beralih kaku antara string `'auto'` dan `models[0]`, sehingga model lain tidak dapat dipilih.
- Kedua klien belum menampilkan indikator apakah model yang merespons adalah model utama atau hasil fallback, serta belum menangani kondisi katalog offline (503) atau model yang hilang dari katalog secara graceful.

## Keputusan Arsitektural

### 1. Windows: Chip Model & Popover Selektor Kaya
- Menghapus input teks bebas di composer [ChatComposer.tsx](file:///c:/Coding/Project/AI-Agent/apps/windows/src/ui/chat/ChatComposer.tsx).
- Menggantikannya dengan Chip Model interaktif yang membuka Popover terapung dengan kemampuan:
  - **Pencarian dinamis**: Filter instan berdasarkan nama model atau provider.
  - **Opsi Auto di baris teratas**: Ditandai sebagai "Disarankan" dengan penjelasan deskriptif.
  - **Pengelompokan per Provider**: Model dikelompokkan secara visual berdasarkan provider (misalnya `9router`, `openai`, `anthropic`).
  - **Lencana Kapabilitas Terverifikasi**: Menampilkan badge `Streaming`, `Tools`, `Vision`, dan ukuran context window (misal `128k`) HANYA jika terbukti (`status === 'probed'`). Kapabilitas yang belum dibuktikan atau gagal ditandai sebagai `unknown` secara jujur.
  - **Penyematan Favorit**: Pengguna dapat menyematkan model favorit dengan ikon bintang, disimpan di `localStorage` klien.
  - **Aksi Default Akun**: Opsi langsung untuk menetapkan model terpilih sebagai default pengguna di server via `PATCH /v1/users/me/preferences`.

### 2. Android: Bottom Sheet Selektor Model Menggunakan Modal Bawaan
- Menghapus tombol toggle "Change" di [ChatScreen.tsx](file:///c:/Coding/Project/AI-Agent/apps/android/src/screens/ChatScreen.tsx).
- Mengimplementasikan Bottom Sheet berbasis komponen `Modal` bawaan React Native tanpa menambahkan dependensi pihak ketiga.
- Menyajikan fitur yang identik dengan Windows: pencarian, opsi Auto di atas, pengelompokan provider, lencana kapabilitas terverifikasi, status unknown, dan pin favorit.
- Memenuhi standar aksesibilitas sentuh: seluruh elemen interaktif, tombol pin, dan baris model memiliki target sentuh minimal **48 dp** (`minHeight: 48`, `minWidth: 48`).

### 3. Persistensi Preferensi Bertingkat
- Pemilihan model atau mode pada percakapan aktif segera dipersistensikan ke server melalui `PATCH /v1/conversations/:conversationId`. Untuk percakapan baru (draft), preferensi disimpan di state lokal dan dikirim saat pembuatan percakapan pertama.
- Pengguna dapat menyetel model bawaan untuk seluruh percakapan masa depan via `PATCH /v1/users/me/preferences`.
- Chip Mode (`Auto`, `Cepat`, `Coding`, `Kompleks`, `Riset`) digabungkan berdampingan dengan chip Model pada toolbar composer.

### 4. Atribusi Model Responden & Penanda Fallback
- Pada bubble pesan asisten di Windows ([ChatMessages.tsx](file:///c:/Coding/Project/AI-Agent/apps/windows/src/ui/chat/ChatMessages.tsx)) dan Android ([ChatScreen.tsx](file:///c:/Coding/Project/AI-Agent/apps/android/src/screens/ChatScreen.tsx)):
  - Jika pesan selesai diproses, tampilkan nama model aktual yang memproses pesan (`resolvedModel`).
  - Jika fallback provider aktif (`fallbackUsed === true`), tampilkan label eksplisit: `Dijawab oleh <Model> (fallback)`.

### 5. Ketahanan Katalog (Graceful Degradation 503 & Model Hilang)
- **Katalog Offline (503 / Network Error)**:
  - Chip model dinonaktifkan dengan status peringatan dan tombol "Coba lagi".
  - Pengguna tetap dapat mengirim pesan menggunakan mode `Auto` karena router backend mampu mengambil keputusan secara otonom.
- **Model Hilang**:
  - Jika model yang sebelumnya dipilih tidak lagi ditemukan di katalog saat refresh, sistem otomatis mengembalikan pilihan ke `Auto` dan menampilkan pesan notifikasi edukatif tanpa memicu crash atau pesan error mentah.

## Konsekuensi

- **Positif**:
  - Pengalaman pengguna yang konsisten dan intuitif di desktop Windows dan mobile Android.
  - Transparansi kapabilitas model mencegah ekspektasi fitur yang tidak didukung (misal mengirim gambar ke model non-vision).
  - Menghilangkan kemungkinan pengguna salah mengetik string nama model.
  - Aksesibilitas mobile terjamin dengan target sentuh minimal 48 dp.
- **Keterbatasan / Mitigasi**:
  - Penyematan favorit saat ini disimpan di level perangkat lokal (`localStorage` / `AsyncStorage`); sinkronisasi preferensi antarklien difokuskan pada `defaultModel` dan konfigurasi percakapan di server.
