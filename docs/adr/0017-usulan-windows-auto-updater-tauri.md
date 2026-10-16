# ADR 0017: Usulan Sistem Pembaruan Otomatis Windows Menggunakan Tauri Updater dan Kunci Terpisah

## Status
Diusulkan (Proposed) — *Menunggu persetujuan eksplisit dari Pengguna sebelum implementasi kode.*

## Konteks
Aplikasi agen Windows (`Personal AI OS Windows Agent`) bertindak sebagai worker eksekusi lokal dan antarmuka tray yang berjalan terus-menerus di latar belakang.
Ketika perbaikan keamanan, fitur model baru, atau pengerasan sistem diperbarui di repositori, mengandalkan pengguna untuk mengunduh ulang dan memasang installer secara manual adalah proses yang lambat dan rentan terhadap perangkat yang tertinggal pada versi lama yang berisiko.

Namun, mekanisme pembaruan otomatis (*auto-updater*) adalah vektor serangan kritis jika tidak dirancang dengan integritas kriptografis yang kuat: jika server pembaruan atau CDN disusupi, penyerang dapat mendistribusikan biner berbahaya ke seluruh mesin Windows pengguna.

## Usulan Desain Arsitektur

### 1. Tauri Updater v2 (`@tauri-apps/plugin-updater`)
Kami mengusulkan penggunaan sistem pembaruan resmi Tauri v2 yang dirancang khusus untuk desktop:
- Biner pembaruan dikemas dan diverifikasi secara native di sisi Rust.
- Mendukung pembaruan delta/in-place untuk Windows NSIS installer.

### 2. Penandatanganan Kriptografis Kunci Terpisah (Ed25519 / Minisign)
Untuk memastikan biner yang diunduh berasal dari pipeline rilis resmi dan tidak dimanipulasi:
1. **Pasangan Kunci Rilis Ed25519 Khusus**:
   - Dihasilkan menggunakan alat CLI Tauri (`tauri signer generate`).
   - Kunci publik (*public key*) di-hardcode ke dalam konfigurasi aplikasi `tauri.conf.json`:
     ```json
     {
       "plugins": {
         "updater": {
           "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk..."
         }
       }
     }
     ```
   - Kunci privat (*private key*) **HANYA** disimpan pada GitHub Actions Environment Secrets (`TAURI_SIGNING_PRIVATE_KEY`). Kunci privat tidak pernah berada di repositori, server webview, atau mesin klien.
2. **Verifikasi Sebelum Pemasangan**:
   - Klien mengunduh metadata rilis (`latest.json`) dan arsip biner baru.
   - Rust memverifikasi tanda tangan Minisign terhadap biner yang diunduh menggunakan public key yang tertanam.
   - Jika tanda tangan tidak cocok atau kunci tidak valid, proses pembaruan **seketika dibatalkan** dan file sementara langsung dihapus tanpa dieksekusi.

### 3. Endpoint Manifest Rilis
Manifest pembaruan disajikan melalui HTTPS aman (misalnya GitHub Releases Assets atau endpoint Cloudflare Pages/VPS):
```json
{
  "version": "0.2.0",
  "notes": "Pembaruan keamanan dan perbaikan performa Sesi 15",
  "pub_date": "2026-10-16T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "MEQCIG...",
      "url": "https://github.com/Rizky0606/AI-Agent/releases/download/v0.2.0/personal-ai-os_0.2.0_x64-setup.nsis.zip"
    }
  }
}
```

### 4. Kontrol Pengguna & UX yang Bersahabat
- **Pengecekan di Latar Belakang**: Aplikasi memeriksa versi baru secara berkala (misal setiap 6 jam) atau saat aplikasi dibuka pertama kali.
- **Tanpa Restart Paksa**: Jika terdapat tugas aktif atau perintah lokal yang sedang dieksekusi, pembaruan ditunda.
- **Konfirmasi Dialog**: Pengguna ditampilkan pemberitahuan dalam Bahasa Indonesia: *"Versi baru Personal AI OS tersedia (v0.2.0). Pasang sekarang?"* dengan tombol *"Pasang dan Mulai Ulang"* atau *"Nanti"*.

## Konsekuensi & Kebutuhan Persetujuan
- **Jika Disetujui**:
  1. Crate `tauri-plugin-updater` akan ditambahkan ke `apps/windows/src-tauri/Cargo.toml`.
  2. Plugin updater didaftarkan di `main.rs` dan konfigurasi `tauri.conf.json`.
  3. Workflow release GitHub Actions akan menambahkan langkah pembuatan tanda tangan update (`TAURI_SIGNING_PRIVATE_KEY`).
- **Jika Ditolak/Ditunda**:
  Aplikasi tetap berjalan tanpa auto-updater, dan pengguna melakukan pembaruan manual via installer NSIS.
