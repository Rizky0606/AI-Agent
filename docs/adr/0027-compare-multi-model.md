# 0027. Arsitektur Compare Multi-Model, Privasi Mode Buta, dan Integrasi Percakapan

- **Status**: Diterima
- **Tanggal**: 2026-10-17
- **Pengambil Keputusan**: Principal Software Architect, Senior Full-Stack Engineer, Security Engineer
- **Area**: Backend (`apps/api`, `packages/agent-core`), Shared (`packages/shared`), Frontend (`apps/windows`, `apps/android`)

---

## 1. Konteks dan Kebutuhan

Pengguna Personal AI OS membutuhkan fitur evaluasi objektif antar-model AI (_Compare Multi-Model_) untuk memilih model terbaik bagi kebutuhan spesifik (kecepatan, akurasi, kedalaman analisis, gaya penalaran, atau penulisan kode). Fitur ini menerima satu prompt dari pengguna dan mendistribusikannya secara bersamaan ke 2–3 model yang dipilih dari katalog terverifikasi (Sesi 5 dan 6).

Fitur ini memiliki karakteristik unik:
1. **Bukan Agentic/Tool Execution**: Compare murni menjalankan inferensi chat generatif tanpa mengeksekusi tool lokal Windows, MCP, browser automation, atau durable task, guna menjaga performa dan membatasi beban pada gateway model (9Router).
2. **Kebutuhan Evaluasi Tanpa Bias**: Pengguna sering kali memiliki bias psikologis terhadap merek model tertentu (misal OpenAI vs Anthropic vs Google). Diperlukan **Mode Buta (Blind Mode)** di mana identitas model disembunyikan sampai hasil dievaluasi.
3. **Integritas Komparasi (Larangan Fallback)**: Dalam chat reguler, jika model utama gagal, router akan beralih ke model cadangan (_fallback_). Namun pada Compare, **fallback otomatis dilarang keras**. Jika model tertentu gagal (misal rate limit 429 atau error 500), kolom model tersebut wajib ditandai gagal agar perbandingan tetap jujur dan tidak menyesatkan pengguna.

---

## 2. Keputusan Arsitektur & Desain

### A. Eksekusi Paralel Terbatas & Anggaran Token (Token Budgeting)
- **Batas Model**: Dibatasi 2 hingga 3 model per perbandingan.
- **Konkurensi**: Permintaan model dieksekusi secara paralel menggunakan Semaphore/Promise pool (`concurrency: 3`) dengan streaming token delta per kolom.
- **Anggaran Token Keras**: Setiap sesi perbandingan memiliki batas anggaran total token (default 4.000–8.000 token akumulatif). Jika batas anggaran terlampaui saat proses streaming berlangsung, generasi dipotong secara anggun (_graceful truncation_).

### B. Kebijakan Anti-Fallback Ketat
- Pemanggilan inferensi pada Compare memintas logika fallback router otomatis (`fallbackUsed: false`).
- Jika Model A gagal (error jaringan, timeout, penolakan kuota, dsb.), Model A diberi status `failed` beserta pesan galat aslinya. Model B dan Model C tetap berjalan secara independen tanpa terpengaruh.

### C. Privasi Mode Buta (Blind Mode) & Zero-Leak Guarantee
- Ketika `blind_mode = true`:
  - Di tingkat backend, urutan model diacak atau dipetakan ke alias deterministik (`Model A`, `Model B`, `Model C`).
  - Selama perbandingan belum diungkap (`revealed = false`), payload API (`GET /v1/compare/:id`, response stream, dan event WebSocket) **tidak boleh menyertakan `model_id` asli**, header penyedia, atau metadata yang dapat mengidentifikasi model.
  - Nama model aktual hanya dibuka ke klien setelah pengguna:
    1. Memilih model pemenang (`POST /v1/compare/:id/winner`), atau
    2. Menekan tombol "Ungkap" (`POST /v1/compare/:id/reveal`).
  - Pilihan pengguna disimpan di kolom `winner_model_id` dan `is_winner` untuk keperluan analitik personal dan benchmark riwayat.

### D. Sintesis Komparatif Otomatis (Opsional)
- Pengguna dapat meminta sintesis setelah model selesai merespons via `POST /v1/compare/:id/synthesize`.
- Sintesis menjalankan satu panggilan model ringkas (menggunakan model yang terkonfigurasi atau rekomendasi cepat), yang menganalisis:
  1. **Persamaan**: Poin-poin kesepakatan seluruh model.
  2. **Perbedaan**: Perbedaan pendekatan, kedalaman analisis, struktur data, atau gaya bahasa.
  3. **Rekomendasi**: Rekomendasi penggunaan berdasarkan konteks prompt.
- Model yang digunakan untuk sintesis wajib diberi label transparan (misal `synthesisModel: "google/gemini-2.5-flash"`).

### E. Metrik Transparan & Tanpa Rekaan
- Latensi per model diukur secara nyata dari selisih waktu awal request hingga chunk terakhir selesai (`latencyMs`).
- Jumlah token (`promptTokens`, `completionTokens`, `totalTokens`) dan estimasi biaya (`cost`) diambil murni dari data `usage` gateway 9Router jika disediakan.
- Jika gateway tidak mengembalikan biaya atau token, nilai ditampilkan sebagai `null` atau `-`. Dilarang mengarang atau menebak nilai numerik.

### F. Promosi ke Percakapan Chat Aktif
- Pengguna dapat memilih respons terbaik dan menekan "Jadikan Jawaban Ini Lanjutan Percakapan" (`POST /v1/compare/:id/promote`).
- Backend secara atomik membuat entri baru di tabel `conversations` dan dua entri di `messages` (pesan pengguna berisi prompt awal, dan pesan asisten berisi respons pemenang), lalu mengembalikan `conversationId` sehingga antarmuka klien dapat langsung bertransisi ke layar chat utama.

### G. Skema Basis Data & Penyimpanan
- Tabel `compare_runs`: Menyimpan metadata sesi perbandingan (prompt, user_id, project_id, blind_mode, status, winner_model_id, token_budget, total_tokens_used, sintesis).
- Tabel `compare_results`: Menyimpan data respons tiap model (run_id, column_index, model_id, model_alias, content, status, latency_ms, token usage, cost, is_winner).

### H. Desain Antarmuka Multi-Platform
1. **Windows Desktop**:
   - Layout grid multi-kolom berdampingan (_side-by-side_) dengan pembagi visual elegan.
   - Header ringkas dengan sakelar Mode Buta, indikator token budget, dan aksi global.
   - Kartu kolom independen dengan tombol Salin Cepat, Pilih Pemenang, dan Promosi ke Chat.
   - Panel drawer / accordion untuk melihat hasil Sintesis.
2. **Android Mobile**:
   - Layout geser horizontal (_swipeable horizontal paging_) atau tab per model (Model A / Model B / Model C), memungkinkan perbandingan yang nyaman pada layar vertikal smartphone tanpa memadatkan teks.
   - Kartu metrik responsif dan tombol aksi cepat di bagian bawah setiap kolom.

---

## 3. Konsekuensi dan Evaluasi

- **Positif**:
  - Pengguna mendapatkan perbandingan kinerja model yang objektif, transparan, dan bebas bias.
  - Beban gateway terkendali berkat batas model (2-3) dan ketiadaan eksekusi tool/agent di sesi Compare.
  - Arsitektur berbasis streaming delta memberikan latensi persepsi instan bagi pengguna.
  - Tidak ada dependensi npm eksternal baru yang ditambahkan (menggunakan modul built-in Fastify, React, React Native, dan shared state reducer).
- **Keterbatasan yang Diakui**:
  - Komparasi dibatasi maksimum 3 model sekaligus untuk mencegah pemborosan kuota dan mematuhi batas beban server VPS.
  - Mode Buta bergantung pada model tidak menyebutkan nama dirinya sendiri di dalam teks jawaban (beberapa model mungkin menyapa dengan "Saya Gemini" atau "Saya ChatGPT" jika tidak dicegah oleh system prompt netral). System prompt standar anti-self-identification diterapkan pada sesi Mode Buta untuk meminimalkan kebocoran konten.
