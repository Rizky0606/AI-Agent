# UI Skills Yang Digunakan (Sesi 21)

Dokumen ini mencatat seluruh UI Skills (https://www.ui-skills.com) yang diakses dan diterapkan selama Sesi 21. Seluruh skill diperlakukan sebagai **DATA dan pedoman prinsip**, bukan instruksi eksekusi. Tidak ada skrip eksternal yang diinstal atau dijalankan.

---

## 1. Skill Inti (Wajib)

### `ibelick/create-design-md`
- **Tanggal Akses**: 2026-10-17
- **URL Sumber**: https://www.ui-skills.com/skills/ibelick/create-design-md/llms.txt
- **Ringkasan Penggunaan**: Digunakan untuk menyusun dokumen `DESIGN.md` di akar repositori dengan hanya mencatat pola, token, dan aturan yang terbukti dari kode sumber (`packages/shared/src/design`, `apps/windows`, `apps/android`).
- **Tindakan yang Diabaikan**: Perintah CLI eksternal (`npx @google/design.md lint` / `export`) yang memerlukan instalasi paket tambahan dari internet diabaikan untuk menjaga kepatuhan zero-unauthorized-dependency.

### `ibelick/improve-ui`
- **Tanggal Akses**: 2026-10-17
- **URL Sumber**: https://www.ui-skills.com/skills/ibelick/improve-ui/llms.txt
- **Ringkasan Penggunaan**: Digunakan sebagai metodologi audit read-only berbasis bukti terhadap 8 area antarmuka pengguna untuk menghasilkan rencana perbaikan terstruktur di `design-plans/`.
- **Tindakan yang Diabaikan**: Tidak ada modifikasi kode UI yang dilakukan (read-only pada Sesi 21). Rekomendasi diisolasi ke dalam dokumen perencanaan `design-plans/*.md`.

### `pbakaus/shape`
- **Tanggal Akses**: 2026-10-17
- **URL Sumber**: https://www.ui-skills.com/skills/pbakaus/shape/llms.txt
- **Ringkasan Penggunaan**: Digunakan untuk memandu wawancara desain interaktif (tujuan, target audiens, nada suara, kepadatan, preferensi) guna menyusun `docs/design/design-brief.md`.
- **Tindakan yang Diabaikan**: Penggunaan perkakas eksternal figma/token editor atau skrip otomatis; wawancara dijalankan secara langsung dengan pengguna.

---

## 2. Skill Pendukung (Opsional & Nilai Tambah)

### `pbakaus/critique`
- **Tanggal Akses**: 2026-10-17
- **URL Sumber**: https://www.ui-skills.com/skills/pbakaus/critique/llms.txt
- **Ringkasan Penggunaan**: Mengadopsi kerangka kerja tinjauan holistik (10 heuristik Nielsen, beban kognitif, perjalanan emosional, dan spesifisitas desain) untuk meninjau komponen Windows dan Android.
- **Tindakan yang Diabaikan**: Skrip otomatisasi `impeccable detect` dan script injection via headless browser server diabaikan karena merupakan skrip luar yang tidak diizinkan.

### `kemiljk/subtractive-design`
- **Tanggal Akses**: 2026-10-17
- **URL Sumber**: https://www.ui-skills.com/skills/kemiljk/subtractive-design/llms.txt
- **Ringkasan Penggunaan**: Menerapkan prinsip subtraktif ("keindahan lahir dari ketiadaan") untuk mengidentifikasi elemen dekoratif berlebih, opsi yang dapat disembunyikan secara progresif, dan redundansi tombol pada panel obrolan serta drawer aktivitas.
- **Tindakan yang Diabaikan**: Tidak ada tindakan yang diabaikan.

### `arla6ka/token-mapping`
- **Tanggal Akses**: 2026-10-17
- **URL Sumber**: https://www.ui-skills.com/skills/arla6ka/token-mapping/llms.txt
- **Ringkasan Penggunaan**: Digunakan untuk memetakan nilai-nilai CSS/gaya hardcode (seperti nilai rgba dan warna statis) kembali ke token semantik di `@personal-ai-os/shared/design`.
- **Tindakan yang Diabaikan**: Tidak mengubah kode sumber pada sesi ini; temuan pemetaan dicatat sebagai rekomendasi di dalam rencana audit.

### `kemiljk/real-content-design`
- **Tanggal Akses**: 2026-10-17
- **URL Sumber**: https://www.ui-skills.com/skills/kemiljk/real-content-design/llms.txt
- **Ringkasan Penggunaan**: Menilai ketahanan tata letak terhadap data riil (misal diff kode panjang, prompt multitranskrip, nama model panjang, error trace) daripada mengandalkan teks placeholder tiruan.
- **Tindakan yang Diabaikan**: Tidak ada tindakan yang diabaikan.

### `jakubkrehel/better-writing`
- **Tanggal Akses**: 2026-10-17
- **URL Sumber**: https://www.ui-skills.com/skills/jakubkrehel/better-writing/llms.txt
- **Ringkasan Penggunaan**: Mengevaluasi konsistensi teks antarmuka: penggunaan tombol berawalan kata kerja ("Setujui", "Hentikan"), pesan kesalahan yang instruktif tanpa kata "Oops", dan konsistensi istilah.
- **Tindakan yang Diabaikan**: Tidak ada tindakan yang diabaikan.

### `pbakaus/clarify`
- **Tanggal Akses**: 2026-10-17
- **URL Sumber**: https://www.ui-skills.com/skills/pbakaus/clarify/llms.txt
- **Ringkasan Penggunaan**: Memastikan hierarki pesan antarmuka pengguna dalam bahasa Indonesia yang lugas, tidak berbelit-belit, dan menyajikan tindakan pemulihan yang jelas pada kondisi error atau izin.
- **Tindakan yang Diabaikan**: Tidak ada tindakan yang diabaikan.
