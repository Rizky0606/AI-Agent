# Design Brief: Personal AI OS

Dokumen ini disusun sebagai ringkasan desain terpadu (*design brief*) berdasarkan panduan `pbakaus/shape`, mengintegrasikan temuan audit heuristik (`pbakaus/critique`), prinsip desain subtraktif (`kemiljk/subtractive-design`), dan evaluasi konten nyata (`kemiljk/real-content-design`).

---

## 1. Job and Audience (Tujuan & Pengguna)
- **Target Pengguna**: Developer, profesional teknologi, dan power user yang mengelola alur kerja pribadi (coding, riset mendalam, otomatisasi lokal Windows, dan asisten mobile Android).
- **Kondisi & Konteks**: Pengguna sering kali bekerja dalam kondisi multitasking, membutuhkan respon cepat, transparansi tingkat tinggi atas tindakan berbahaya (eksekusi terminal/shell), dan ketenangan visual tanpa distraksi ornamen berlebih.
- **Tujuan Utama (*Job to be Done*)**: "Satu asisten, banyak kemampuan" — menyampaikan tujuan dalam bahasa natural dan membiarkan sistem mengatur rencana, eksekusi runtime, izin, dan pembuktian hasil secara otonom dan aman.

---

## 2. Outcome and Proof (Hasil & Pembuktian)
- **Tindakan Kunci**:
  1. Meluncurkan dan memantau tugas agen coding/riset dengan pemantauan langkah real-time (*live steps*).
  2. Memberikan otorisasi bertingkat (Setujui/Tolak) pada tindakan berisiko HIGH/CRITICAL secara cepat dan percaya diri.
  3. Membaca dan menyalin hasil artefak kode, laporan riset dengan kutipan sumber yang terverifikasi.
- **Bukti Kebenaran Produk**:
  - Keterbukaan status eksekusi (bukan mock/klaim kosong; didukung bukti riil pengujian, diff baris kode, dan verifikasi tautan sumber).
  - Isolasi output tidak tepercaya (`<untrusted_content>`).

---

## 3. Selected Direction (Arah Desain Terpilih)
- **Karakter Visual**: Tenang, presisi, minimalis, dan lega (*calm, precise, spacious*).
- **Hierarki Ruang**:
  - Pemanfaatan ruang kosong (*deliberate negative space*) untuk memisahkan fase berpikir agen dari teks jawaban akhir.
  - Pergeseran permukaan bertingkat (*surface elevation shifts*) untuk membedakan kanvas, kontainer obrolan, dan lapisan mengambang.
- **Aksen Warna Fungsional**:
  - Mempertahankan aksen primer **Teal-Mint** (`#2DD4BF` / `#0D9488`) yang memberikan kesan segar, modern, dan tidak melelahkan mata.
  - Mengisolasi warna merah (`danger`) dan kuning (`warning`) murni untuk indikasi risiko dan status kritis.

---

## 4. Scope and Boundaries (Cakupan & Batasan)
- **Cakupan Sesi 21**: Audit desain read-only, inventaris bukti, pembuatan `DESIGN.md`, penyusunan rencana di `design-plans/`, dan penajaman arah melalui wawancara.
- **Batasan Ketat (*Anti-Goals*)**:
  - Tidak mengubah kode komponen UI atau CSS pada Sesi 21 (implementasi dijadwalkan pada Sesi 22–23).
  - Tidak menambah pustaka/dependency eksternal tanpa alasan tertulis dan ADR.
  - Tidak menggunakan font atau aset dari CDN pihak ketiga (kebijakan zero-CDN).

---

## 5. States and Ranges (Kondisi Nyata & Ekstrem Konten)
Berdasarkan evaluasi konten nyata (`kemiljk/real-content-design`):
- **Diff Kode**: Dapat bervariasi dari 1 baris hingga >1000 baris. Diatur dengan batas pemotongan 32 KB dan kontainer gulir vertikal/horizontal independen berbatas tinggi (140dp di Android).
- **Pesan Chat Asisten**: Mulai dari ringkas satu kalimat hingga laporan markdown lengkap bertabel dan berdiagram Mermaid.
- **Daftar Tugas & Approval**: Harus tetap rapi baik saat antrean kosong (0 item), normal (1–5 item), maupun saat beban tinggi (>50 riwayat tugas).

---

## 6. Interaction and Layout (Interaksi & Tata Letak)
- **Windows**:
  - Tata letak 3 kolom dengan batas lebar obrolan tengah $\approx 720\text{px}$.
  - Autocollapse sidebar pada viewport $< 900\text{px}$.
  - Autoscroll hanya aktif saat posisi pengguna berada di paling bawah (`isAtBottom = true`).
- **Android**:
  - 3-Tab Bottom Navigation dengan area sentuh interaktif $\ge 44-48\text{dp}$.
  - Penanganan keyboard sentuh adaptif agar input teks dan chip pilihan tidak tertutup.

---

## 7. Open Decisions for Confirmation (Keputusan Terbuka Menunggu Wawancara Pengguna)
Arah desain final akan dimutakhirkan setelah wawancara desain interaktif (8 pertanyaan pada bagian berikutnya) dijawab oleh pemilik produk.
