# ADR 0043: Integrasi Perpesanan Telegram, Pemisahan Mode Dual, Adapter Channel, dan Penegakan Persetujuan Berbasis Deep Link

## Status
Accepted

## Konteks
Personal AI OS memerlukan saluran komunikasi perpesanan (*messaging channel*) yang memungkinkan asisten memberikan pembaruan operasional, ringkasan tugas terjadwal, notifikasi persetujuan (*approval notifications*), serta interaksi instruksi tugas di masa depan melalui Telegram.

Namun, pengoperasian bot Telegram pada ekosistem Personal AI OS menghadapi batasan arsitektur dan keamanan yang sangat ketat:
1. **Larangan Bot Kedua & Larangan Duplikasi Kredensial**: Host VPS telah menjalankan Hermes yang terhubung ke bot Telegram pemilik. Sesuai aturan mutlak repository (`AGENTS.md`, ADR 0014, ADR 0018, ADR 0034, dan ADR 0041), dilarang membuat bot Telegram kedua yang dapat membingungkan otentikasi atau memecah perhatian pengguna.
2. **Keterbatasan Protokol Telegram Bot API**: Telegram Bot API melarang penggunaan beberapa consumer konkuren pada bot token yang sama. Menjalankan *long-polling* (`getUpdates`) atau memasang webhook saat polling lain aktif memicu kesalahan `HTTP 409 Conflict: terminated by other getUpdates request`.
3. **Ketiadaan API Integrasi Gateway Hermes**: Hasil probe empiris read-only (ADR 0035) membuktikan bahwa daemon Hermes di port 9119 hanya menyediakan dashboard pemantauan internal dan manajemen file; port tersebut tidak memiliki endpoint forwarder webhook atau eksekusi prompt yang aman dan terotentikasi.
4. **Risiko Keamanan Persetujuan Berisiko Tinggi (HIGH/CRITICAL)**: Membiarkan aksi berbahaya (seperti eksekusi terminal host, modifikasi konfigurasi, push git, atau manipulasi data) disetujui hanya dengan pesan teks biasa ("approve", "setujui", "yes") di Telegram rentan terhadap pembajakan sesi, serangan *prompt injection*, dan ketidaksengajaan.
5. **Risiko Serangan Pesan Eksternal**: Serangan *replay update*, spamming pesan berukuran masif, pengiriman lampiran berbahaya, dan spoofing chat ID.

---

## Keputusan Arsitektur

### 1. Arsitektur Dual Mode yang Transparan
Sistem menetapkan arsitektur dua mode untuk integrasi Telegram:
- **Mode 1: `notification-only` (Default & Aktif)**:
  - Saluran Telegram difokuskan untuk pesan keluar (*outbound notifications*): alerting kesehatan VPS, ringkasan tugas terjadwal (*scheduled task briefs*), dan permintaan persetujuan dengan tautan mendalam (*deep link*).
  - Mode ini aman, tidak bersaing mengonsumsi update dengan Hermes, dan tidak memerlukan webhook inbound.
- **Mode 2: `interactive-chat` (Terdokumentasi & Terblokir Sementara)**:
  - Karena kontrak integrasi/delegasi pesan inbound dari Hermes belum terverifikasi secara empiris di host, mode interaktif live dinyatakan **BLOCKED** secara jujur pada status API (`/v1/channels/telegram/status`).
  - Sistem tidak membuat mock tipuan atau adapter palsu di lingkungan live.

### 2. Adapter Channel Telegram Terstandarisasi (`TelegramChannelAdapter`)
Meskipun mode interaktif live ditangguhkan hingga tersedia kontrak gateway yang terverifikasi, backend Personal AI OS mengimplementasikan arsitektur `TelegramChannelAdapter` yang lengkap, deterministik, dan teruji:
- **Proteksi Replay & Deduplikasi**: Menyimpan antrean `update_id` (maksimal 10.000 entri) untuk memastikan setiap update dari Telegram hanya diproses tepat satu kali.
- **Validasi Secret Header**: Memvalidasi header `X-Telegram-Bot-Api-Secret-Token` pada webhook inbound. Permintaan tanpa secret token yang cocok ditolak dengan HTTP 403 Forbidden.
- **Batas Ukuran Pesan (Oversized Guard)**: Pesan dengan panjang melebihi batas (default 4.096 karakter) ditolak secara aman dengan pesan peringatan kepada pengirim.
- **Batas Frekuensi (Rate Limiting)**: Menerapkan batas maksimal 10 pesan per menit per `chat_id` guna mencegah kehabisan sumber daya server (*rate limiting exhaustion*).
- **Isolasi Konten Tidak Tepercaya**: Seluruh teks atau lampiran dari Telegram diperlakukan sebagai konten tidak tepercaya (*untrusted content*) sebelum diproses oleh model atau Agent Core.

### 3. Mekanisme Pairing Dinamis & Allowlist Ketat (`TelegramPairingManager`)
- **Penolakan Chat Tidak Terdaftar**: Setiap pesan dari `chat_id` yang belum terdaftar atau belum dipasangkan secara tegas ditolak. Sistem merespons dengan instruksi pembuatan kode pairing di aplikasi resmi.
- **Siklus Pairing Berbatas Waktu**:
  1. Pengguna login ke aplikasi Personal AI OS (Windows atau Android) dan meminta kode pairing via `POST /v1/channels/telegram/pairing/generate`.
  2. Sistem menghasilkan kode alfanumerik sekali pakai (misal `PAIR-A1B2C3`) dengan masa berlaku (TTL) 10 menit.
  3. Pengguna mengirimkan perintah `/pair <KODE>` di chat Telegram.
  4. Sistem memverifikasi kode, menautkan `channelChatId` dengan `userId`, mencatat ke tabel persisten `channel_pairings`, dan menghanguskan kode pairing tersebut.
- **Pencabutan Akses (Revocation)**: Pengguna dapat mencabut penautan kapan saja melalui perintah `/unpair` di chat atau endpoint `POST /v1/channels/telegram/pairing/revoke` di aplikasi.

### 4. Penegakan Mutlak Kebijakan Persetujuan (Zero Plain-Text Approval)
- **Larangan Teks Bebas**: Pesan teks yang berisi kata-kata persetujuan (seperti *"approve"*, *"setujui"*, *"yes"*, *"ya"*, *"confirm"*, *"izinkan"*, *"acc"*) **dilarang keras memicu persetujuan tindakan**.
- **Respon Penolakan Keamanan**: Sistem secara otomatis mendeteksi upaya tersebut dan membalas dengan peringatan kebijakan keamanan:
  > *"🚨 Persetujuan Ditolak (Kebijakan Keamanan): Tindakan berisiko tinggi (HIGH atau CRITICAL) dilarang keras disetujui hanya melalui pesan teks Telegram biasa demi mencegah penyalahgunaan. Silakan buka aplikasi resmi Personal AI OS melalui tautan persetujuan mendalam (deep link): personal-ai://approvals untuk memverifikasi autentikasi dan memberikan konfirmasi sekunder."*
- **Deep Link Terotentikasi**: Notifikasi persetujuan yang dikirim ke Telegram wajib menyertakan deep link terformat: `personal-ai://approvals/{approvalId}`.

### 5. Status API Jujur & Pelaporan Terbuka
- Endpoint `GET /v1/channels/telegram/status` mengekspos konfigurasi, mode aktif, jumlah chat tertaut, dan status blocker:
  ```json
  {
    "channel": "telegram",
    "configured": true,
    "mode": "notification-only",
    "botConfigured": true,
    "interactiveChatBlocked": true,
    "interactiveChatBlockedReason": "Integrasi interaktif dibatasi: gateway Hermes tidak memiliki API integrasi terverifikasi dan polling simultan pada satu bot token dilarang.",
    "pairedChatsCount": 1,
    "features": {
      "outboundAlerts": true,
      "approvalDeepLinks": true,
      "interactiveCommands": false,
      "inboundAgentExecution": false
    }
  }
  ```

### 6. Pembatasan Kanal Perpesanan Lain
Sesuai arahan Target 10 Sesi 11: kanal WhatsApp, Discord, Slack, Signal, dan Email **TIDAK DIAKTIFKAN** pada sesi ini hingga masing-masing provider, persetujuan pengguna (*consent*), mekanisme otentikasi, dan model ancaman (*threat model*) dinilai secara independen.

---

## Konsekuensi & Dampak
1. **Keamanan Maksimal**: Mencegah celah pembajakan persetujuan aksi HIGH/CRITICAL via Telegram chat dan mengamankan server dari replay update serta spam.
2. **Tanpa Konflik Host**: Menjamin tidak ada konflik 409 pada Telegram Bot API antara bot alerting Personal AI OS dan Hermes di VPS.
3. **Integritas Konfigurasi**: Status UI dan API selalu mencerminkan kenyataan runtime tanpa menyembunyikan status blocker.
4. **Skema Database**: Menambahkan tabel `channel_pairings` pada Drizzle schema untuk pencatatan pairing multi-kanal yang aman.
