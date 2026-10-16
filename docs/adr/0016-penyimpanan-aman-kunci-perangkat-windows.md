# ADR 0016: Penyimpanan Aman Kunci Perangkat Windows (DPAPI dan Isolasi Rust)

## Status
Diterima (Accepted)

## Konteks
Sebelumnya, identitas kriptografis perangkat Windows (`Personal AI OS Windows Agent`) disimpan dalam bentuk JSON Web Key (JWK) pasangan kunci EC P-256 langsung di `localStorage` webview (`apps/windows/src/connection/device-key.ts`).
Meskipun sudah lebih baik daripada sekadar string ID perangkat acak, penyimpanan private key di webview `localStorage` memiliki risiko keamanan yang signifikan:
1. Skrip JavaScript apa pun yang berjalan di context webview (termasuk potensi celah XSS atau dependensi frontend pihak ketiga) dapat mengekstrak private key perangkat secara penuh.
2. Seseorang yang mengekstrak private key tersebut dapat memalsukan tanda tangan handshake (`device-handshake:nonce`) dan menyamar sebagai perangkat Windows terpercaya pengguna dari mana saja.
3. Private key tersimpan dalam bentuk teks biasa (plaintext) di direktori profil webview di disk tanpa enkripsi terikat identitas login OS Windows.

## Keputusan Arsitektural

### 1. Isolasi Private Key di Sisi Rust
Private key perangkat dipindahkan sepenuhnya ke proses backend Rust (`apps/windows/src-tauri`).
- JavaScript **TIDAK PERNAH** memiliki akses membaca private key.
- JavaScript hanya menerima **public key** (JWK publik `{ kty: "EC", crv: "P-256", x, y }`) untuk negosiasi metadata handshake.
- Setiap operasi penandatanganan tantangan server (`device.challenge`) didelegasikan melalui Tauri IPC command `sign_device_challenge(challenge)`, di mana Rust menandatangani payload menggunakan ECDSA P-256 SHA-256 dan hanya mengembalikan string signature (Base64 raw IEEE P1363 64-byte `r || s`).

### 2. Pilihan Mekanisme Penyimpanan: Windows DPAPI (Data Protection API)
Kami mengevaluasi dua opsi penyimpanan bawaan Windows:
1. **Windows Credential Manager (`CredWriteW` / `CredReadW` via crate `keyring`)**:
   - *Kelebihan*: Terintegrasi dengan credential store Windows.
   - *Kelemahan*: Memiliki batas ukuran 2560 bytes untuk generic credentials; entri dapat dihapus atau dilihat pengguna secara tidak sengaja melalui antarmuka Control Panel Credential Manager; dependensi crate eksternal tambahan.
2. **Windows DPAPI (`CryptProtectData` / `CryptUnprotectData`)** *(PILIHAN YANG DIPILIH)*:
   - *Kelebihan*: Standar de facto Windows OS untuk perlindungan rahasia per-pengguna. Enkripsi dan dekripsi menggunakan master key yang dikelola oleh Local Security Authority Subsystem Service (LSASS), terikat secara kriptografis pada sesi login Windows pengguna aktif (`CRYPTPROTECT_UI_FORBIDDEN`).
   - Tidak ada batasan ukuran payload.
   - File ciphertext disimpan di `%APPDATA%\personal-ai-os\device_identity.enc` dengan DACL (Discretionary Access Control List) terbatas pada akun pengguna lokal saat ini.
   - Proses atau pengguna Windows lain di mesin yang sama tidak dapat mendekripsi ciphertext tersebut.
   - Untuk lingkungan pengujian non-Windows atau fallback proses, disediakan mekanisme memory/file fallback berisolasi.

### 3. Pilihan Crate Kriptografi: `p256` (RustCrypto)
Untuk penanganan operasi kunci P-256 di Rust:
- Kami memilih crate `p256` (RustCrypto, versi 0.13) dengan feature flags `["ecdsa", "pkcs8", "std"]`.
- *Alasan*: Crate ini 100% pure Rust, tidak bergantung pada pustaka C eksternal (OpenSSL / MSVC CRT linking), bebas dari masalah kompilasi cross-platform, dan memiliki lisensi ganda Apache-2.0 / MIT.
- Menghasilkan tanda tangan raw 64 bytes (`r || s`) yang persis identik dengan keluaran WebCrypto Web API, sehingga sepenuhnya kompatibel dengan verifikator backend Fastify `verifyDeviceSignature`.

### 4. Strategi Migrasi Sekali Jalan (One-Time Migration)
Untuk menjaga kompatibilitas perangkat yang sudah terpasang:
1. Saat aplikasi Windows dimuat, frontend memeriksa apakah terdapat kunci lama di `localStorage` (`personal-ai-os.device-key`).
2. Jika ditemukan, frontend memanggil IPC command `migrate_legacy_key(jwk_json)`.
3. Rust mengimpor kunci tersebut ke penyimpanan aman DPAPI.
4. Segera setelah konfirmasi sukses dari Rust, frontend menghapus kunci tersebut dari `localStorage` (`localStorage.removeItem`).
5. Pemanggilan berikutnya hanya menggunakan kunci terproteksi di sisi Rust.

## Konsekuensi
- **Positif**: Private key perangkat terlindungi dari eksfiltrasi melalui JavaScript / Webview. Sesuai prinsip *defense-in-depth*.
- **Positif**: Tidak ada lagi plain-text private key di penyimpanan webview.
- **Batasan**: Di lingkungan non-Tauri (seperti runner unit test Node.js), `DeviceKeyStore` menggunakan ephemeral in-memory fallback agar pipeline test tetap hijau tanpa emulator webview.
