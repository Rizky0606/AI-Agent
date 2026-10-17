# Rencana Desain Antarmuka: Deep Research Baru

Dokumen ini menyusun spesifikasi dan rencana implementasi UI untuk kapabilitas **Deep Research** (penelitian multi-langkah otonom dengan bukti kutipan dan evaluasi independen), berdasarkan audit arsitektur backend `ResearchAgent` dan `LocalResearchEnvironment`.

---

## Bahasa Desain & Bukti
- **Permukaan yang Diaudit**: Jalur riset agen backend (`packages/agent-core/src/research/`, `packages/evaluator/src/research-evaluator.ts`) dan integrasi kartu aktivitas klien (`TaskCard.tsx`, `TaskDetailScreen.tsx`).
- **Sumber Desain**: `DESIGN.md`, `packages/shared/src/design/tokens.ts`, `docs/capability-matrix.yaml`.
- **Keputusan Terdokumentasi**:
  - `ResearchAgent` melakukan penelusuran melalui `web_search` dan `web_fetch`, menghasilkan sintesis klaim dengan kutipan `[src-N]`.
  - `ResearchEvaluator` memverifikasi klaim dengan mengambil ulang URL sumber (`urlFetcher`) untuk memastikan `claim_support` dan `query_relevance`.
  - UI klien saat ini hanya menampilkan hasil akhir tanpa visualisasi eksplorasi pohon sumber riset (*research tree*).
- **Pemilik & Konsumen Pengatur**: Rencana kartu baru untuk `apps/windows/src/ui/activity/` dan `apps/android/src/screens/`.
- **Pengecualian Eksplisit**: Komponen visual Deep Research ini adalah fitur baru yang dirancang untuk dieksekusi di sesi implementasi berikutnya.

---

## Temuan Audit & Masalah Terbukti

| # | Prioritas | Masalah | Bukti (`path:line`) | Usulan Perubahan | Cakupan | Keyakinan |
|---|---|---|---|---|---|---|
| 1 | **P1** | Kutipan `[src-N]` dalam laporan riset hanya berupa teks biasa di chat tanpa kartu sumber interaktif | `apps/windows/src/ui/chat/MarkdownMessage.tsx:145` | Kembangkan komponen `ResearchCitationCard` yang menampilkan pratinjau judul artikel, domain sumber, status verifikasi evaluator, dan tautan luar yang aman. | Chat & Aktivitas | Tinggi |
| 2 | **P1** | Tahapan riset (Mencari query -> Mengunduh halaman -> Mengevaluasi bukti) tidak memiliki visualisasi alur bertingkat | `packages/agent-core/src/research/research-agent.ts:120` | Buat komponen `ResearchPlanProgress` di dalam `ToolStepCard` yang menunjukkan pohon eksplorasi sumber dan jumlah sumber yang berhasil divalidasi. | Progress Riset | Tinggi |
| 3 | **P2** | Hasil sintesis riset akhir tercampur dengan pesan chat biasa sehingga sulit diekspor sebagai dokumen terpisah | `apps/windows/src/ui/activity/ArtifactCard.tsx:30` | Sediakan tombol satu-klik "Simpan sebagai Laporan Riset (.md)" pada header ringkasan riset untuk mengunduh laporan lengkap beserta daftar pustaka kutipan. | Aksi Artefak | Sedang |

---

## Urutan Eksekusi (Improve First)
**Prioritas Utama (P1)**: Komponen `ResearchCitationCard` dan penampil daftar sumber yang telah diverifikasi oleh evaluator. Menghadirkan bukti nyata sumber web secara transparan membangun kepercayaan pengguna terhadap jawaban asisten AI.

---

## Rencana Implementasi Mandiri (Untuk Agen Pelaksana)
1. **Target**: `apps/windows/src/ui/chat/ResearchCitation.tsx` dan `apps/android/src/components/ResearchCitation.tsx`.
2. **Langkah-langkah**:
   - Deteksi pola `[src-N]` dalam parser Markdown dan ubah menjadi chip kutipan yang dapat diklik.
   - Saat chip diklik, buka popover ringkas yang menampilkan judul sumber, cuplikan paragraf yang dikutip, dan tingkat keyakinan evaluator (*Verified Support* / *Uncertain*).
   - Terapkan dialog konfirmasi aman saat membuka URL sumber asli ke peramban eksternal.
3. **Kriteria Verifikasi**:
   - Parsing kutipan tidak merusak rendering teks markdown biasa.
   - Test unit parser kutipan lolos pada Windows dan Android.
