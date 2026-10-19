# Evaluasi Mutu Pencarian Memori: Teks vs Vektor vs Hybrid

Tanggal: 18 Oktober 2026  
Ukuran Sampel: 35 memori korpus, 35 pasangan evaluasi  
Status Evaluasi: Terverifikasi Empiris

---

## 1. Ringkasan Skor Metrik

| Metrik Evaluasi | Pure Text (PostgreSQL tsvector / keyword) | Pure Vector (Cosine Distance <=>) | Hybrid (Reciprocal Rank Fusion RRF) |
| :--- | :--- | :--- | :--- |
| **Recall@1** | 57.1% | 77.1% | **82.9%** |
| **Recall@3** | 77.1% | 94.3% | **97.1%** |
| **Recall@5** | 82.9% | 97.1% | **97.1%** |
| **MRR (Mean Reciprocal Rank)** | 0.6748 | 0.8581 | **0.8905** |
| **Rerata Latensi** | 0.33 ms | 1.28 ms | 1.38 ms |

---

## 2. Performa Per Kategori Kueri (Recall@3)

| **lexical_exact** | 100.0% | 100.0% | **100.0%** |
| **semantic_paraphrase** | 80.0% | 100.0% | **100.0%** |
| **technical_decision** | 85.7% | 85.7% | **100.0%** |
| **user_preference** | 83.3% | 83.3% | **83.3%** |
| **cross_lingual** | 20.0% | 100.0% | **100.0%** |

---

## 3. Analisis & Kesimpulan
1. **Keunggulan Hybrid**:
   Pencarian Hybrid (RRF) mencapai **MRR 0.8905** dan **Recall@3 97.1%**, mengungguli Pure Text secara signifikan pada kategori parafrase semantik (*semantic paraphrase*) dan pertanyaan multibahasa (*cross lingual*), sambil mempertahankan ketepatan 100% pada pencarian leksikal persis (*exact keywords*).
2. **Penentuan Default**:
   Berdasarkan angka empiris di atas, mode pencarian default ditetapkan ke **`hybrid`** saat provider embedding aktif, dengan fallback otomatis ke **`text_fallback`** bila provider mengalami gangguan atau belum terkonfigurasi.
