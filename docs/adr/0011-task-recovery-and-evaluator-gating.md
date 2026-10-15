# ADR 0011: Pemulihan Tugas (Task Recovery) dan Evaluator Riset Berbasis Sitasi Nyata

## Status
Accepted

## Konteks
Pada audit sistem dan penilaian berkala (Oktober 2026), ditemukan beberapa celah penting pada siklus hidup tugas dan evaluasi:
1. **Pemulihan Tugas Terinterupsi (*Task Recovery*)**: Ketika proses worker mati mendadak (crash/restart), tugas berstatus `running` atau `planning` atau `queued` yang belum selesai dapat menjadi yatim (*dangling*). Sebelum perbaikan, pemulihan hanya mencatat event tanpa menjamin eksekusi tepat sekali (*exactly-once execution*), berisiko terjadinya eksekusi ganda jika beberapa worker pulih bersamaan, dan tidak membatasi perulangan tugas yang telah melampaui batas percobaan maksimal (`maxAttempts`).
2. **Evaluator Riset (*Research Evaluator*)**: Sebelumnya, klaim riset hanya merupakan kutipan pembuka halaman (`snippet.slice(0, 400)`) tanpa sintesis model lintas sumber, `ResearchEvaluator` tidak memvalidasi ulang kebenaran isi URL rujukan secara independen, dan relevansi klaim terhadap pertanyaan pengguna belum dinilai.
3. **Gating Evaluator Coding**: Jalur penyelesaian tugas pemrograman wajib selalu berbasis bukti nyata eksekusi (*lint, typecheck, unit test, build, diff*) di sandbox terisolasi tanpa celah jalan pintas (*bypass*).
4. **Penyajian Alasan Penolakan Evaluator**: Ketika tugas ditolak oleh evaluator, alasan kegagalan harus disajikan secara manusiawi dalam Bahasa Indonesia ke klien Windows dan Android.

## Keputusan Arsitektur

### 1. Protokol Pemulihan Tugas (*Durable Task Recovery*)
- **Deteksi Komprehensif**: `SqlTaskRepository.getDanglingTasks()` memeriksa tugas dengan status `running`, `planning`, dan `queued` yang kehilangan lease eksekusi atau belum diambil oleh antrean.
- **Batas Percobaan Ulang (*Retry Bound*)**: Jika `task.attempt >= task.maxAttempts`, tugas tidak di-requeue, melainkan ditransisikan ke status `failed` dengan alasan kegagalan transparan: "Batas percobaan ulang maksimal tercapai saat pemulihan tugas."
- **Pencegahan Eksekusi Ganda (*No Double Execution*)**: Menggunakan transaksi PostgreSQL dengan advisory lock `pg_try_advisory_xact_lock` atau pembaruan status atomik (`UPDATE ... WHERE status = 'running' ... RETURNING id`), serta deduplikasi BullMQ berbasis `jobId = task.id`.
- **Integritas Checkpoint**: Setiap pemulihan memverifikasi checksum SHA-256 pada checkpoint versi terakhir (`verifyCheckpointIntegrity`). Jika korup, tugas digagalkan demi keamanan; jika valid, eksekusi dilanjutkan dari `lastStep + 1`.

### 2. Sintesis Riset & Evaluasi Kebenaran Sitasi (*Fact Checking*)
- **Sintesis Lintas Sumber**: `ResearchAgent` memanfaatkan `ModelGateway` untuk menyintesis poin-poin temuan terstruktur menjawab pertanyaan pengguna, dengan setiap klaim fakta wajib menyertakan indeks sitasi (`[src-1]`, `[src-2]`).
- **Verifikasi Ulang URL oleh Evaluator**: `ResearchEvaluator` mengambil sampel atau keseluruhan URL sumber secara mandiri menggunakan `UrlFetcher`, memastikan:
  - **Dukungan Klaim (*Claim Support*)**: Teks pada sumber rujukan benar-benar memuat substansi klaim fakta (mencegah sitasi fiktif atau halusinasi).
  - **Relevansi Pertanyaan (*Query Relevance*)**: Klaim yang disajikan secara substansial menjawab pertanyaan riset pengguna.
- **Penyimpanan Skor & Alasan**: Evaluator menghasilkan skor terukur (0.0 - 1.0) dengan catatan evaluasi terperinci untuk setiap kriteria.

### 3. Gating Ketat Evaluator Coding
- Tidak ada tugas coding yang dapat bertransisi ke `completed` tanpa `report.evaluationResult.passed === true` dari `CodingEvaluator`.
- Evaluator memvalidasi artefak bukti nyata: exit code `runLint`, `runTypecheck`, `runTests` (harus 0 gagal), `runBuild`, dan ketiadaan secret pada `getDiff()`.

### 4. Penyajian Alasan Manusiawi ke Klien
- Alasan penolakan evaluator distrukturkan dalam payload `task.failed` dan `task.error` menggunakan kalimat Bahasa Indonesia yang jelas, bukan sekadar kode error mentah.

## Konsekuensi
- **Positif**: Ketahanan crash 100% teruji dengan PostgreSQL & Redis nyata. Menghilangkan halusinasi sitasi pada riset. Menjamin tidak ada tugas coding yang selesai palsu.
- **Mitigasi**: Pengambilan ulang URL oleh `ResearchEvaluator` dibatasi batas waktu (timeout) dan pagu ukuran agar tidak membebani performa worker.
