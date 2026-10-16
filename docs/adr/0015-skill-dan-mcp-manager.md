# ADR 0015: Skill Manager, MCP Manager, Remote Transport, dan Batas Keamanan

## Status
Diterima (Accepted)

## Konteks
Sistem Personal AI OS telah memiliki fondasi eksekusi skill lokal (`on-topic-guard`, `coding-quality-checklist`, `research-quality-checklist`) dan MCP server melalui transport stdio yang diinisialisasi saat deployment via variabel lingkungan `MCP_SERVERS`. Namun, terdapat beberapa keterbatasan arsitektur:
1. Belum ada antarmuka pengguna (UI) untuk mengelola skill dan server MCP baik di Windows Agent maupun Android.
2. Saklar aktivasi skill sebelumnya bersifat global, belum mendukung konfigurasi granular per-proyek (*per-project skill toggle*).
3. Hasil pemakaian terakhir (*last usage outcome*) dari setiap skill belum terekam dan ditampilkan kepada pengguna.
4. Transport MCP terbatas pada `stdio` proses lokal, belum mendukung server MCP jarak jauh (*remote MCP*) melalui protokol Server-Sent Events (SSE) / HTTP.
5. Penambahan server MCP belum memiliki alur dinamis yang aman: menjalankan proses lokal arbitrer dari input pengguna bebas adalah risiko keamanan kritis (RCE).
6. Pengguna awam memerlukan penjelasan risiko yang mudah dipahami sebelum mengaktifkan skill atau server MCP dengan hak akses tertentu.

## Keputusan

### 1. Tata Kelola Skill & Per-Project Toggle
- Setiap skill memiliki manifest terstruktur (`manifest.json`) yang divalidasi oleh `ManifestValidator` sebelum didaftarkan ke repository.
- Dibuat tabel `project_skills` di database PostgreSQL untuk mencatat status aktivasi skill spesifik per proyek (`projectId`, `skillName`, `isEnabled`). Jika tidak ada entri khusus proyek, skill mengikuti status default global.
- Hasil pemakaian terakhir (`lastUsedAt`, `lastOutcome: 'success' | 'failure'`, `lastError`) direkam ke dalam tabel `skills` dan dicatat di `audit_logs`.
- Seluruh perubahan konfigurasi skill (`enable`, `disable`, `toggle`, `rollback`) wajib menghasilkan entri audit log terstruktur.

### 2. Tiga Skill Baru Bernilai Tinggi
Menambahkan 3 skill bawaan dengan manifest, handler teruji, dan kepatuhan terhadap Permission Engine:
1. **`plan-before-act`**:
   - Memvalidasi bahwa setiap tugas memiliki rencana terstruktur (`steps`) dan kriteria penerimaan yang jelas (`acceptanceCriteria`) sebelum tindakan eksekusi aksi dimulai.
   - Menolak rencana kosong, instruksi placeholder, atau tindakan tanpa kriteria pengujian.
2. **`verify-with-evidence`**:
   - Menolak klaim penyelesaian tugas ("done", "completed", "selesai") jika tidak disertai bukti konkret (*evidence* seperti log stdout, exit code pengujian 0, path artefak yang valid, atau luaran tool).
   - Menghitung skor keyakinan (*confidence score*) berdasarkan bobot bukti yang disediakan.
3. **`security-review`**:
   - Memeriksa kode, diff, atau konfigurasi terhadap potensi kebocoran rahasia (API key, token JWT, private key SSH, password), pola injeksi (SQL injection, shell chaining, path traversal), dan izin berlebih (wildcard permissions).
   - Menolak perubahan yang mengandung temuan tingkat `CRITICAL` atau `HIGH`.

### 3. Remote MCP Transport (SSE/HTTP) dan Pembatasan Egress
- Mengimplementasikan `SseMcpServerAdapter` untuk menghubungkan agen dengan server MCP eksternal melalui protokol HTTP / Server-Sent Events.
- **Pembatasan Egress & Proteksi SSRF**:
  - URL server remote divalidasi ketat: dilarang mengarah ke alamat IP privat, loopback, link-local, atau metadata cloud (`127.0.0.1`, `localhost`, `169.254.169.254`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `::1`) kecuali jika alamat tersebut terdaftar secara eksplisit dalam `MCP_REMOTE_ALLOWLIST`.
  - Protokol wajib menggunakan `https://` di lingkungan produksi, atau `http://` untuk endpoint lokal yang diizinkan.
- Seluruh luaran tool dari remote MCP diperlakukan sebagai **tidak tepercaya** (*untrusted*) dan wajib disanitasi menggunakan `sanitizeMcpOutput` serta dibungkus tag `<untrusted_content is_instruction="false">`.

### 4. Batas Otorisasi dan Allowlist Perintah MCP
- Penambahan server MCP baru **HANYA** dapat dilakukan oleh aktor dengan peran `admin` atau `owner` (diverifikasi melalui email atau token pengguna terotentikasi).
- Perintah stdio divalidasi terhadap allowlist perintah deployment (`MCP_COMMAND_ALLOWLIST`, default: `npx`, `node`, `docker`, `uvx`, `python3`).
- Dilarang keras menggunakan shell wrapper (`bash`, `sh`, `cmd`, `powershell`), operator chaining (`;`, `&&`, `|`), atau subshell.
- Setiap penambahan server baru berstatus `pending_approval` dan memerlukan persetujuan eksplisit (`PermissionEngine` risk level `HIGH`).

### 5. Audit Log dan Bahasa Awam
- Setiap mutasi skill/MCP (tambah, hapus, ubah status) dan setiap pemanggilan tool MCP dicatat ke tabel `audit_logs`.
- Antarmuka pengguna menyajikan kartu penjelasan risiko dengan bahasa awam (misal: "Skill ini dapat membaca file proyek Anda. Tidak ada data yang dikirim ke internet.") sebelum pengguna mengonfirmasi pengaktifan.

## Konsekuensi
- Positif: Kemampuan mengontrol skill per-proyek, fleksibilitas integrasi MCP jarak jauh tanpa mengorbankan keamanan VPS/jaringan, mitigasi RCE dan SSRF secara proaktif, transparansi audit lengkap.
- Keterbatasan: Koneksi SSE remote bergantung pada latensi jaringan eksternal; penambahan server membutuhkan hak admin.
