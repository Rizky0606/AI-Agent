# ADR 0014: Integrasi Hermes, Pemilih Runtime (Runtime Picker), dan Kebijakan Routing Runtime Multisaluran

**Status**: Diterima (Accepted)  
**Tanggal**: 16 Oktober 2026 (Sesi 13)  
**Pengambil Keputusan**: Principal Software Architect, AI Agent Systems Engineer, Security Engineer  
**Konteks**: Sesi 13 — Integrasi Hermes dan Runtime Picker  

---

## 1. Konteks & Masalah

*Personal AI OS* saat ini memiliki dua runtime eksternal yang terpasang di host VPS Oracle Cloud ARM64:
1. **OMP (v18.6.1)**: Mesin koding otonom dan inspeksi repositori dengan sesi persisten dan streaming event JSONL (diselesaikan di Sesi 12).
2. **Hermes (v0.20.5)**: Agen otomasi tugas umum, eksekusi skrip/skill, dan gateway perpesanan yang telah terhubung ke akun Telegram pemilik di host VPS.
3. **Runtime Bawaan (Native Worker)**: Agen generik internal TypeScript yang terhubung langsung ke gateway model 9Router, `ToolRegistry`, dan `SecuredCapabilityGuard`.

Sebelumnya, pemilihan runtime masih bersifat statis (bergantung pada `RUNTIME_PREFERRED=omp` atau deklarasi eksplisit `task.payload.useRuntime`) tanpa mekanisme routing adaptif berdasarkan intensi tugas (*intent-based policy*), tanpa pemilih visual (*runtime picker chip*) di composer klien, dan belum mengekspos status kesehatan runtime dalam bahasa awam.

Selain itu:
- Hermes memiliki direktori skill bawaan yang bernilai tinggi namun belum dapat diinspeksi oleh pengguna dari aplikasi.
- Hermes sudah terhubung ke Telegram pemilik, sehingga dilarang membuat bot kedua yang dapat memecah perhatian atau membingungkan otentikasi.
- Jika suatu runtime mengalami gangguan kesehatan (misalnya bridge offline atau proses crash), sistem tidak boleh beralih secara diam-diam (*silent fallback*), melainkan harus mencatat fallback secara eksplisit ke dalam event task dan memberi tahu pengguna.

---

## 2. Keputusan Arsitektur

### 2.1 Kebijakan Routing Runtime Multisaluran
Routing runtime dievaluasi melalui matriks kebijakan berbasis intensi (`AgentRouter` & `IntentAnalyzer`):
- **Tugas Koding / Manipulasi Repositori** (`coding`): Diarahkan ke runtime `omp`.
- **Tugas Otomasi, Eksekusi Skill, dan Alur Kerja Umum** (`automation`, `skill`, `workflow`, `general`): Diarahkan ke runtime `hermes`.
- **Percakapan Singkat / Tugas Sederhana** (`simple_chat`, `fast`): Diarahkan ke runtime `native` (Bawaan worker) untuk menghemat sumber daya host.
- **Mode Auto**: Menilai intensi secara algoritmik dari prompt dan kata kunci pengguna, kemudian memilih antara `omp`, `hermes`, atau `native`.

### 2.2 Penimpaan Manual via Chip Runtime (Runtime Picker)
Pengguna memiliki kedaulatan penuh untuk menimpa hasil routing otomatis melalui **Chip Runtime** di composer Windows (`ChatComposer.tsx`) dan Android (`ChatScreen.tsx`):
- `Auto`: Menjalankan pemilihan otomatis berbasis kebijakan.
- `omp`: Memaksa eksekusi menggunakan mesin koding OMP.
- `Hermes`: Memaksa eksekusi menggunakan Hermes.
- `Bawaan` (`native`): Memaksa eksekusi melalui runtime internal worker tanpa melibatkan bridge host.

Nilai runtime yang dipilih disimpan per percakapan dan diteruskan dalam payload task (`payload.runtime`).

### 2.3 Pelaporan Status Kesehatan dalam Bahasa Awam
Backend mengekspos endpoint `GET /v1/runtimes` yang merangkum kesehatan seluruh runtime terdaftar (`healthCheckAll`) dan memetakannya ke dalam istilah awam bahasa Indonesia yang informatif:
- `omp`: *"OMP Coding Engine"* — *"Siap untuk koding, analisis berkas, dan refactor"* (atau *"Koneksi bridge terputus"* jika offline).
- `hermes`: *"Hermes Agent"* — *"Siap untuk otomasi tugas, skill, dan integrasi pesan"* (atau *"Koneksi bridge terputus"* jika offline).
- `native`: *"Runtime Bawaan"* — *"Aktif (Internal Worker siap mengeksekusi tools)"*.

Setiap task yang dieksekusi mencatat runtime yang digunakan beserta status kesehatannya pada event `task.started` dan tampilan timeline klien.

### 2.4 Jalur Hermes: Skill Read-Only, Sanitasi Output, & Batas Memori
1. **Daftar Skill Read-Only**: Daftar skill yang dideklarasikan oleh Hermes diekspos melalui API `/v1/skills` dan `/v1/catalog` dengan atribut `source: 'hermes'` dan `isReadOnly: true`. Pengguna dapat meninjau deskripsi dan parameter skill Hermes di antarmuka pengaturan klien tanpa risiko modifikasi tanpa izin.
2. **Sanitasi Output**: Seluruh teks atau hasil yang dikembalikan oleh Hermes diperlakukan sebagai **konten tidak tepercaya** (`untrusted content`) dan dibungkus dalam tag `<untrusted_content>` guna mencegah *prompt injection*.
3. **Pemanfaatan Memori**: Sinkronisasi atau pembacaan memori dari Hermes harus melalui antrean usulan (*proposal queue*) dengan filter data sensitif (`SensitiveDataFilter`). Tidak ada secret atau memori yang disalin secara diam-diam (*zero silent storage*).

### 2.5 Batas Keamanan Telegram & Notifikasi Deep Link
1. **Larangan Bot Kedua**: Sistem tidak membuat bot Telegram kedua. Integrasi perpesanan Telegram yang ada pada Hermes tetap menjadi saluran notifikasi.
2. **Deep Link Wajib**: Setiap pesan notifikasi yang dikirimkan menyertakan tautan langsung (*deep link*) ke aplikasi:
   - Persetujuan: `personal-ai://approvals/{approvalId}`
   - Detail Tugas: `personal-ai://tasks/{taskId}`
3. **Isolasi Keputusan Berisiko (HIGH/CRITICAL)**: Aksi berisiko `HIGH` atau `CRITICAL` **dilarang keras** disetujui hanya melalui balasan pesan teks Telegram biasa. Pengguna wajib mengklik deep link untuk membuka aplikasi (Windows/Android), melakukan autentikasi dengan sesi terverifikasi (Bearer token JWT), dan menyetujui melalui dialog konfirmasi sekunder.

### 2.6 Fallback Eksplisit dan Transparan
Jika runtime yang ditargetkan atau dipilih pengguna tidak sehat (`health.healthy === false`):
1. Sistem memilih runtime alternatif yang sehat sesuai kapabilitas yang kompatibel.
2. Beralih secara transparan: mencatat `runtimeFallback: true`, `originalRuntimeId`, dan `fallbackReason` (dalam bahasa Indonesia) ke dalam payload event `task.started` dan `task.progress`.
3. Klien menampilkan banner pemberitahuan fallback pada kartu task di Aktivitas, memastikan pengguna selalu mengetahui runtime mana yang sebenarnya mengeksekusi instruksi mereka.

---

## 3. Konsekuensi

### Positif
- Fleksibilitas tinggi: pengguna dapat memilih runtime terbaik untuk setiap tipe pekerjaan (koding vs otomasi).
- Kedaulatan pengguna terjaga dengan adanya pemilih visual dan status kesehatan yang transparan.
- Keamanan terjamin: aksi berbahaya tetap membutuhkan verifikasi aplikasi otentik, output runtime selalu disanitisasi, dan tidak ada secret yang bocor.
- Ketahanan sistem: kegagalan salah satu runtime di host tidak melumpuhkan seluruh platform berkat fallback otomatis yang jujur.

### Batasan
- Hermes CLI dipanggil melalui `-z` (mode teks aman) sesuai jalur terverifikasi ADR 0004.
- Sinkronisasi skill dinamis Hermes dari VPS bergantung pada ketersediaan runtime bridge.
