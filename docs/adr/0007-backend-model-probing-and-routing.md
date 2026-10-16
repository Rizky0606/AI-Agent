# ADR 0007: Probing Kapabilitas Model, Resolusi Preferensi, dan Kebijakan Routing Auto

Status: accepted  
Tanggal: 2026-10-15  
Penulis: Principal Software Architect / AI Systems Engineer

## Konteks

Pada implementasi awal (Sesi 1–4):
1. Provider model `9Router` (https://9router.ojixx.my.id/v1) bertindak sebagai gateway tunggal seluruh inferensi model AI di backend.
2. Kapabilitas model di-hardcode sebagai `['chat', 'streaming']` pada `packages/model-gateway/src/nine-router.ts` (baris 238), tanpa pernah memverifikasi secara nyata apakah model tersebut benar-benar mendukung streaming, tool calling, vision, atau context window yang diklaim.
3. Klien tidak memiliki visibilitas terhadap model mana yang akhirnya dieksekusi (`resolvedModel`) dan apakah terjadi fallback provider (`fallbackUsed`).
4. Preferensi model belum terintegrasi secara hierarkis (pesan vs percakapan vs preferensi pengguna vs mode Auto).
5. Terdapat risiko hardcoding nama model tertentu di jalur routing backend yang melanggar prinsip decoupling provider.

## Keputusan Arsitektural

### 1. Taksonomi dan Probing Kapabilitas (Least Cost & Safe)
- Kapabilitas model (`streaming`, `tool_calling`, `vision`, `context_window`) tidak diasumsikan `true`.
- Setiap kapabilitas dilacak dengan sumber/provenance:
  - `probed`: terbukti berfungsi melalui probe jaringan aktual dengan permintaan murah/minimal.
  - `declared`: dideklarasikan oleh metadata penyedia tanpa verifikasi langsung.
  - `unknown`: belum diuji atau gagal diverifikasi.
- **Aturan Tegas**: Kapabilitas yang gagal atau belum dibuktikan berstatus `unknown`, BUKAN `true`. Filter router hanya menganggap kapabilitas aktif jika berstatus `probed` (atau `declared` untuk chat dasar).
- Probe dilakukan dengan payload minimal:
  - `streaming`: permintaan 1 token dengan pembatalan stream seketika setelah chunk pertama diterima.
  - `tool_calling`: fungsi dummy kalkulator dengan parameter skema minimal.
  - `vision`: gambar PNG base64 ukuran 1x1 piksel dengan prompt ringkas.
  - `context_window`: dibaca dari metadata `/models` penyedia; tidak mengirim prompt besar untuk mencegah pemborosan kuota/biaya.

### 2. Batas Konkurensi dan Rate Limiting pada Refresh Katalog
- Endpoint `POST /v1/models/refresh` mengeksekusi probe dengan konkurensi terbatas (maksimum 2 request konkuren) dan jeda waktu aman antarmodel guna mencegah pembatasan laju (HTTP 429) dari 9Router.
- Hasil probe disimpan di tabel `model_configs` (`capability_details`, `last_latency_ms`, `last_verified_at`, `availability_status`).

### 3. Hierarki Resolusi Model (Resolution Hierarchy)
Resolusi model untuk setiap pesan pesan masuk berjalan dalam urutan prioritas ketat:
1. **Pilihan di Pesan (`message.model`)**: Jika pengguna/klien menentukan model secara eksplisit pada payload permintaan pesan.
2. **Pilihan di Percakapan (`conversation.model`)**: Jika percakapan memiliki konfigurasi model khusus yang tersimpan.
3. **Default Pengguna (`user.defaultModel`)**: Model default yang dikonfigurasi pada profil/preferensi pengguna.
4. **Kebijakan Mode Otomatis (`Auto Policy`)**: Jika tidak ada model eksplisit yang dipilih atau disetel ke mode otomatis.

### 4. Kebijakan Auto Mode Tanpa Hardcode Model
- Mode yang didukung: `fast`, `coding`, `complex`, `research`, dan `auto`.
- Resolusi mode Auto TIDAK PERNAH menulis nama model statis di kode.
- Resolusi dikonfigurasi melalui dua tingkat:
  1. Variabel lingkungan: `AUTO_MODEL_FAST`, `AUTO_MODEL_CODING`, `AUTO_MODEL_COMPLEX`, `AUTO_MODEL_RESEARCH`, `AUTO_MODEL_DEFAULT`.
  2. Tabel database: `model_routing_policies`.
  3. Fallback algoritmik berbasis kapabilitas terverifikasi:
     - `coding`: model aktif dengan kapabilitas `tool_calling` terverifikasi dan context window terbesar.
     - `research`: model aktif dengan context window terbesar dan `tool_calling`.
     - `fast`: model aktif dengan latensi terendah (`last_latency_ms`).
     - `complex`: model aktif dengan context window terbesar.
     - `auto` / umum: model aktif default/pertama yang tersedia.

### 5. Transparansi Metadata Eksekusi dan Penanganan Error
- Respons chat HTTP (`POST /v1/chat`) dan event WebSocket (`message.completed`) wajib menyertakan `resolvedModel`, `fallbackUsed`, dan `mode`.
- Standarisasi kode error dalam Bahasa Indonesia yang ramah:
  - `MODEL_NOT_AVAILABLE`: model yang dipilih tidak aktif atau tidak ditemukan.
  - `VISION_NOT_VERIFIED`: lampiran gambar dikirim tetapi belum ada model aktif dengan vision terverifikasi.
  - `NO_COMPATIBLE_MODEL`: tidak ada model aktif yang memenuhi kapasitas token atau kapabilitas yang diminta.

### 6. Audit Logging
- Perubahan preferensi model pengguna (`user.preference.updated`), perubahan preferensi percakapan (`conversation.model.updated`), dan eksekusi refresh katalog (`model_catalog.refreshed`) dicatat ke `audit_logs`.

## Konsekuensi

- **Positif**:
  - Menghilangkan asumsi salah atas kapabilitas model di backend.
  - Memberikan transparansi penuh kepada pengguna mengenai model aktual yang merespons.
  - Fleksibilitas konfigurasi model tanpa perlu redeploy atau modifikasi kode sumber.
  - Perlindungan terhadap kuota dan stabilitas gateway provider dengan probe terkontrol.
- **Keterbatasan / Mitigasi**:
  - Panggilan `POST /v1/models/refresh` membutuhkan waktu beberapa detik karena adanya batas konkurensi (dijalankan secara asinkron atau timeout terkontrol).
  - Jika 9Router belum mengaktifkan vision pada model tertentu, sistem menolak lampiran gambar secara jujur dengan pesan edukatif ke pengguna.
