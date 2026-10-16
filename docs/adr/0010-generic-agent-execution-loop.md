# ADR 0010: Siklus Eksekusi Agen Generik Otonom Berbatas Keras dan Gated Approval

- **Status**: Disetujui (Approved)
- **Tanggal**: 2026-10-15
- **Konteks**: Sesi 8 — Eksekusi Generik Nyata (Prasyarat: Sesi 5 & Sesi 7)

---

## 1. Konteks & Permasalahan

Sebelum Sesi 8, tugas (*tasks*) di Personal AI OS yang bukan merupakan kategori `coding`, `research`, `runtime`, atau `device dispatch` dieksekusi melalui jalur sementara bermarker `[PLACEHOLDER_GENERIC_WORKER]` atau panggilan model tunggal tanpa loop alat otonom (`executeGenericOrchestration` di `apps/agent-worker/src/task-executor.ts`):
1. **Ketiadaan Loop Otonom Multi-Langkah**: Model tidak diberi akses definisi alat (*tool calling*) untuk merencanakan dan mengeksekusi serangkaian langkah secara mandiri.
2. **Ketiadaan Batas Keras (*Hard Bounds*)**: Tidak ada batas yang jelas dan teruji untuk jumlah langkah iterasi, akumulasi token, batas waktu eksekusi (*timeout*), dan batasan *retry*, sehingga berisiko terjadinya loop tanpa henti (*unbounded loop*) atau lonjakan biaya token yang tidak terkendali.
3. **Ketiadaan Evaluasi Kriteria Persisten**: Kriteria akseptasi (*acceptance criteria*) tidak dipersistensi sebelum eksekusi dimulai pada `TaskCheckpoint`, dan evaluasi akhir hanya didasarkan pada boolean sederhana atau kelengkapan artefak generik tanpa menilai apakah luaran benar-benar menjawab permintaan pengguna.
4. **Alat Berisiko Tanpa Integrasi Approval**: Pemanggilan alat berisiko tinggi (`HIGH`/`CRITICAL`) dalam tugas umum belum terintegrasi secara mulus dengan alur persetujuan (`waiting_approval`) dan pemulihan checkpoint saat dilanjutkan pengguna.
5. **Ketiadaan Pengamanan Luaran Alat**: Luaran dari alat web/eksternal belum disanitasi secara seragam sebagai konten tidak tepercaya (*untrusted content*), meningkatkan risiko *prompt injection* tidak langsung.
6. **Ketiadaan Fallback Terverifikasi**: Jika model yang dipilih tidak mendukung kapabilitas `tool_calling` (berdasarkan hasil probe Sesi 5), sistem tidak memiliki mekanisme fallback transparan yang menyatakan secara jujur bahwa eksekusi berlangsung tanpa alat.

---

## 2. Keputusan Arsitektur

### 2.1 Siklus Hidup Eksekusi Generik: Rencana → Langkah → Observasi → Evaluasi
Menerapkan siklus eksekusi agen generik terstruktur yang dijalankan di `apps/agent-worker`:
1. **Fase Rencana (*Planning & Criteria Persistence*)**:
   - Menganalisis niat dan menyusun rencana melalui `IntentAnalyzer` dan `Planner`.
   - Menentukan kriteria akseptasi konkret sebelum eksekusi dimulai (baik dari `task.payload.acceptanceCriteria` maupun kriteria sintesis berbasis tujuan pengguna).
   - Menyimpan kriteria akseptasi ke dalam `task.checkpoint.acceptanceCriteria` pada checkpoint langkah 1.
2. **Fase Langkah (*Model Step & Tool Selection*)**:
   - Memeriksa kapabilitas model: memastikan model memiliki status terverifikasi (`probed` atau `declared`) untuk `tool_calling`.
   - Mengirimkan definisi alat terdaftar dari `ToolRegistry` dalam format standar OpenAI (`tools` dan `toolChoice: 'auto'`).
   - Menerima keputusan model: menghasilkan teks akhir (tujuan tercapai) atau satu/lebih pemanggilan alat (`tool_calls`).
3. **Fase Observasi (*Tool Execution, Permission Gate, Sanitization, & Checkpoint*)**:
   - Setiap alat dieksekusi melalui `SecuredCapabilityGuard`.
   - Jika alat berisiko `HIGH`/`CRITICAL` atau memerlukan izin pengguna, eksekusi melemparkan `ApprovalRequiredError`. Worker membuat permintaan persetujuan via `approvalCreator`, menyimpan checkpoint dengan status `waiting_approval` beserta snapshot state alat, dan menghentikan loop sementara sampai pengguna menyetujui.
   - Luaran alat disanitasi melalui `sanitizeUntrustedToolOutput`: pembersihan ANSI escape sequences, penghapusan karakter kontrol non-cetak, redaksi rahasia sensitif (token, kunci API, private key), dan pembungkusan dalam tag `<untrusted_content tool="..." is_instruction="false">`.
   - Checkpoint berversi baru disimpan di setiap langkah selesai (`task.checkpoint`), mencatat progres aktual dan data observasi.
4. **Fase Evaluasi (*On-Topic Guard & Generic Evaluator*)**:
   - Menjalankan skill bawaan `on-topic-guard` (`onTopicGuardHandler`) untuk memverifikasi keselarasan semantik antara tujuan awal, kriteria akseptasi, dan luaran akhir. Jika terdeteksi penyimpangan topik yang signifikan, evaluasi digagalkan dengan alasan deviasi.
   - Menjalankan `GenericEvaluator` terhadap bukti nyata (artefak luaran, observasi alat, dan log eksekusi) berdasarkan kriteria akseptasi yang telah dipersistensi di awal.
   - Tugas hanya dinyatakan `completed` bila evaluasi lulus dan bukti konkret terpenuhi secara nyata.

### 2.2 Batas Keras (*Hard Bounds*) & Pengendalian Loop
Mencegah terjadinya loop tanpa batas dengan menerapkan batas keras yang tidak dapat dilanggar:
- **Maksimal Langkah (`MAX_STEPS`)**: Default 5 langkah, batas mutlak 10 langkah per tugas. Jika batas tercapai dan model belum menyelesaikan tugas, loop dihentikan dengan alasan `max_steps_exceeded` dan model dipandu menghasilkan sintesis parsial dari observasi yang telah terkumpul.
- **Maksimal Akumulasi Token (`MAX_TOKENS`)**: Batas 16.384 token per tugas. Melebihi batas ini menghentikan loop untuk melindungi kuota komputasi.
- **Batas Waktu Eksekusi (`TIMEOUT_MS`)**: Default 60.000 ms (maksimal 120.000 ms). Melebihi durasi ini menghentikan eksekusi dengan `timeout`.
- **Batas Percobaan Ulang (*Retry Limit*)**: Maksimal 2 kali retry untuk kegagalan transien alat atau jaringan.
- **Penolakan Persetujuan (*Approval Rejection*)**: Jika persetujuan ditolak pengguna, task segera diterminasi dengan status `failed` dan alasan `approval_denied`.

### 2.3 Fallback Jujur (*Honest Single-Pass Fallback*)
Jika model yang ditargetkan tidak memiliki kapabilitas `tool_calling` yang terbukti (status bukan `probed`):
- Sistem tidak memaksakan atau berpura-pura memanggil alat.
- Sistem mengeksekusi model dalam mode teks sekali jalan (*single-pass text completion*).
- Luaran secara transparan dilabeli metadata: `fallbackUsed: true`, `toolsUsed: []`, serta catatan: `"Model tidak memiliki kapabilitas tool_calling terverifikasi; eksekusi dilakukan secara single-pass tanpa tool."`.

### 2.4 Telemetri Lengkap & Observabilitas
Merekam metrik operasional terperinci pada setiap langkah:
- Durasi eksekusi per langkah dan total durasi (`stepDurationMs`, `durationMs`).
- Akumulasi token prompt dan token komputasi (`usage: { promptTokens, completionTokens, totalTokens }`).
- Daftar alat yang berhasil dipanggil (`toolsUsed`).
- Alasan terminasi loop (`stopReason`: `'goal_achieved' | 'max_steps_exceeded' | 'timeout' | 'approval_denied' | 'evaluator_rejected'`).

---

## 3. Konsekuensi

### Positif
1. **Otonomi Nyata Berbasis Bukti**: Tugas umum dapat memanfaatkan perkakas web (`web_fetch`, `web_search`), browser, maupun alat lokal secara otonom dalam koridor yang terkendali.
2. **Keamanan Bertingkat**: Aksi berdampak tinggi selalu tertahan oleh Permission Engine dan wajib mendapatkan persetujuan pengguna sebelum dieksekusi.
3. **Ketahanan Injeksi Prompt**: Konten dari sumber web atau luar selalu dibungkus dalam batas `<untrusted_content>`, mencegah instruksi berbahaya membajak arah penalaran model.
4. **Observabilitas Transparan**: Setiap langkah tercatat dalam event stream (`task.progress`, `task.tool_call`, `task.waiting_approval`), audit log, dan checkpoint.

### Keterbatasan
- Model dengan latensi tinggi dapat mendekati batas `TIMEOUT_MS` jika melakukan lebih dari 3 panggilan alat berturut-turut.
- Model yang belum diprobe akan menggunakan jalur fallback single-pass hingga proses probing pada Sesi 5 dijalankan.
