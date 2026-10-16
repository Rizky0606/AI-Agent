# Runbook Penandatanganan Kode (Code Signing) Windows — Personal AI OS

Dokumen ini adalah panduan teknis dan analisis opsi penandatanganan biner Windows (`.exe` dan installer NSIS) untuk Personal AI OS sesuai standar keamanan modern (kebijakan CA/Browser Forum per Juni 2023).

> **PERINGATAN KEAMANAN**: Sesuai kebijakan proyek, tidak ada sertifikat privat yang boleh dibuat secara sembarangan atau diunggah ke repositori/log. Secret penandatanganan hanya disimpan pada environment rahasia server atau modul HSM terproteksi.

---

## 1. Masalah & Konsekuensi Tanpa Penandatanganan
1. **Windows SmartScreen**: Saat pengguna mengunduh dan menjalankan `personal-ai-os-windows-setup.exe`, Windows Defender SmartScreen akan menampilkan layar biru tebal:
   > *"Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognized app from starting."*
2. **Integritas Biner**: Pengguna tidak dapat memverifikasi apakah installer telah dimodifikasi oleh pihak ketiga (man-in-the-middle) selama transmisi.
3. **Anti-Virus Heuristik**: Installer yang tidak ditandatangani lebih rentan dideteksi sebagai *false positive* oleh mesin heuristik anti-virus.

---

## 2. Standar Regulasi Baru (CA/Browser Forum 2023)
Mulai 1 Juni 2023, semua sertifikat penandatanganan kode (baik **Organization Validation (OV)** maupun **Extended Validation (EV)**) **wajib** disimpan pada hardware module bersertifikasi minimal **FIPS 140-2 Level 2** atau **Common Criteria EAL 4+**.
- File `.pfx` konvensional berbasis password tidak lagi diizinkan oleh Certificate Authority (CA) publik.
- Kunci privat harus berada di Cloud HSM atau token USB fisik (hardware token).

---

## 3. Perbandingan Opsi Solusi

| Kriteria | Opsi 1: Azure Trusted Signing (Microsoft) | Opsi 2: DigiCert KeyLocker / eSigner Cloud HSM | Opsi 3: Hardware Token Fisik (USB Dongle) | Opsi 4: Self-Signed Test Certificate |
| :--- | :--- | :--- | :--- | :--- |
| **Kategori** | Cloud HSM Terkelola Microsoft | Cloud HSM Pihak Ketiga | Fisik Lokal (YubiKey / SafeNet) | Sertifikat Internal Pengembang |
| **Reputasi SmartScreen** | **Instan Terpercaya** (dikelola langsung oleh ekosistem Microsoft) | Butuh akumulasi reputasi (OV) atau instan (EV) | Butuh akumulasi (OV) atau instan (EV) | **Ditolak** (Kecuali root di-import manual) |
| **Integrasi CI/CD GitHub Actions** | **Sangat Mudah & Aman** (via OIDC federated credentials, tanpa secret password statis) | Menggunakan credentials client API eSigner | Sangat Sulit (butuh self-hosted runner fisik dengan dongle tercolok) | Mudah (tapi hanya untuk pengujian lokal) |
| **Estimasi Biaya** | Sangat terjangkau: ~**$9.99/bulan** (berdasarkan langganan Azure) | Mahal: ~**$400 – $800/tahun** | Mahal: ~**$300 – $600/tahun** + biaya kurir dongle | **Gratis ($0)** |
| **Status Kelayakan Produksi** | **SANGAT DIREKOMENDASIKAN** | Layak, tetapi biaya lebih tinggi | Tidak direkomendasikan untuk otomasi cloud | Hanya untuk staging / dev mode |

---

## 4. Alur Integrasi GitHub Actions (Rekomendasi: Azure Trusted Signing)

### A. Pengaturan Identitas Tanpa Password (OIDC Workload Identity)
1. Buat Azure App Registration terhubung ke repositori GitHub `Rizky0606/AI-Agent`.
2. Simpan identitas pada GitHub Actions Secrets (Environment `production-release`):
   - `AZURE_CLIENT_ID`
   - `AZURE_TENANT_ID`
   - `AZURE_SUBSCRIPTION_ID`
   - `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
   - `AZURE_CERTIFICATE_PROFILE_NAME`
3. Workflow GitHub Actions meminta token OIDC berdurasi singkat langsung dari Azure STS tanpa menyimpan password privat.

### B. Langkah Eksekusi Penandatanganan di Runner Windows
Penandatanganan dilakukan dalam dua tahap:
1. **Penandatanganan Payload Binary Aplikasi**:
   ```powershell
   # Menandatangani binary Tauri utama sebelum di-bundle ke dalam NSIS
   Invoke-TrustedSigning -Endpoint "https://eus.codesigning.azure.net" `
       -CertificateProfileName $env:AZURE_CERTIFICATE_PROFILE_NAME `
       -Files @("apps/windows/src-tauri/target/release/personal-ai-os-windows.exe")
   ```
2. **Penandatanganan Bundle Installer NSIS Akhir**:
   ```powershell
   # Menandatangani file setup.exe
   Invoke-TrustedSigning -Endpoint "https://eus.codesigning.azure.net" `
       -CertificateProfileName $env:AZURE_CERTIFICATE_PROFILE_NAME `
       -Files @("apps/windows/src-tauri/target/release/bundle/nsis/*.exe")
   ```
3. **Timestamping RFC 3161**:
   Menggunakan counter-signature timestamping (`http://timestamp.acs.microsoft.com`), memastikan masa berlaku tanda tangan tetap sah meskipun sertifikat asal telah kedaluwarsa di masa depan.

---

## 5. Keputusan yang Diperlukan dari Pengguna
Sebelum implementasi penandatanganan diterapkan pada pipeline release, pengguna diminta memilih pendekatan:
1. **Pilihan 1 (Disarankan)**: Menggunakan **Microsoft Azure Trusted Signing** untuk otomasi CI/CD penuh dengan biaya efektif dan reputasi instan di Windows.
2. **Pilihan 2**: Menggunakan sertifikat EV pihak ketiga tradisional (DigiCert / SSL.com) jika organisasi memiliki preferensi CA independen.
3. **Pilihan 3**: Menunda penandatanganan resmi (installer tetap dibangun tanpa tanda tangan, pengguna melewati SmartScreen dengan tombol *"More Info -> Run Anyway"* selama fase alpha/beta).
