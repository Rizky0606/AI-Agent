# ADR 0012: Pencarian Memori Hybrid PostgreSQL & Alur Usulan Tanpa Penyimpanan Diam-diam

**Status**: Diterima (Accepted)  
**Tanggal**: 15 Oktober 2026 (Sesi 10)  
**Pengambil Keputusan**: Principal Software Architect & Senior Full-Stack Engineer  

---

## 1. Konteks & Masalah

Pada arsitektur *Personal AI OS*, sistem memori jangka panjang telah memiliki skema basis data PostgreSQL dengan ekstensi `pgvector` (`vector(1536)`). Namun, evaluasi pada Sesi 10 menemukan beberapa kendala mendasar:

1. **Endpoint Embeddings 9Router Belum Memiliki Kredensial**:
   Verifikasi langsung ke gateway `POST https://9router.ojixx.my.id/v1/embeddings` mengembalikan pesan kesalahan bahwa provider embedding (seperti OpenAI/Vertex) belum dikonfigurasi (`No credentials for provider: openai`). Akibatnya, `InactiveEmbeddingProvider` aktif dan mengembalikan vektor nol.
2. **Aturan Batasan Proyek**:
   Sesuai `AGENTS.md`, aturan proyek menyatakan: *"Tanpa inferensi LLM lokal di VPS."* Maka server VPS tidak boleh menjalankan model embedding lokal (misalnya ONNX runtime, sentence-transformers, atau Ollama) yang membebani OCPU/RAM VPS.
3. **Route Shadowing di Fastify API**:
   Route parameter dinamis `/:id` (dengan validasi skema UUID) ditempatkan sebelum route statis `/search`, sehingga permintaan `GET /v1/memories/search` tertangkap oleh `/:id` dan menghasilkan kode status HTTP 400.
4. **Ketiadaan Ekstraksi Otomatis & Risiko Penyimpanan Diam-diam**:
   Sebelumnya, worker tidak memiliki integrasi ekstraksi memori. AI dapat kehilangan konteks penting antarsesi, namun menyimpan memori secara diam-diam tanpa persetujuan pengguna melanggar privasi pengguna dan prinsip kedaulatan data.
5. **Ketiadaan Pembersihan TTL Retensi**:
   Tabel memori memiliki kolom `retention`, namun tidak ada proses pembersihan (*sweeper*) berkala untuk memori kedaluwarsa.

---

## 2. Pilihan yang Dievaluasi untuk Provider Embedding

### Opsi A: Konfigurasi Kredensial Provider Embedding di 9Router
- **Deskripsi**: Menambahkan kunci API provider embedding (misal: OpenAI `text-embedding-3-small`, Cohere `embed-english-v3.0`, atau Google Vertex) ke dalam konfigurasi 9Router.
- **Kelebihan**: Mengaktifkan pencarian kemiripan kosinus semantik sesungguhnya (`<=>` pada pgvector).
- **Konsekuensi / Keterbatasan**: Memerlukan akun berbayar provider pihak ketiga dan intervensi konfigurasi di 9Router luar repo.

### Opsi B: Menjalankan Model Embedding Lokal di VPS Oracle
- **Deskripsi**: Menjalankan model embedding kecil (seperti `all-MiniLM-L6-v2`) di dalam container VPS via Python/ONNX.
- **Konsekuensi**: **Ditolak keras**. Melanggar aturan arsitektur proyek (*"Tanpa inferensi LLM lokal di VPS"*), menambah konsumsi RAM di batas 12 GB, dan meningkatkan kompleksitas operasi.

### Opsi C: Pencarian Hybrid Berbasis PostgreSQL Full-Text (`tsvector` + `ILIKE`) dengan Label Jujur & Jalur Backfill Bertahap (Dipilih)
- **Deskripsi**:
  - Mengimplementasikan pencarian teks PostgreSQL menggunakan `plainto_tsquery` / `to_tsvector` dikombinasikan dengan pencocokan parsial `ILIKE` sebagai fallback handal ketika provider embedding belum aktif.
  - Memberikan respons metadata yang transparan dan jujur: `semanticSearchActive: false`, `searchMode: 'text_fallback'`.
  - Antarmuka Windows dan Android menampilkan spanduk kejujuran kepada pengguna (*"Mode: Pencarian teks PostgreSQL (Non-Semantik)"*).
  - Menyediakan endpoint migrasi data bertahap (`POST /v1/memories/backfill`) dengan ukuran *batch* terbatas sehingga ketika kredensial 9Router di kemudian hari dikonfigurasi, seluruh memori lama dapat diperbarui vektornya tanpa downtime.

---

## 3. Keputusan Arsitektur

1. **Adopsi Opsi C**: Mengimplementasikan pencarian teks PostgreSQL pada `DrizzleMemoryRepository.searchSemantic` dengan degradasi anggun (*graceful fallback*).
2. **Koreksi Urutan Route Fastify**: Seluruh endpoint statis (`/search`, `/proposals`, `/sweep`, `/backfill`) didaftarkan sebelum route berparameter `/:id`. Mendukung baik metode `POST` maupun `GET /v1/memories/search`.
3. **Alur Usulan Memori (Zero Silent Storage)**:
   - Worker dan Chat mengekstraksi poin preferensi dan fakta melalui `MemoryCandidateExtractor`.
   - Data melewati `SensitiveDataFilter` untuk menyaring dan meredaksi kunci rahasia, kata sandi, NIK, dan kartu pembayaran.
   - Hasil disimpan dalam basis data dengan status `status: 'proposed'`.
   - Data usulan tidak dimuat ke dalam prompt LLM (`ContextManager` hanya memuat status `active`). Pengguna harus menyetujui atau menolak usulan di aplikasi klien (Windows / Android).
4. **Sweeper Retensi Terjadwal**:
   - Menghitung masa hidup berdasarkan `retention` (`ephemeral` = 1 hari, `session` = 7 hari, `30d`, `90d`, `permanent` = selamanya).
   - Menghapus record yang kedaluwarsa dan mencatat operasi ke dalam tabel `audit_logs` untuk akuntabilitas.
5. **Pelacakan Asal Memori (Provenance)**:
   - `ContextManager.buildContext` mengembalikan `usedMemories` dan `usedMemoryIds` sehingga antarmuka dapat menampilkan memori spesifik mana yang mempengaruhi jawaban AI.

---

## 4. Konsekuensi & Rencana Lanjutan

- **Positif**:
  - Sistem pencarian memori berfungsi 100% tanpa dependensi eksternal yang gagal.
  - Kepatuhan total terhadap privasi dan batasan hardware VPS.
  - Jalur transisi ke embedding semantik penuh sudah siap melalui fungsi `backfillEmbeddings`.
- **Keterbatasan Saat Ini**:
  - Pencarian teks mengandalkan kecocokan kata kunci dan akar kata bahasa, bukan pemahaman semantik mendalam terhadap parafrase kalimat.
- **Rekomendasi Tindak Lanjut untuk Pengguna**:
  - Konfigurasikan token OpenAI atau model embedding yang didukung di 9Router jika ingin mengaktifkan vector cosine similarity search. Setelah itu, jalankan migrasi dengan memanggil `POST /v1/memories/backfill`.
