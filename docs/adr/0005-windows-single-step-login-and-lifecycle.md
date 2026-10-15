# ADR 0005: Alur Login 1-Langkah Windows, Siklus Hidup Aplikasi, dan Integrasi Sistem Tray

- **Status**: Disetujui (Approved)
- **Tanggal**: 2026-10-15
- **Konteks**: Sesi 3 — Login Windows 1 Langkah

---

## 1. Konteks & Permasalahan

Sebelumnya, alur autentikasi pada klien Windows (Tauri 2 + React) memerlukan banyak langkah manual dan membingungkan:
1. Pengguna selalu mendarat di tab obrolan (*Chat*) walaupun belum masuk (*unauthenticated*).
2. Pengguna harus membuka tab *Settings*, mengklik tombol *"Masuk dengan Google"*, lalu mengklik tombol terpisah *"Hubungkan Sekarang"* untuk memicu `connectToServer()`.
3. Tidak ada penanganan bootstrap yang jelas saat aplikasi dibuka kembali: jika token kedaluwarsa atau server tidak terjangkau, pengguna tidak mendapat umpan balik yang semestinya.
4. Aplikasi Windows belum memiliki integrasi *System Tray*, *Single Instance*, *Close-to-Tray*, maupun pengaturan *Autostart* saat Windows boot.

---

## 2. Keputusan Arsitektur

### 2.1 Alur Login 1-Langkah (*Single-Step Login Flow*)
- **Kondisi Belum Masuk (*Unauthenticated*)**: Aplikasi menampilkan layar penuh (*LoginScreen*) dengan logo Personal AI OS, satu tombol utama **"Masuk dengan Google"**, serta tautan tersembunyi **"Lanjutan (Opsi Pengembang)"** untuk konfigurasi URL server dan token manual.
- **Transisi Otomatis**: Setelah callback OAuth Google berhasil divalidasi (PKCE + kecocokan state), sistem **langsung dan otomatis** menjalankan:
  1. Pertukaran kode autorisasi (`exchangeLoginCode`).
  2. Penyimpanan sesi (`accessToken`, `refreshToken`, `email`).
  3. Sinkronisasi identitas dan kunci kriptografi perangkat (`syncDeviceIdentity`).
  4. Panggilan `connectToServer()` tepat satu kali per sesi login untuk membuka koneksi WSS Outbound ke `/v1/agent/ws`.
- **Indikator Progres Bertahap**: Pengguna disajikan status progres sekuensial:
  - *Membuka browser...*
  - *Memverifikasi autentikasi...*
  - *Mendaftarkan perangkat...*
  - *Terhubung!*
- Tidak ada tombol "Hubungkan Sekarang" pada alur normal.

### 2.2 Bootstrap Startup Cerdas (*Zero-Click Reopen*)
Saat aplikasi dibuka (`bootstrapAuth`):
1. **Tidak ada token**: Masuk ke status `unauthenticated`, menampilkan layar login.
2. **Sesi tersimpan ada**:
   - Jika `accessToken` belum kedaluwarsa: validasi dan langsung hubungkan ke server (`connectToServer`). Pengguna masuk tanpa interaksi (0 klik).
   - Jika `accessToken` kedaluwarsa dan `refreshToken` ada: jalankan `api.refreshSession(refreshToken)`. Jika sukses, simpan sesi baru dan lanjutkan koneksi.
   - Jika refresh token ditolak/dicabut: bersihkan sesi lokal dan tampilkan pesan: *"Sesi Anda telah kedaluwarsa. Silakan masuk kembali."*
   - Jika server tidak dapat dijangkau (gangguan jaringan/offline): pertahankan sesi lokal, tampilkan status offline dan tombol *"Coba Lagi"*.

### 2.3 Pencegahan Concurrency & Single Connection Guarantee
- Variabel penjaga `loginInFlight` mencegah klik ganda atau pemanggilan login paralel.
- `connectToServer()` dipanggil tepat satu kali per sesi dan memutus koneksi lama (`activeConnection?.disconnect()`) jika ada sebelum menginisialisasi koneksi baru.

### 2.4 System Tray, Close-to-Tray, dan Single Instance
- **System Tray**: Memanfaatkan fitur bawaan Tauri 2 (`tauri::tray::TrayIconBuilder` dan `tauri::menu::MenuBuilder`) tanpa dependensi pihak ketiga baru.
  - Menu: "Buka Personal AI OS", "Status: [Aktif / Terputus]", dan "Keluar".
  - Klik kiri pada ikon tray memulihkan (*restore*) dan memfokuskan jendela aplikasi.
- **Close-to-Tray**: Menangani event `tauri::WindowEvent::CloseRequested`. Jika opsi aktif (default: aktif), jendela disembunyikan (`window.hide()`) dan penutupan dicegah (`api.prevent_close()`). Aplikasi hanya keluar ketika pengguna memilih "Keluar" dari tray atau menu aplikasi.
- **Single Instance**: Menolak instansiasi ganda aplikasi pada Windows dengan mendeteksi instans yang sudah berjalan dan memfokuskan jendela yang ada.
- **Autostart Windows**: Dikendalikan melalui kunci registri Windows `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. Disediakan toggle di pengaturan (default: nonaktif).

---

## 3. Keamanan & Batasan
- **Secret Hygiene**: Token (`accessToken` dan `refreshToken`) tidak pernah dicatat ke log diagnostik.
- **Kunci Privat Perangkat**: Kunci privat P-256 tetap tersimpan di Web Storage lokal pada sesi ini. Pemindahan ke Windows Credential Manager / TPM dijadwalkan pada Sesi 15.
- **Penarikan Sesi di Server**: Aksi *Logout* memutus koneksi WSS, menghapus sesi lokal, dan memanggil endpoint server `POST /v1/auth/logout` dengan `refreshToken` untuk mencabut sesi di basis data PostgreSQL.

---

## 4. Konsekuensi & Evaluasi
- **Kelebihan**: Pengalaman pengguna meningkat drastis (1 klik untuk login awal, 0 klik untuk pembukaan ulang berikutnya), tanpa mengurangi keamanan PKCE dan validasi identitas perangkat.
- **Ukuran Bundel**: Nol dependensi eksternal baru; menggunakan API Tauri 2 bawaan dan pustaka React/Zustand yang sudah ada.
