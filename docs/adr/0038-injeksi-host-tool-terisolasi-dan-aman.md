# ADR 0038: Injeksi Host-Tool Terisolasi dan Aman Menggunakan Model Context Protocol (MCP)

## Status
Diterima & Diimplementasikan (Accepted & Verified) - 19 Oktober 2026

## Konteks
Pada arsitektur Personal AI OS, agen yang dieksekusi di dalam runtime eksternal (seperti OMP dan Pi) memerlukan akses terkontrol ke kapabilitas host (pembacaan file workspace, pencarian web aman, pengambilan web dengan proteksi SSRF, memori percakapan terkurasi, penyimpanan artefak, dan perintah sistem berisiko tinggi).

Sesuai aturan mutlak `AGENTS.md` dan batasan Sesi 6:
1. Tidak boleh mengasumsikan metode RPC vendor yang tidak terbukti (misal metode fiktif `set_host_tools`).
2. Tidak boleh membuka port publik/lokal baru yang memperluas bidang serangan jaringan.
3. Semua pemanggilan tool wajib melewati `ToolRegistry` dan `SecuredCapabilityGuard` yang sudah ada (tidak membuat registry kedua).
4. Tindakan berisiko HIGH/CRITICAL wajib berhenti pada `waiting_approval` tanpa menimbulkan efek samping sebelumnya.
5. Kredensial host (seperti file `.env` atau credential store) dilarang keras dapat dibaca oleh runtime.
6. Seluruh keluaran runtime dan tool wajib diperlakukan sebagai data tidak tepercaya (*untrusted payload*).

---

## 1. Analisis Protokol Runtime & Pemilihan Transport

### 1.1 Temuan Investigasi Runtime
Berdasarkan probe empiris pada binary dan konfigurasi runtime:
- **OMP RPC stdio**: Perintah yang dipublikasikan dalam `available_commands_update` (`model`, `switch`, `prompt`, `abort`, `get_state`, `steer`, `follow_up`, `clear_queue`, `todo`, `mcp`) **tidak** menyediakan RPC command untuk registrasi tool dinamis seperti `set_host_tools`.
- **OMP MCP Integration**: OMP v18.8.4 secara bawaan mengaktifkan konfigurasi `"mcp.enableProjectConfig": true` (Load `.mcp.json`/`mcp.json` from project root). Uji empiris probe membuktikan bahwa saat `.mcp.json` hadir di direktori kerja (workspace), OMP secara otomatis mengeksekusi server MCP stdio lokal, melakukan handshake JSON-RPC 2.0 (`initialize`, `notifications/initialized`), dan meminta daftar tool (`tools/list`).
- **Pi (`@earendil-works/pi-coding-agent`)**: Berbagi basis kode yang sama dengan OMP dan mendukung konfigurasi `.mcp.json` yang identik.
- **Hermes**: Menggunakan runtime Python terisolasi dan tidak mendukung konfigurasi `.mcp.json`. Hermes hanya menyediakan skills internal baca (`GET /v1/runtimes/hermes/skills`).

### 1.2 Keputusan Pemilihan Transport
Transport yang dipilih adalah **MCP over Local Stdio Process via Workspace Injection (`.mcp.json`)**.
**Alasan Pemilihan**:
1. **Zero Network Exposure**: Tidak ada port TCP/IP baru yang dibuka di host VPS maupun Windows (100% bebas dari risiko port scanning dan eksfiltrasi jaringan).
2. **Native & Empirically Proven**: Didukung secara native oleh OMP v18.8.4 dan Pi tanpa perlu memodifikasi binary vendor atau memasang plugin pihak ketiga.
3. **Session & Workspace Containment**: Konfigurasi `.mcp.json` diinjeksi secara eksklusif ke dalam direktori workspace tugas (`workspaceDir`) dengan mode izin `0o600` dan dihapus saat eksekusi tugas berakhir.
4. **Non-Forgeable Identity Binding**: Host tool server dijalankan dengan konteks aktor (`userId`, `role`, `workspaceDir`) yang diikat secara permanen pada level proses host. Argumen dari runtime eksternal tidak dapat memalsukan identitas pengguna atau hak akses.

---

## 2. Arsitektur Komponen

```
+--------------------------------------------------------------------------+
|                            Workspace Sandbox                             |
|                                                                          |
|   +-----------------------+              +---------------------------+   |
|   |   OMP / Pi Runtime    |              |         .mcp.json         |   |
|   | (MCP Client over TTY) |              | (Izin 0o600, Mode Stdio)  |   |
|   +-----------+-----------+              +-------------+-------------+   |
|               |                                        |                 |
|               | spawns via stdio JSON-RPC 2.0          |                 |
|               v                                        v                 |
|   +------------------------------------------------------------------+   |
|   |                HostToolMcpServer (@personal-ai-os/mcp)           |   |
|   |  - Line buffer berbatas (128 KB) & pencegahan OOM                |   |
|   |  - Validasi schema ketat (kedalaman JSON <= 5, string <= 16 KB)  |   |
|   |  - Deteksi prototype pollution (__proto__, constructor)          |   |
|   |  - Bound ActorContext (identitas tidak dapat dipalsukan)         |   |
|   +---------------------------------+--------------------------------+   |
+-------------------------------------|------------------------------------+
                                      |
                                      v
+--------------------------------------------------------------------------+
|                     Personal AI OS Host Control Plane                    |
|                                                                          |
|   +------------------------------------------------------------------+   |
|   |             SecuredCapabilityGuard (@personal-ai-os/permissions) |   |
|   |  - Evaluasi PermissionEngine                                     |   |
|   |  - LOW/MEDIUM: Eksekusi berizin                                  |   |
|   |  - HIGH/CRITICAL: Berhenti di waiting_approval (Zero Side Effects)|   |
|   |  - Pencatatan Audit Trail lengkap (aktor, durasi, status)        |   |
|   +---------------------------------+--------------------------------+   |
|                                     |                                    |
|                                     v                                    |
|   +------------------------------------------------------------------+   |
|   |                 ToolRegistry (@personal-ai-os/tools)             |   |
|   |  +-------------------------+     +----------------------------+  |   |
|   |  | workspace_read_file     |     | web_fetch                  |  |   |
|   |  | (Blokir .env & kredensial)     | (Proteksi SSRF Egress)     |  |   |
|   |  +-------------------------+     +----------------------------+  |   |
|   |  | memory_recall           |     | save_artifact              |  |   |
|   |  | (Filter data sensitif)  |     | (Storage kuota aman)       |  |   |
|   |  +-------------------------+     +----------------------------+  |   |
|   |  | host_execute_command    |                                     |   |
|   |  | (HIGH: Wajib Approval)  |                                     |   |
|   |  +-------------------------+                                     |   |
|   +---------------------------------+--------------------------------+   |
|                                     |                                    |
|                                     v                                    |
|   +------------------------------------------------------------------+   |
|   |             UntrustedSanitizer (sanitizeMcpOutput)               |   |
|   |  - Redaksi secret: [REDACTED_SECRET]                             |   |
|   |  - Escape tag penutup: &lt;/untrusted_content&gt;                |   |
|   |  - Pembungkus: <untrusted_content is_instruction="false">        |   |
|   +------------------------------------------------------------------+   |
+--------------------------------------------------------------------------+
```

---

## 3. Kebijakan Keamanan dan Penolakan Serangan

1. **Pencegahan Pemalsuan Identitas (Actor Spoofing)**:
   - External runtime sering mencoba mengirimkan argumen seperti `_actor`, `userId`, atau `role: admin`.
   - `HostToolMcpServer` mengabaikan seluruh atribut aktor yang dikirimkan dalam argumen dan hanya menggunakan `this.options.actor` yang telah diverifikasi oleh host bridge.
2. **Pencegahan Prototype Pollution & DoS**:
   - Fungsi `validateInputPayload()` memeriksa `Object.getPrototypeOf(value)` dan `Object.getOwnPropertyNames(value)`.
   - Properti berbahaya seperti `__proto__`, `constructor`, atau `prototype` langsung ditolak dengan status `validation_error`.
   - Kedalaman struktur JSON dibatasi maksimal 5 tingkat dan panjang string argumen dibatasi maksimal 16.384 karakter.
3. **Pencegahan Kebocoran Kredensial Host**:
   - `workspace_read_file` secara eksplisit memeriksa nama file dasar: akses ke `.env`, `.env.*`, `*secret*`, `*credential*`, `*id_rsa*`, dan `*id_ed25519*` ditolak seketika.
   - `memory_recall` memfilter memori masa lalu menggunakan pola `SENSITIVE_PATTERNS` untuk mereduksi token API, kunci privat, dan password sebelum dikembalikan ke agen.
4. **Pencegahan SSRF (Server-Side Request Forgery)**:
   - `web_fetch` memvalidasi URL tujuan menggunakan `SSRFGuard`, memblokir loopback (`127.0.0.1`, `localhost`), IP privat RFC1918 (`10.0.0.0/8`, `192.168.0.0/16`, `172.16.0.0/12`), serta metadata cloud provider (`169.254.169.254`).
5. **Penanganan Approval HIGH/CRITICAL Tanpa Efek Samping**:
   - Pemanggilan tool berisiko tinggi tanpa persetujuan memicu `ApprovalRequiredError` dari `SecuredCapabilityGuard`.
   - `HostToolMcpServer` menangkap error ini dan mengembalikan status `waiting_approval` disertai `approvalId` (fingerprint unik).
   - Fungsi eksekusi perintah **sama sekali tidak dijalankan**. Tidak ada efek samping parsial yang tertinggal.
6. **Untrusted Instruction Boundary**:
   - Seluruh keluaran tool dibungkus dalam tag `<untrusted_content source="mcp:host-tools/..." is_instruction="false">`.
   - Serangan prompt injection yang mencoba menyuntikkan tag penutup dipatahkan dengan meng-escape `</untrusted_content>` menjadi `&lt;/untrusted_content&gt;`.

---

## 4. Bukti Uji Empiris & Hasil Verifikasi

Semua acceptance criteria diuji menggunakan unit test, negative security test, dan live binary probe pada host Windows:

| Pengujian | Skenario | Hasil Aktual |
|---|---|---|
| **Protocol Handshake** | JSON-RPC 2.0 `initialize`, `ping`, dan `tools/list` | **PASS** (11.09 ms) |
| **Allowed Tool Call** | Eksekusi tool valid menghasilkan output yang dibungkus tag untrusted | **PASS** (13.03 ms) |
| **Unknown Tool** | Pemanggilan nama tool tidak terdaftar ditolak dengan status `not_found` | **PASS** (1.50 ms) |
| **Schema Validation** | Penolakan kedalaman JSON > 5, string > 16KB, dan prototype pollution | **PASS** (2.20 ms) |
| **Credential Guard** | Penolakan akses ke `.env`, `.env.production`, dan `id_rsa` | **PASS** (10.37 ms) |
| **Path Traversal** | Penolakan traversal path di luar workspace (`../../etc/passwd`) | **PASS** (2.23 ms) |
| **SSRF Guard** | Penolakan akses `web_fetch` ke metadata IP (`169.254.169.254`) | **PASS** (2.95 ms) |
| **Approval Halt** | Tool HIGH risk berhenti pada `waiting_approval` tanpa efek samping | **PASS** (5.79 ms) |
| **Actor Binding** | Runtime gagal memalsukan `userId`/`role` pada audit log | **PASS** (5.83 ms) |
| **Prompt Injection** | Tag injeksi dimatikan dan secret dalam tool output diredaksi | **PASS** (5.09 ms) |
| **Workspace Injector** | Injeksi dan pembersihan file `.mcp.json` di workspace direktori | **PASS** (14.01 ms) |
| **Live OMP Discovery** | Binary `omp.exe` v18.8.4 lokal mendeteksi `.mcp.json` secara otomatis | **PASS** (1.63 ms) |
| **Total Test Suite** | 33 test di `@personal-ai-os/mcp` dan 60 test di `@personal-ai-os/tools` | **PASS 93/93** (0 gagal) |
| **Workspace Typecheck** | Pemeriksaan type TypeScript strict di 14 proyek workspace | **PASS** (0 error) |
| **Workspace Lint** | Pemeriksaan ESLint di 14 proyek workspace | **PASS** (0 error) |
| **Audit Verification** | Pemeriksaan konsistensi dokumen & path (`pnpm verify:audit`) | **PASS** (100% valid) |
