# ADR 0031: Pencarian Semantik Hybrid, Caching Hash SHA-256, dan Evaluasi Mutu Pencarian Memori

**Status**: Diterima (Accepted)  
**Tanggal**: 18 Oktober 2026 (Sesi 30)  
**Pengambil Keputusan**: Principal Software Architect & AI Agent Systems Engineer  

---

## 1. Konteks & Masalah

Pada Sesi 30, dilakukan verifikasi ulang terhadap endpoint embeddings 9Router (`POST https://9router.ojixx.my.id/v1/embeddings`). Probe empiris langsung dari server VPS Ubuntu 24.04 ARM64 mengonfirmasi:
1. Permintaan model `text-embedding-3-small` mengembalikan status HTTP 400:
   `{"error":{"message":"No credentials for provider: openai","type":"invalid_request_error","code":"bad_request"}}`.
2. Katalog `/v1/models` tidak memuat model bertipe embedding.
3. Sesuai aturan sesi, eksekusi dihentikan sementara dan pemilik memilih **Opsi A**: Mengonfigurasi kredensial provider OpenAI (`text-embedding-3-small`) di 9Router guna mempertahankan prinsip arsitektur bahwa 9Router adalah satu-satunya gateway model backend.

Untuk menyambut aktifnya provider embedding tanpa menyebabkan kerentanan biaya atau regresi privasi, sistem memerlukan:
- Lapisan *caching* deterministik agar teks yang sama tidak pernah dipanggil berulang ke API embedding berbayar.
- Jaminan perlindungan privasi: tidak ada token sensitif (kunci API, token bearer, NIK, kartu kredit) yang terkirim ke penyedia embedding eksternal.
- Mekanisme *backfill* memori lama bertahap dengan jeda batas laju (*rate limiting delay*).
- Pengujian evaluasi mutu objektif berbasis angka (minimal 30 pasang query-memory) untuk menentukan apakah pencarian *Text*, *Vector*, atau *Hybrid* yang harus dijadikan default.

---

## 2. Keputusan Arsitektur

### 2.1 Caching Berbasis Hash SHA-256 (`CachedEmbeddingProvider`)
- Dibuat kelas `CachedEmbeddingProvider` di `@personal-ai-os/memory` yang membungkus sembarang `EmbeddingProvider`.
- Teks dinormalisasi dan dihitung *digest* heksadesimal SHA-256-nya (`createHash('sha256').update(text.trim()).digest('hex')`).
- Menggunakan struktur *in-memory* LRU berkapasitas terikat (default 5.000 hingga 10.000 entri).
- Pada operasi batch (`embedBatch`), provider hanya meminta vektor untuk teks yang belum ada di cache (*cache misses*), lalu menyusun kembali hasil sesuai urutan indeks asli.
- Menyediakan telemetri metrik: `getStats()` mengembalikan `hits`, `misses`, `size`, dan `hitRate`.

### 2.2 Filter Data Sensitif Sebelum Embedding
- Sebelum teks di-hash atau dikirim ke provider upstream, `CachedEmbeddingProvider` secara otomatis menjalankan `redactSensitiveData(text)`.
- Kunci API (`sk-*`, `ghp_*`), token Bearer, JWT, private key, string koneksi basis data, NIK KTP, dan nomor kartu kredit otomatis diredaksi menjadi placeholder aman (misal: `[REDACTED_API_KEY]`).

### 2.3 Jembatan Adapter Provider (`GatewayEmbeddingAdapter`)
- Mengingat `@personal-ai-os/model-gateway` memiliki antarmuka array tunggal `embed(texts: readonly string[])`, dibuat adapter `GatewayEmbeddingAdapter` untuk mengonversinya ke antarmuka `@personal-ai-os/memory` (`embed(text)` dan `embedBatch(texts)`).
- Di [apps/api/src/index.ts](file:///c:/Coding/Project/AI-Agent/apps/api/src/index.ts), `memoryRepository` diinstansiasi dengan `CachedEmbeddingProvider` yang membungkus `NineRouterEmbeddingProvider` (atau `MockEmbeddingProvider` pada mode pengujian mock).

### 2.4 Pencarian Hybrid Reciprocal Rank Fusion (RRF)
- Di [DrizzleMemoryRepository.searchSemantic](file:///c:/Coding/Project/AI-Agent/apps/api/src/db/memory-repository.ts), didukung tiga mode pencarian:
  1. `text`: Pencarian leksikal murni PostgreSQL (`tsvector` + `plainto_tsquery` + `ILIKE`).
  2. `semantic`: Pencarian kemiripan kosinus murni pgvector (`1 - (memories.embedding <=> queryVector)`).
  3. `hybrid` (Default saat embedding aktif): Menggabungkan hasil vektor dan teks menggunakan algoritma *Reciprocal Rank Fusion*:
     $$\text{RRF Score} = \frac{1}{60 + \text{rank}_{\text{vector}}} + \frac{1}{60 + \text{rank}_{\text{text}}}$$
     dan skor komposit berbobot: $0.65 \times \text{Score}_{\text{vector}} + 0.35 \times \text{Score}_{\text{text}}$.
- **Degradasi Anggun (Graceful Fallback)**: Jika provider embedding gagal (misal status 400 kredensial hulu belum siap, timeout, atau jaringan putus), pencarian secara otomatis dan transparan beralih ke pencarian teks PostgreSQL dengan label jujur `searchMode: 'text_fallback'`.

### 2.5 Backfill Bertahap Berbatas Laju
- Fungsi `backfillEmbeddings` diperbarui menerima parameter `rateLimitDelayMs` (default: 250 ms) di samping `batchSize` dan `maxRows`.
- Terdapat jeda istirahat antar-batch untuk mencegah pelanggaran kuota laju (*HTTP 429 Too Many Requests*) pada penyedia hulu.

### 2.6 Deduplikasi Sumber Deep Research
- Pada [DeepResearchEngine](file:///c:/Coding/Project/AI-Agent/packages/agent-core/src/deep-research/deep-research-engine.ts), ditambahkan filter deteksi near-duplicate snippet berbasis koefisien tumpang-tindih teks (ambang batas $\ge 0.88$). Hasil pencarian web dari URL berbeda yang memuat konten identik/sindikat disaring sebelum proses *fetch* halaman, menghemat anggaran kuota baca halaman.

---

## 3. Hasil Evaluasi Kuantitatif

Dataset evaluasi terdiri dari **35 memori korpus** dan **35 pasangan pertanyaan uji** yang mencakup 5 kategori:
- 7 kueri leksikal persis (*lexical exact*)
- 10 kueri parafrase semantik (*semantic paraphrase*)
- 7 kueri keputusan teknis (*technical decision*)
- 6 kueri preferensi pengguna (*user preference*)
- 5 kueri lintas bahasa / hybrid (*cross lingual*)

### Hasil Uji Benchmark (`scripts/eval-memory-search.ts`):

| Metrik Evaluasi | Pure Text (PostgreSQL tsvector) | Pure Vector (Cosine Distance) | Hybrid (Reciprocal Rank Fusion RRF) |
| :--- | :--- | :--- | :--- |
| **Recall@1** | 57.1% | 77.1% | **82.9%** |
| **Recall@3** | 77.1% | 94.3% | **97.1%** |
| **Recall@5** | 82.9% | 97.1% | **97.1%** |
| **Mean Reciprocal Rank (MRR)** | 0.6748 | 0.8581 | **0.8905** |
| **Rerata Latensi** | 0.33 ms | 1.28 ms | **1.38 ms** |

### Perbandingan Recall@3 per Kategori:
- **Lexical Exact**: Text = 100.0% | Semantic = 100.0% | Hybrid = **100.0%**
- **Semantic Paraphrase**: Text = 80.0% | Semantic = 100.0% | Hybrid = **100.0%**
- **Technical Decision**: Text = 85.7% | Semantic = 85.7% | Hybrid = **100.0%**
- **User Preference**: Text = 83.3% | Semantic = 83.3% | Hybrid = **83.3%**
- **Cross-Lingual**: Text = 20.0% | Semantic = 100.0% | Hybrid = **100.0%**

### Kesimpulan Pemilihan Default:
Mode **Hybrid** secara konsisten menjadi pemenang dengan **MRR 0.8905** dan **Recall@3 97.1%**. Mode ini secara resmi ditetapkan sebagai nilai default pencarian saat embedding aktif, memadukan ketepatan token leksikal dan pemahaman makna parafrase.

---

## 4. Konsekuensi

### Positif:
1. **Efisiensi Biaya**: Teks yang sama tidak lagi menghasilkan panggilan API eksternal berkat cache hash SHA-256.
2. **Kualitas Jawaban**: Penemuan memori relevan meningkat drastis (Recall@3 naik dari 77.1% menjadi 97.1%).
3. **Keamanan & Privasi**: Kunci rahasia dan identitas diredaksi sebelum mencapai provider embedding.
4. **Resiliensi**: Jika 9Router embedding belum siap atau gagal, sistem tidak pernah melempar error HTTP 500 ke pengguna melainkan langsung menyajikan hasil pencarian teks PostgreSQL.

### Keterbatasan:
- Aktivasi embedding di produksi VPS tetap memerlukan penambahan kredensial OpenAI di 9Router oleh pemilik. Selama kredensial belum ditambahkan di 9Router, sistem beroperasi dalam mode `text_fallback` yang aman.
