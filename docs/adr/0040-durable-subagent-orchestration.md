# ADR 0040: Durable Subagent Orchestration & Hierarchy

## Status
Accepted

## Konteks
Personal AI OS memerlukan kemampuan orkestrasi subagent (delegasi task anak) yang andal lintas control plane VPS (ARM64, 2 OCPU, 12 GB RAM) dan worker. Sebelumnya, task dieksekusi secara linear atau terikat pada runtime tunggal. Jika sebuah pekerjaan besar didelegasikan tanpa state yang tahan uji (durable), worker crash atau timeout akan mengakibatkan split-brain, duplicate execution, kebocoran memori/kredensial ke subagent, atau kegagalan yang disamarkan sebagai keberhasilan ("fake success").

Sesuai aturan arsitektur:
1. PostgreSQL adalah *single source of truth* untuk state durable, approval, dan audit trail.
2. BullMQ / Redis adalah transport eksekusi asinkron tanpa membuat queue in-memory paralel.
3. Kapasitas VPS konservatif: concurrency harus dibatasi dan tidak boleh mengasumsikan resource tak terbatas.
4. Summary atau klaim self-reported dari agen adalah *untrusted content*; verifikasi harus berdasarkan bukti nyata/artefak konkret via Evaluator.
5. Delegasi coding tidak boleh melakukan auto-merge ke `main`, auto-push ke remote, atau auto-deploy tanpa review dan approval.

## Keputusan Arsitektur

### 1. Relasi Hierarki di Database (`parent_task_id`)
- Kolom `parent_task_id` (UUID nullable) ditambahkan ke tabel `tasks` di PostgreSQL dengan index `tasks_parent_idx` untuk pencarian relasional cepat.
- Model `TaskModel`, parameter `CreateTaskParams`, dan `TaskRepository` (`SqlTaskRepository` dan `InMemoryTaskRepository`) diperbarui dengan method `listChildTasks(userId, parentTaskId)`.
- Parent task menyimpan tujuan (`objective`), acceptance criteria (`successCriteria`), batas waktu/biaya, dan child plan (`childPlan`).
- Child task menyimpan `parent_task_id`, `status`, `assignedRuntime`, `isolatedWorkspace`, capability allowlist, serta hasil ringkas.

### 2. Idempotensi dan Pencegahan Eksekusi Ganda
- Setiap child task dibuat dengan `idempotencyKey` terstruktur: `${parentTaskId}-child-${planItemId}`.
- Saat worker restart, recovery, atau re-enqueuing terjadi, `TaskRepository.createTask` mendeteksi duplikasi secara transparan dan mengembalikan child task yang sudah ada tanpa menduplikasi data atau me-reset progress yang berjalan.
- BullMQ enqueue menggunakan `jobId = task.id`, mencegah duplicate queue delivery pada tingkat broker pesan.

### 3. Batas Sumber Daya dan Rekursi Konservatif (VPS 2 OCPU / 12 GB)
- **Max Delegation Depth**: Default 1 (konfigurabel). Delegasi berantai tak terbatas (recursive spawning loop) dilarang keras.
- **Max Children per Parent**: Default 5 (konfigurabel). Mencegah ledakan jumlah task anak.
- **Max Concurrent Children**: Default 2 (konfigurabel). Disesuaikan dengan batas OCPU VPS agar tidak membebani host secara berlebihan.
- **Child Execution Timeout**: Default 15 menit per child.

### 4. Least Privilege & Isolasi Lingkungan
- **Tool / Capability Allowlist**: Child task hanya menerima daftar kapabilitas yang didefinisikan secara eksplisit di `capabilityAllowlist`.
- **Memory & Secret Hygiene**: Memori personal pemilik dan credentials/secrets tidak diteruskan ke child task.
- **Workspace Isolation**: Jika child task memiliki kapabilitas menulis ke filesystem (`fs:write`), child menerima direktori workspace terisolasi (misal branch git/worktree terpisah) untuk mencegah konflik concurrent write pada file yang sama.

### 5. Penanganan Kegagalan Parsial & Kaskade Pembatalan (Honest Status)
- Status parent mencerminkan kenyataan seluruh child:
  - Jika child yang wajib (`required: true`) gagal, parent tidak boleh berstatus `completed`.
  - Jika sebagian child berhasil dan sebagian gagal, status parent adalah `partial_failure` atau `failed`.
  - Jika parent dibatalkan (`cancelled`), orkestrator secara otomatis mengalirkan pembatalan (*cancellation cascade*) ke seluruh child task yang sedang aktif/queued.

### 6. Evaluasi Berbasis Bukti Nyata (Evaluator Gating)
- Ringkasan teks (`summary`) dari child task diperlakukan sebagai konten tidak tepercaya (*untrusted content*).
- Evaluator memverifikasi keberadaan artefak konkret (`TaskArtifact`) yang dihasilkan oleh child task terhadap `successCriteria` parent.
- Klaim sukses tanpa bukti artefak ditolak oleh Evaluator.

### 7. Kebijakan Penggabungan Kode (Merge Review Policy)
- Sesuai Aturan Mutlak 7 & 9, tindakan `git push` ke remote repository, merge ke branch `main`/`master`, atau deployment dilarang keras secara otomatis (`allowed: false`).
- Setiap merge memerlukan:
  1. Diff review yang tersedia dan bersih.
  2. Test dan lint lulus.
  3. Risk level `HIGH` dengan approval eksplisit dari user/pemilik sistem.

## Konsekuensi & Bukti
- **Durable & Resilient**: Child tasks bertahan terhadap restart worker dan dapat dilanjutkan tanpa split-brain.
- **Bounded Resources**: VPS 2 OCPU tidak mengalami kehabisan memori atau CPU throttling karena konkurensi terkontrol ketat.
- **Strict Verification**: Tidak ada "fake success" di mana model mengaku tugas selesai padahal artefak tidak terbentuk.
- **Keamanan Kode**: Repository aman dari auto-push atau kerusakan branch utama tanpa persetujuan.
