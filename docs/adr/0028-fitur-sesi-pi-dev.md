# 0028. Fitur Sesi Native Ala Pi.dev (Pohon Pesan, Ekspor Markdown/HTML, Prompt Template, Antrean, dan Kompaksi Konteks)

- **Status**: Diterima
- **Tanggal**: 2026-10-17
- **Pengambil Keputusan**: Principal Software Architect, Senior Full-Stack Engineer, Security Engineer
- **Area**: Backend (`apps/api`, `packages/memory`), Shared (`packages/shared`), Frontend (`apps/windows`, `apps/android`)

---

## 1. Konteks dan Kebutuhan

Dalam ekosistem AI coding dan chat asisten modern (seperti yang diverifikasi pada pi.dev), pengguna memerlukan kemampuan navigasi dan manipulasi sesi percakapan tingkat lanjut:
1. **Percabangan Percakapan (Message Tree / Branching)**: Sering kali pengguna ingin mengedit pertanyaan sebelumnya atau mengulangi jawaban asisten tanpa menghapus riwayat jawaban lain. Model pesan linear tidak mampu menangani cabang eksplorasi alternatif. Diperlukan model data berbentuk pohon (tree) yang mendukung rewind, edit pesan pengguna, dan regenerasi asisten sebagai cabang baru yang dapat dinavigasi bolak-balik.
2. **Ekspor Percakapan Mandiri**: Pengguna ingin menyimpan atau mendokumentasikan percakapan ke format Markdown dan berkas HTML mandiri (*standalone HTML*) yang dapat dibuka di peramban apa pun tanpa dependensi CDN eksternal, tanpa token/secret bocor, dan tersanitasi dari injeksi skrip.
3. **Prompt Template Tersimpan**: Pengguna sering menggunakan pola prompt berulang (misal: review kode, ringkasan rapat, translasi). Diperlukan fitur pembuatan template prompt per-pengguna yang dapat dipanggil langsung dari kotak input pesan menggunakan tanda garis miring (`/nama-template`) dengan variabel sederhana `{{nama_variabel}}`.
4. **Antrean Pesan Saat Agen Sibuk**: Ketika asisten sedang melakukan inferensi atau eksekusi perintah bertahap, pengguna tidak boleh diblokir untuk mengetik dan menekan kirim. Tombol kirim bertransformasi menjadi "Antre" (*Queue*), dan pesan secara otomatis dieksekusi segera setelah asisten menyelesaikan giliran aktifnya. (Catatan: Fitur *Steering* / menyisipkan pesan ke run yang sedang berjalan ditangguhkan hingga Sesi 29 saat kemampuan runtime diverifikasi lewat probe).
5. **Kompaksi Konteks Otomatis**: Percakapan panjang dapat mendekati batas jendela konteks model. Sistem harus mampu merangkum riwayat lama secara otomatis ketika mendekati ambang batas token, sambil mempertahankan instruksi sistem dan memori ter-pin secara utuh 100%, serta menampilkan penanda transparan dengan tombol untuk melihat pesan asli.
6. **Siklus Model Favorit Cepat**: Pintasan keyboard pada antarmuka Windows untuk beralih antar model favorit tanpa harus membuka popover model.

---

## 2. Batasan Keamanan & Hal yang Ditolak (Security Guardrails)

Sesuai aturan keamanan repositori Personal AI OS dan AGENTS.md:
1. **Ditolak**: Pemuatan modul eksternal dinamis/arbitrer dari git/npm (ala Pi packages). Seluruh fungsionalitas diimplementasikan secara native dalam repositori dengan TypeScript strict.
2. **Ditolak**: Tombol *Steer / Arahkan* di antarmuka sebelum kemampuan runtime diuji secara nyata pada Sesi 29.
3. **Ditolak**: Fitur bagikan percakapan ke layanan pihak ketiga eksternal (cloud pastebin / external share). Ekspor hanya disimpan secara lokal oleh pengguna.
4. **Sanitasi Total Ekspor**: HTML ekspor wajib menggunakan escaping entitas HTML (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`), menghapus tag skrip, stylesheet inline dari sumber tak tepercaya, serta menyaring token, secret, dan kredensial.

---

## 3. Keputusan Arsitektur & Desain

### A. Model Data Pohon Pesan (Message Tree Hierarchy)
- **Skema `messages`**:
  - Kolom baru: `parent_message_id UUID REFERENCES messages(id) ON DELETE CASCADE`.
  - Kolom baru: `is_active_branch BOOLEAN NOT NULL DEFAULT true`.
  - Kolom baru: `branch_index INTEGER NOT NULL DEFAULT 0`.
  - Indeks relasional: `idx_messages_parent ON (conversation_id, parent_message_id)` dan `idx_messages_active ON (conversation_id, is_active_branch)`.
- **Migrasi & Backfill Aman (0017_session_tree_and_templates.sql)**:
  - Pesan yang sudah ada dibackfill secara linier menggunakan window function SQL (`LAG(id) OVER (PARTITION BY conversation_id ORDER BY created_at ASC)`), sehingga data masa lalu langsung memiliki struktur pohon linear yang valid tanpa ada data rusak atau hilang.
- **Logika Percabangan (Branching Semantics)**:
  - Mengedit pesan pengguna yang sudah terkirim: Membuat pesan `user` baru dengan `parent_message_id` yang sama dengan pesan yang diedit, menandainya sebagai `is_active_branch = true`, dan menonaktifkan cabang saudara untuk traversal tampilan aktif.
  - Mengulangi respons asisten: Membuat pesan `assistant` baru dengan `parent_message_id` merujuk ke pesan pengguna pemantiknya.
  - Pergantian Cabang: Endpoint `POST /v1/conversations/:conversationId/messages/:messageId/switch` mengaktifkan cabang yang memuat `messageId` dari akar hingga daun.

### B. Ekspor Percakapan (Markdown & HTML Standalone)
- Endpoint:
  - `GET /v1/conversations/:conversationId/export?format=markdown`
  - `GET /v1/conversations/:conversationId/export?format=html`
- **Markdown**: Menyusun percakapan cabang aktif dengan metadata sesi, judul, model, stempel waktu, dan format GitHub-Flavored Markdown.
- **Standalone HTML**:
  - Berkas tunggal mandiri tanpa koneksi internet atau CDN eksternal.
  - Memuat stylesheet minimalis berbasis CSS variables bertema gelap dan terang (`@media (prefers-color-scheme)`).
  - Sanitasi karakter HTML penuh untuk menangkal XSS.

### C. Prompt Templates Per-Pengguna
- Skema tabel `prompt_templates`:
  - `id` (UUID, PK)
  - `user_id` (UUID, FK `users.id`)
  - `name` (VARCHAR(100), unik per pengguna, dipanggil via `/nama`)
  - `title` (VARCHAR(200))
  - `content` (TEXT, mendukung sintaks `{{variabel}}`)
  - `variables` (JSONB, array nama variabel)
  - `created_at`, `updated_at`
- Autocomplete di Composer:
  - Saat pengguna mengetik karakter `/` di awal kata dalam textarea, antarmuka memunculkan popover autocomplete berisi daftar template. Memilih template menyisipkan teks atau membuka prompt pengisian variabel cepat jika mengandung `{{variabel}}`.

### D. Antrean Pesan Saat Agen Berjalan
- State `chatStreaming` atau `activeTaskRunning` mengubah tombol kirim di antarmuka menjadi "Antre".
- Pesan yang dimasukkan saat agen sibuk masuk ke antrean lokal klien (`messageQueue`).
- Setelah streaming/task saat ini selesai (`onFinish`), pesan teratas di antrean otomatis dikirim ke server tanpa aksi manual dari pengguna. Pengguna dapat membatalkan atau mengedit pesan yang sedang mengantre.

### E. Kompaksi Konteks Otomatis & Penanda Transparan
- Ambang batas kompaksi: default 75% dari batas jendela konteks model (dapat dikonfigurasi).
- Kompaksi mengekstrak pesan-pesan masa lalu dan membuat ringkasan faktual menggunakan Model Gateway atau algoritma penataan ringkasan, lalu menyimpannya di kolom `compacted_summary` tabel `conversations`.
- Pesan asli di basis data tetap dipertahankan (tidak dihapus).
- Pada antarmuka, penanda visual *"Konteks Terdahulu Diringkas"* ditampilkan dengan tombol akordeon *"Lihat Pesan Asli"*.
- `ContextManager` menjamin instruksi sistem dan memori ter-pin tetap 100% utuh dalam konteks rakitan.

### F. Siklus Model Favorit di Windows
- Pintasan keyboard `Ctrl+M` (atau `Alt+M`) mendeteksi model favorit yang telah dipilih pengguna pada Sesi 6 (`favoriteModels`), dan berpindah ke model favorit berikutnya secara melingkar (*carousel*), menampilkan toast singkat perubahan model.

---

## 4. Konsekuensi & Evaluasi
- **Positif**: Eksplorasi alternatif jawaban menjadi sangat fleksibel dan aman; pengguna tidak takut kehilangan konteks bagus saat mencoba variasi prompt; template mempercepat alur kerja harian; ekspor memudahkan dokumentasi offline.
- **Terkendali**: Eksekusi tree traversal dirancang efisien dengan indeks basis data; sanitasi HTML mencegah celah keamanan pada ekspor; integritas kebijakan keamanan context manager tetap terjaga tanpa kompromi.
