# ADR 0021: Enkripsi Terautentikasi (Authenticated Encryption) untuk Backup Offsite Database

**Status**: Diterima (Accepted)  
**Tanggal**: 16 Oktober 2026 (Sesi 19)  
**Pengambil Keputusan**: Principal Software Architect, Security Engineer, DevOps Engineer  
**Konteks**: Sesi 19 — Perbaikan Temuan Review v0.3.0  

---

## 1. Konteks & Masalah

Pada versi v0.3.0 sebelumnya, skrip backup basis data offsite (`scripts/backup-offsite.sh`) memiliki beberapa celah keamanan kritikal:
1. **Enkripsi Tidak Terautentikasi**: Menggunakan `openssl enc -aes-256-cbc -salt -pbkdf2`. Mode Cipher Block Chaining (CBC) memberikan kerahasiaan (*confidentiality*) tetapi tidak memberikan integritas dan autentikasi (*authenticity*). Ciphertext rentan terhadap serangan manipulasi bit (*bit-flipping attack*) atau serangan padding oracle tanpa dapat terdeteksi sebelum proses dekripsi.
2. **Keterbatasan OpenSSL CLI**: Perintah bawaan `openssl enc` secara eksplisit tidak mendukung cipher AEAD (`enc: AEAD ciphers not supported` saat mencoba `-aes-256-gcm`).
3. **Ketiadaan `age` di Host Standar**: Perkakas enkripsi modern seperti `age` tidak terpasang secara bawaan di Ubuntu 24.04 LTS host VPS maupun kontainer minimal. Menambahkan dependensi paket sistem eksternal tanpa jaminan ketersediaan dapat menggagalkan cron backup otomatis.
4. **Kebocoran Passphrase pada Argumen CLI**: Penggunaan `-pass pass:"$BACKUP_ENCRYPTION_PASSPHRASE"` mengekspos passphrase ke tabel proses sistem operasi (`ps aux` / `/proc/$PID/cmdline`) yang dapat dibaca oleh pengguna non-root.
5. **Kunci Cadangan Statis Berbahaya**: Penggunaan fallback `personal-ai-os-default-key-$stamp` di mana timestamp `$stamp` tercantum di nama file backup membuat enkripsi tidak efektif.

---

## 2. Pilihan Solusi yang Dipertimbangkan

| Opsi | Kelebihan | Kelemahan | Keputusan |
| :--- | :--- | :--- | :--- |
| **Opsi 1: `age` CLI** | Format modern, aman secara default, authenticated (ChaCha20-Poly1305). | Tidak terpasang bawaan di host Ubuntu 24.04 / kontainer; membutuhkan instalasi paket eksternal via PPA atau binary download. | **Ditolak sebagai dependensi wajib** |
| **Opsi 2: OpenSSL Encrypt-then-MAC (CBC + HMAC-SHA256)** | Menggunakan perkakas bawaan `openssl`. | Rentan kesalahan implementasi shell parsing (timing attacks, penanganan file tanda tangan ganda). | **Ditolak** |
| **Opsi 3: Node.js Native Authenticated Crypto (`scripts/backup-crypto.js`)** | Memanfaatkan modul bawaan `node:crypto` (Node >= 22 selalu tersedia di repositori & host), menerapkan AES-256-GCM sejati (128-bit authentication tag, Scrypt KDF), streaming I/O, verifikasi izin file kunci (0600), dan kompatibilitas mundur dengan file legacy OpenSSL CBC. | Memerlukan runtime Node.js (sudah merupakan fondasi utama sistem Personal AI OS). | **DIPILIH (Recommended)** |

---

## 3. Keputusan Arsitektur

1. **Implementasi AES-256-GCM via `scripts/backup-crypto.js`**:
   - Algoritma: **AES-256-GCM** dengan kunci 256-bit, IV acak 96-bit (12 bytes), dan Authentication Tag 128-bit (16 bytes).
   - Derivasi Kunci: **Scrypt KDF** (`N=16384, r=8, p=1`) dari isi berkas kunci rahasia (`ENCRYPTION_KEY_FILE`) dengan salt acak 16 bytes.
   - Format Berkas Terenkripsi (`.enc`):
     ```
     [13 bytes] Magic Header: "PAIOS_GCM_V1\n"
     [16 bytes] Salt
     [12 bytes] Initialization Vector (IV)
     [16 bytes] Authentication Tag (GCM Tag)
     [N  bytes] Ciphertext
     ```
2. **Penegakan Izin Berkas Kunci (Strict 0600)**:
   - Berkas kunci wajib ada di filesystem dan memiliki izin akses tidak lebih longgar dari `0600` (`-rw-------`). Jika berkas tidak ada atau memiliki izin yang dapat dibaca pihak lain (`group/other readable`), skrip backup **gagal keras (exit non-nol)**.
   - Seluruh penggunaan parameter `-pass pass:...` dihapus secara total; kunci dibaca langsung dari file descriptor/stream privat tanpa melalui argumen proses.
3. **Kompatibilitas Mundur (Backward Compatibility) pada Restore**:
   - Skrip dekripsi (`backup-crypto.js decrypt` dan `scripts/restore-offsite.sh`) mendeteksi header file:
     - Jika file memiliki magic header `PAIOS_GCM_V1\n`: Didekripsi dan diautentikasi dengan AES-256-GCM. Jika authentication tag tidak valid (data dimanipulasi), proses dekripsi dibatalkan dan file sementara dihapus seketika.
     - Jika file diawali magic bytes OpenSSL `Salted__`: Didekripsi menggunakan fallback legacy OpenSSL `-aes-256-cbc` dengan peringatan log eksplisit.
     - Jika format tidak dikenali: Ditolak keras dengan status kegagalan.
4. **Verifikasi Checksum SHA-256**:
   - Setiap backup menghasilkan berkas `.sha256`. Skrip restore wajib memverifikasi checksum SHA-256 sebelum melakukan dekripsi.
5. **Penghapusan Dump Mentah Seketika**:
   - Berkas dump mentah yang tidak terenkripsi (`personal_ai_os-<stamp>.dump`) wajib segera dihapus (`rm -f`) seketika setelah enkripsi dan unggahan offsite berhasil.
6. **Kegagalan Unggah Wajib Exit Non-Nol**:
   - Jika `S3_BUCKET`, `S3_ENDPOINT_URL`, kredensial S3 tidak lengkap, atau perintah `aws` gagal/tidak ditemukan, skrip backup offsite keluar dengan exit code non-nol dan memicu alert.

---

## 4. Konsekuensi

- **Keamanan**: Dump basis data terlindungi dari manipulasi bit (*tampering*) berkat authentication tag AES-256-GCM. Kunci enkripsi tidak lagi bocor ke tabel proses sistem atau fallback timestamp.
- **Portabilitas**: Menggunakan runtime Node.js bawaan sistem tanpa dependensi npm tambahan atau paket biner Linux yang tidak terverifikasi.
- **Kompatibilitas**: Arsip backup versi sebelumnya tetap dapat dipulihkan dengan aman.
